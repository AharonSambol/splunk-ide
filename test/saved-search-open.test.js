const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { simpleGit } = require('simple-git');
const { openSavedSearchHistory } = require('../lib/saved-search-open');
const { getSavedSearchId, getSavedSearchPath } = require('../lib/saved-search-id');
const { listVersions } = require('../lib/query-versions');
const { ensureRemote, fetchSharedHistory, pushSharedHistory } = require('../lib/git-sync');
const { cleanupTempRepo, writeSplFile } = require('./helpers/temp-git-repo');

const SAVED_SEARCH_META = {
    instance: 'prod',
    app: 'search',
    owner: 'nobody',
    name: 'Error Rate'
};
const SPL_URL_IMPORT = 'http://localhost:8010/en-US/app/search/search?q=search%20index%3Dmain';
const SPL_URL_OTHER = 'http://localhost:8010/en-US/app/search/search?q=search%20index%3Dmain%20other';
const SHARED_BRANCH = 'main';

async function createBareRemote() {
    const barePath = fs.mkdtempSync(path.join(os.tmpdir(), 'splunk-ide-bare-'));
    await simpleGit(barePath).init(['--bare']);
    return barePath;
}

async function createLocalRepo() {
    const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'splunk-ide-open-'));
    const git = simpleGit(repoPath);
    await git.init();
    return { repoPath, git };
}

async function commitCount(git) {
    try {
        return Number((await git.raw(['rev-list', '--count', 'HEAD'])).trim());
    } catch {
        return 0;
    }
}

describe('openSavedSearchHistory', () => {
    let repoPath;
    let git;
    const canonicalPath = getSavedSearchPath(SAVED_SEARCH_META);
    const savedSearchId = getSavedSearchId(SAVED_SEARCH_META);

    beforeEach(async () => {
        ({ repoPath, git } = await createLocalRepo());
    });

    afterEach(() => {
        cleanupTempRepo(repoPath);
    });

    it('imports on first open with trailers', async () => {
        const result = await openSavedSearchHistory({
            git,
            workspaceRoot: repoPath,
            metadata: SAVED_SEARCH_META,
            currentUrl: SPL_URL_IMPORT,
            author: { name: 'Test User', email: 'test@example.com' }
        });

        assert.equal(result.relativePath, canonicalPath);
        assert.equal(result.imported, true);
        assert.equal(result.fetched, false);
        assert.equal(result.warning, '');

        const absolutePath = path.join(repoPath, canonicalPath);
        assert.equal(fs.readFileSync(absolutePath, 'utf8'), SPL_URL_IMPORT);
        assert.equal(await commitCount(git), 1);

        const versions = await listVersions(git, canonicalPath);
        assert.equal(versions.length, 1);
        assert.equal(versions[0].message, 'Import saved search');
        const body = await git.show(['-s', '--format=%b', versions[0].hash]);
        assert.match(body, /Splunk-Instance: prod/);
        assert.match(body, /Saved-Search-Id: /);
        assert.match(body, new RegExp(`Saved-Search-Id: ${savedSearchId}`));
    });

    it('does not import again on reopen', async () => {
        await openSavedSearchHistory({
            git,
            workspaceRoot: repoPath,
            metadata: SAVED_SEARCH_META,
            currentUrl: SPL_URL_IMPORT,
            author: { name: 'Test User', email: 'test@example.com' }
        });
        const commitsAfterFirst = await commitCount(git);

        const result = await openSavedSearchHistory({
            git,
            workspaceRoot: repoPath,
            metadata: SAVED_SEARCH_META,
            currentUrl: SPL_URL_OTHER,
            author: { name: 'Test User', email: 'test@example.com' }
        });

        assert.equal(result.imported, false);
        assert.equal(await commitCount(git), commitsAfterFirst);
        assert.equal(fs.readFileSync(path.join(repoPath, canonicalPath), 'utf8'), SPL_URL_IMPORT);
    });

    it('keeps existing worktree file over current Splunk content', async () => {
        writeSplFile(repoPath, canonicalPath, SPL_URL_IMPORT);

        const result = await openSavedSearchHistory({
            git,
            workspaceRoot: repoPath,
            metadata: SAVED_SEARCH_META,
            currentUrl: SPL_URL_OTHER,
            author: { name: 'Test User', email: 'test@example.com' }
        });

        assert.equal(result.imported, false);
        assert.equal(await commitCount(git), 0);
        assert.equal(fs.readFileSync(path.join(repoPath, canonicalPath), 'utf8'), SPL_URL_IMPORT);
    });

    it('restores from git when worktree file is missing', async () => {
        writeSplFile(repoPath, canonicalPath, SPL_URL_IMPORT);
        await git.add(canonicalPath);
        await git.commit('Seed saved search');
        fs.unlinkSync(path.join(repoPath, canonicalPath));

        const result = await openSavedSearchHistory({
            git,
            workspaceRoot: repoPath,
            metadata: SAVED_SEARCH_META,
            currentUrl: SPL_URL_OTHER,
            author: { name: 'Test User', email: 'test@example.com' }
        });

        assert.equal(result.imported, false);
        assert.equal(await commitCount(git), 1);
        assert.equal(fs.readFileSync(path.join(repoPath, canonicalPath), 'utf8'), SPL_URL_IMPORT);
    });

    it('still opens locally when fetch fails', async () => {
        const result = await openSavedSearchHistory({
            git,
            workspaceRoot: repoPath,
            metadata: SAVED_SEARCH_META,
            currentUrl: SPL_URL_IMPORT,
            remoteSettings: {
                remoteUrl: path.join(os.tmpdir(), 'missing-bare-remote-for-open-test')
            },
            author: { name: 'Test User', email: 'test@example.com' }
        });

        assert.equal(result.imported, true);
        assert.equal(result.fetched, false);
        assert.ok(result.warning);
        assert.equal(fs.readFileSync(path.join(repoPath, canonicalPath), 'utf8'), SPL_URL_IMPORT);
    });

    it('fetches remote history without importing when file already exists remotely', async () => {
        const barePath = await createBareRemote();
        const { repoPath: repoAPath, git: gitA } = await createLocalRepo();
        try {
            writeSplFile(repoAPath, canonicalPath, SPL_URL_IMPORT);
            await gitA.add(canonicalPath);
            await gitA.commit('Import saved search');
            assert.equal((await ensureRemote(gitA, { remoteUrl: barePath })).ok, true);
            assert.equal((await pushSharedHistory(gitA, { sharedBranch: SHARED_BRANCH })).ok, true);

            assert.equal((await ensureRemote(git, { remoteUrl: barePath })).ok, true);

            const result = await openSavedSearchHistory({
                git,
                workspaceRoot: repoPath,
                metadata: SAVED_SEARCH_META,
                currentUrl: SPL_URL_OTHER,
                remoteSettings: { remoteUrl: barePath, sharedBranch: SHARED_BRANCH },
                author: { name: 'Test User', email: 'test@example.com' }
            });

            assert.equal(result.imported, false);
            assert.equal(result.fetched, true);
            assert.equal(result.warning, '');
            assert.equal(fs.readFileSync(path.join(repoPath, canonicalPath), 'utf8'), SPL_URL_IMPORT);

            const versions = await listVersions(git, canonicalPath);
            assert.equal(versions.length, 1);
            assert.equal(versions[0].message, 'Import saved search');
        } finally {
            cleanupTempRepo(barePath);
            cleanupTempRepo(repoAPath);
        }
    });
});
