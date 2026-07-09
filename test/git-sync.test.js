const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { simpleGit } = require('simple-git');
const { ensureRemote, fetchSharedHistory, pushSharedHistory } = require('../lib/git-sync');
const {
    saveVersion,
    listVersions,
    setVersionTag,
    saveDraftStash,
    draftStashRef,
    versionRecordRef
} = require('../lib/query-versions');
const { getSavedSearchId, getSavedSearchPath } = require('../lib/saved-search-id');
const { cleanupTempRepo, writeSplFile } = require('./helpers/temp-git-repo');

const SPL_URL_V1 = 'http://localhost:8010/en-US/app/search/search?q=search%20index%3Dmain';
const SPL_URL_V2 = 'http://localhost:8010/en-US/app/search/search?q=search%20index%3Dmain%20error';
const RELATIVE_PATH = 'queries/main.spl';
const SHARED_BRANCH = 'main';

async function createBareRemote() {
    const barePath = fs.mkdtempSync(path.join(os.tmpdir(), 'splunk-ide-bare-'));
    await simpleGit(barePath).init(['--bare']);
    return barePath;
}

async function createLocalRepo() {
    const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'splunk-ide-sync-'));
    const git = simpleGit(repoPath);
    await git.init();
    await git.addConfig('user.name', 'Test User');
    await git.addConfig('user.email', 'test@example.com');
    return { repoPath, git };
}

async function listAllRefs(git) {
    const raw = await git.raw(['for-each-ref', '--format=%(refname)']);
    return raw.trim() ? raw.trim().split('\n') : [];
}

describe('ensureRemote', () => {
    let repoPath;
    let git;
    let barePath;

    beforeEach(async () => {
        ({ repoPath, git } = await createLocalRepo());
        barePath = await createBareRemote();
    });

    afterEach(() => {
        cleanupTempRepo(repoPath);
        cleanupTempRepo(barePath);
    });

    it('adds a remote when missing', async () => {
        const result = await ensureRemote(git, { remoteUrl: barePath });
        assert.equal(result.ok, true);

        const remotes = await git.getRemotes(true);
        assert.deepEqual(remotes, [{ name: 'origin', refs: { fetch: barePath, push: barePath } }]);
    });

    it('updates the remote URL when it changes', async () => {
        const otherBarePath = await createBareRemote();
        try {
            assert.equal((await ensureRemote(git, { remoteUrl: barePath })).ok, true);
            const updated = await ensureRemote(git, { remoteUrl: otherBarePath });
            assert.equal(updated.ok, true);

            const remotes = await git.getRemotes(true);
            assert.equal(remotes[0].refs.fetch, otherBarePath);
            assert.equal(remotes[0].refs.push, otherBarePath);
        } finally {
            cleanupTempRepo(otherBarePath);
        }
    });

    it('is idempotent when the remote URL is unchanged', async () => {
        assert.equal((await ensureRemote(git, { remoteUrl: barePath })).ok, true);
        const again = await ensureRemote(git, { remoteUrl: barePath });
        assert.equal(again.ok, true);

        const remotes = await git.getRemotes(true);
        assert.equal(remotes.length, 1);
        assert.equal(remotes[0].refs.fetch, barePath);
    });
});

describe('pushSharedHistory and fetchSharedHistory', () => {
    let barePath;
    let repoAPath;
    let repoBPath;
    let gitA;
    let gitB;

    beforeEach(async () => {
        barePath = await createBareRemote();
        ({ repoPath: repoAPath, git: gitA } = await createLocalRepo());
        ({ repoPath: repoBPath, git: gitB } = await createLocalRepo());

        writeSplFile(repoAPath, RELATIVE_PATH, SPL_URL_V1);
        await saveVersion(gitA, RELATIVE_PATH, 'Initial version');
        assert.equal((await ensureRemote(gitA, { remoteUrl: barePath })).ok, true);
        assert.equal((await ensureRemote(gitB, { remoteUrl: barePath })).ok, true);
    });

    afterEach(() => {
        cleanupTempRepo(barePath);
        cleanupTempRepo(repoAPath);
        cleanupTempRepo(repoBPath);
    });

    it('push/fetch the shared branch', async () => {
        const pushed = await pushSharedHistory(gitA, { sharedBranch: SHARED_BRANCH });
        assert.equal(pushed.ok, true);

        const bareGit = simpleGit(barePath);
        const bareRefs = await listAllRefs(bareGit);
        assert.ok(bareRefs.includes(`refs/heads/${SHARED_BRANCH}`));

        const fetched = await fetchSharedHistory(gitB);
        assert.equal(fetched.ok, true);

        const remoteBranch = (await gitB.raw(['rev-parse', `refs/remotes/origin/${SHARED_BRANCH}`])).trim();
        const localHead = (await gitA.raw(['rev-parse', 'HEAD'])).trim();
        assert.equal(remoteBranch, localHead);
    });

    it('push/fetch search tags', async () => {
        writeSplFile(repoAPath, RELATIVE_PATH, SPL_URL_V2);
        const tagged = await saveVersion(gitA, RELATIVE_PATH, 'Tagged version');
        await setVersionTag(gitA, RELATIVE_PATH, tagged.hash, 'release');

        const pushed = await pushSharedHistory(gitA, { sharedBranch: SHARED_BRANCH });
        assert.equal(pushed.ok, true);

        const bareGit = simpleGit(barePath);
        const bareRefs = await listAllRefs(bareGit);
        assert.ok(bareRefs.some(ref => ref.startsWith('refs/tags/search-tag/')));

        const fetched = await fetchSharedHistory(gitB);
        assert.equal(fetched.ok, true);

        const localTags = await listAllRefs(gitB);
        assert.ok(localTags.some(ref => ref.startsWith('refs/tags/search-tag/')));
    });

    it('push/fetch splunk-ide version refs', async () => {
        await saveVersion(gitA, RELATIVE_PATH, 'First save');
        writeSplFile(repoAPath, RELATIVE_PATH, SPL_URL_V2);
        const second = await saveVersion(gitA, RELATIVE_PATH, 'Second save');
        const firstHash = (await gitA.raw(['rev-parse', `${second.hash}^`])).trim();

        writeSplFile(repoAPath, RELATIVE_PATH, 'http://localhost:8010/en-US/app/search/search?q=search%20index%3Dmain%20offhead');
        const offHead = await saveVersion(gitA, RELATIVE_PATH, 'Off-head save', firstHash);
        const versionRef = versionRecordRef(RELATIVE_PATH, offHead.hash);

        const pushed = await pushSharedHistory(gitA, { sharedBranch: SHARED_BRANCH });
        assert.equal(pushed.ok, true);

        const bareGit = simpleGit(barePath);
        const bareRefs = await listAllRefs(bareGit);
        assert.ok(bareRefs.some(ref => ref.startsWith('refs/splunk-ide/versions/')));

        const fetched = await fetchSharedHistory(gitB);
        assert.equal(fetched.ok, true);

        const remoteVersionHash = (await gitB.raw(['rev-parse', versionRef])).trim();
        assert.equal(remoteVersionHash, offHead.hash);
    });

    it('does not push splunk-ide stash refs', async () => {
        writeSplFile(repoAPath, RELATIVE_PATH, SPL_URL_V2);
        const base = await saveVersion(gitA, RELATIVE_PATH, 'Base version');
        writeSplFile(repoAPath, RELATIVE_PATH, 'http://localhost:8010/en-US/app/search/search?q=search%20index%3Dmain%20draft');
        await saveDraftStash(gitA, RELATIVE_PATH, base.hash);

        const stashRef = draftStashRef(RELATIVE_PATH, base.hash);
        const localStashHash = (await gitA.raw(['rev-parse', stashRef])).trim();
        assert.ok(localStashHash);

        const pushed = await pushSharedHistory(gitA, { sharedBranch: SHARED_BRANCH });
        assert.equal(pushed.ok, true);

        const bareGit = simpleGit(barePath);
        const bareRefs = await listAllRefs(bareGit);
        assert.ok(!bareRefs.some(ref => ref.startsWith('refs/splunk-ide/stashes/')));
    });
});

describe('two-clone saved-search sharing', () => {
    const SAVED_SEARCH_META = {
        instance: 'prod',
        app: 'search',
        owner: 'nobody',
        name: 'Error Rate'
    };
    const savedSearchId = getSavedSearchId(SAVED_SEARCH_META);
    const canonicalPath = getSavedSearchPath(SAVED_SEARCH_META);

    let barePath;
    let repoAPath;
    let repoBPath;
    let gitA;
    let gitB;

    beforeEach(async () => {
        barePath = await createBareRemote();
        ({ repoPath: repoAPath, git: gitA } = await createLocalRepo());
        ({ repoPath: repoBPath, git: gitB } = await createLocalRepo());

        assert.equal((await ensureRemote(gitA, { remoteUrl: barePath })).ok, true);
        assert.equal((await ensureRemote(gitB, { remoteUrl: barePath })).ok, true);
    });

    afterEach(() => {
        cleanupTempRepo(barePath);
        cleanupTempRepo(repoAPath);
        cleanupTempRepo(repoBPath);
    });

    it('shares saved-search history from repo A to repo B without stash refs', async () => {
        writeSplFile(repoAPath, canonicalPath, SPL_URL_V1);
        const headVersion = await saveVersion(gitA, canonicalPath, 'Import saved search', undefined, {
            savedSearch: { ...SAVED_SEARCH_META, id: savedSearchId }
        });

        writeSplFile(repoAPath, canonicalPath, SPL_URL_V2);
        const offHeadVersion = await saveVersion(gitA, canonicalPath, 'Off-head save', headVersion.hash);

        writeSplFile(
            repoAPath,
            canonicalPath,
            'http://localhost:8010/en-US/app/search/search?q=search%20index%3Dmain%20draft'
        );
        await saveDraftStash(gitA, canonicalPath, offHeadVersion.hash);
        const stashRef = draftStashRef(canonicalPath, offHeadVersion.hash);
        assert.ok((await gitA.raw(['rev-parse', stashRef])).trim());

        const pushed = await pushSharedHistory(gitA, { sharedBranch: SHARED_BRANCH });
        assert.equal(pushed.ok, true);

        const fetched = await fetchSharedHistory(gitB);
        assert.equal(fetched.ok, true);
        await gitB.checkout(['-B', SHARED_BRANCH, `refs/remotes/origin/${SHARED_BRANCH}`]);

        const versions = await listVersions(gitB, canonicalPath);
        const hashes = versions.map(version => version.hash);
        assert.ok(hashes.includes(headVersion.hash), 'repo B sees repo A head commit');
        assert.ok(hashes.includes(offHeadVersion.hash), 'repo B sees repo A off-head version ref');

        const refsB = await listAllRefs(gitB);
        assert.ok(!refsB.some(ref => ref.startsWith('refs/splunk-ide/stashes/')));
    });
});
