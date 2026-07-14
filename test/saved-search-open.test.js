const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { simpleGit } = require('simple-git');
const { openSavedSearchHistory } = require('../lib/saved-search-open');
const { getSavedSearchId } = require('../lib/saved-search-id');
const { getSavedSearchConfPath } = require('../lib/object-paths');
const { extractStanza } = require('../lib/conf-stanza');
const { listVersions } = require('../lib/query-versions');
const { saveStanzaDraft } = require('../lib/stanza-drafts');
const { ensureRemote, pushSharedHistory } = require('../lib/git-sync');
const { cleanupTempRepo } = require('./helpers/temp-git-repo');

const SAVED_SEARCH_META = {
    instance: 'prod',
    app: 'search',
    owner: 'nobody',
    name: 'Error Rate'
};
const CONF_PATH = getSavedSearchConfPath(SAVED_SEARCH_META);
const savedSearchId = getSavedSearchId(SAVED_SEARCH_META);
const SHARED_BRANCH = 'main';

const ERROR_RATE_STANZA = `[Error Rate]
search = index=main
disabled = 0

`;

const ERROR_RATE_STANZA_IMPORTED = `[Error Rate]
search = index=main | stats count
disabled = 0

`;

const OTHER_STANZA = `[Other Search]
search = index=other
disabled = 1

`;

const HEAD_CONF = `${ERROR_RATE_STANZA}${OTHER_STANZA}`;

function writeConf(repoPath, content) {
    const absolutePath = path.join(repoPath, CONF_PATH);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, content, 'utf8');
}

function mockFetchStanza(stanzaText) {
    return async () => stanzaText;
}

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

describe('openSavedSearchHistory (conf paths)', () => {
    let repoPath;
    let git;

    beforeEach(async () => {
        ({ repoPath, git } = await createLocalRepo());
    });

    afterEach(() => {
        cleanupTempRepo(repoPath);
    });

    it('imports missing stanza via REST with trailers', async () => {
        const result = await openSavedSearchHistory({
            git,
            workspaceRoot: repoPath,
            metadata: SAVED_SEARCH_META,
            restSettings: { baseUrl: 'https://splunk.example.com:8089' },
            fetchSavedSearchStanza: mockFetchStanza(ERROR_RATE_STANZA_IMPORTED),
            author: { name: 'Test User', email: 'test@example.com' }
        });

        assert.equal(result.relativePath, CONF_PATH);
        assert.equal(result.confPath, CONF_PATH);
        assert.equal(result.stanzaName, 'Error Rate');
        assert.equal(result.imported, true);
        assert.equal(result.stanzaSource, 'import');
        assert.equal(result.fetched, false);
        assert.equal(result.warning, '');

        const confText = fs.readFileSync(path.join(repoPath, CONF_PATH), 'utf8');
        assert.equal(extractStanza(confText, 'Error Rate'), ERROR_RATE_STANZA_IMPORTED);
        assert.equal(await commitCount(git), 1);

        const versions = await listVersions(git, CONF_PATH, 10, { stanza: 'Error Rate' });
        assert.equal(versions.length, 1);
        assert.equal(versions[0].message, 'Import saved search');
        const body = await git.show(['-s', '--format=%b', versions[0].hash]);
        assert.match(body, /Splunk-Instance: prod/);
        assert.match(body, new RegExp(`Saved-Search-Id: ${savedSearchId}`));
    });

    it('does not import again when stanza already in HEAD', async () => {
        writeConf(repoPath, HEAD_CONF);
        await git.add(CONF_PATH);
        await git.commit('Seed conf');

        const result = await openSavedSearchHistory({
            git,
            workspaceRoot: repoPath,
            metadata: SAVED_SEARCH_META,
            restSettings: { baseUrl: 'https://splunk.example.com:8089' },
            fetchSavedSearchStanza: async () => {
                throw new Error('REST should not be called');
            },
            author: { name: 'Test User', email: 'test@example.com' }
        });

        assert.equal(result.imported, false);
        assert.equal(result.stanzaSource, 'head');
        assert.equal(await commitCount(git), 1);
        assert.equal(
            extractStanza(fs.readFileSync(path.join(repoPath, CONF_PATH), 'utf8'), 'Error Rate'),
            ERROR_RATE_STANZA
        );
    });

    it('prefers existing draft over HEAD on open', async () => {
        writeConf(repoPath, HEAD_CONF);
        await git.add(CONF_PATH);
        await git.commit('Seed conf');
        const baseHash = (await git.revparse(['HEAD'])).trim();

        const draftStanza = `[Error Rate]
search = index=main | stats count by host
disabled = 0

`;
        await saveStanzaDraft(git, CONF_PATH, 'Error Rate', baseHash, draftStanza);

        const result = await openSavedSearchHistory({
            git,
            workspaceRoot: repoPath,
            metadata: SAVED_SEARCH_META,
            author: { name: 'Test User', email: 'test@example.com' }
        });

        assert.equal(result.imported, false);
        assert.equal(result.stanzaSource, 'draft');
        assert.equal(await commitCount(git), 1);
        assert.equal(
            extractStanza(fs.readFileSync(path.join(repoPath, CONF_PATH), 'utf8'), 'Error Rate'),
            draftStanza
        );
    });

    it('keeps existing worktree conf over HEAD when no draft', async () => {
        writeConf(repoPath, HEAD_CONF);
        await git.add(CONF_PATH);
        await git.commit('Seed conf');

        const worktreeOnly = `${ERROR_RATE_STANZA.replace('index=main', 'index=worktree')}${OTHER_STANZA}`;
        writeConf(repoPath, worktreeOnly);

        const result = await openSavedSearchHistory({
            git,
            workspaceRoot: repoPath,
            metadata: SAVED_SEARCH_META,
            author: { name: 'Test User', email: 'test@example.com' }
        });

        assert.equal(result.imported, false);
        assert.equal(result.stanzaSource, 'head');
        assert.equal(await commitCount(git), 1);
        assert.match(
            extractStanza(fs.readFileSync(path.join(repoPath, CONF_PATH), 'utf8'), 'Error Rate'),
            /index=worktree/
        );
    });

    it('restores conf from git when worktree file is missing', async () => {
        writeConf(repoPath, HEAD_CONF);
        await git.add(CONF_PATH);
        await git.commit('Seed conf');
        fs.unlinkSync(path.join(repoPath, CONF_PATH));

        const result = await openSavedSearchHistory({
            git,
            workspaceRoot: repoPath,
            metadata: SAVED_SEARCH_META,
            author: { name: 'Test User', email: 'test@example.com' }
        });

        assert.equal(result.imported, false);
        assert.equal(result.stanzaSource, 'head');
        assert.equal(
            extractStanza(fs.readFileSync(path.join(repoPath, CONF_PATH), 'utf8'), 'Error Rate'),
            ERROR_RATE_STANZA
        );
    });

    it('skips import without REST config when stanza missing', async () => {
        const result = await openSavedSearchHistory({
            git,
            workspaceRoot: repoPath,
            metadata: SAVED_SEARCH_META,
            author: { name: 'Test User', email: 'test@example.com' }
        });

        assert.equal(result.imported, false);
        assert.equal(result.stanzaSource, 'missing');
        assert.match(result.warning, /no REST config/i);
        assert.equal(await commitCount(git), 0);
        assert.equal(fs.existsSync(path.join(repoPath, CONF_PATH)), false);
    });

    it('still opens locally when fetch fails', async () => {
        const result = await openSavedSearchHistory({
            git,
            workspaceRoot: repoPath,
            metadata: SAVED_SEARCH_META,
            restSettings: { baseUrl: 'https://splunk.example.com:8089' },
            fetchSavedSearchStanza: mockFetchStanza(ERROR_RATE_STANZA_IMPORTED),
            remoteSettings: {
                remoteUrl: path.join(os.tmpdir(), 'missing-bare-remote-for-open-test')
            },
            author: { name: 'Test User', email: 'test@example.com' }
        });

        assert.equal(result.imported, true);
        assert.equal(result.fetched, false);
        assert.ok(result.warning);
        assert.equal(
            extractStanza(fs.readFileSync(path.join(repoPath, CONF_PATH), 'utf8'), 'Error Rate'),
            ERROR_RATE_STANZA_IMPORTED
        );
    });

    it('fetches remote history when untracked conf already exists in worktree', async () => {
        const barePath = await createBareRemote();
        const { repoPath: repoAPath, git: gitA } = await createLocalRepo();
        try {
            writeConf(repoAPath, HEAD_CONF);
            await gitA.add(CONF_PATH);
            await gitA.commit('Import saved search');
            assert.equal((await ensureRemote(gitA, { remoteUrl: barePath })).ok, true);
            assert.equal((await pushSharedHistory(gitA, { sharedBranch: SHARED_BRANCH })).ok, true);

            const localConf = `${ERROR_RATE_STANZA.replace('index=main', 'index=local')}${OTHER_STANZA}`;
            writeConf(repoPath, localConf);

            const result = await openSavedSearchHistory({
                git,
                workspaceRoot: repoPath,
                metadata: SAVED_SEARCH_META,
                remoteSettings: { remoteUrl: barePath, sharedBranch: SHARED_BRANCH },
                author: { name: 'Test User', email: 'test@example.com' }
            });

            assert.equal(result.imported, false);
            assert.equal(result.fetched, true);
            assert.equal(result.warning, '');
            assert.match(
                extractStanza(fs.readFileSync(path.join(repoPath, CONF_PATH), 'utf8'), 'Error Rate'),
                /index=local/
            );

            const versions = await listVersions(git, CONF_PATH, 10, { stanza: 'Error Rate' });
            assert.equal(versions.length, 1);
            assert.equal(versions[0].message, 'Import saved search');
        } finally {
            cleanupTempRepo(barePath);
            cleanupTempRepo(repoAPath);
        }
    });

    it('fetches remote history without importing when stanza exists remotely', async () => {
        const barePath = await createBareRemote();
        const { repoPath: repoAPath, git: gitA } = await createLocalRepo();
        try {
            writeConf(repoAPath, HEAD_CONF);
            await gitA.add(CONF_PATH);
            await gitA.commit('Import saved search');
            assert.equal((await ensureRemote(gitA, { remoteUrl: barePath })).ok, true);
            assert.equal((await pushSharedHistory(gitA, { sharedBranch: SHARED_BRANCH })).ok, true);

            assert.equal((await ensureRemote(git, { remoteUrl: barePath })).ok, true);

            const result = await openSavedSearchHistory({
                git,
                workspaceRoot: repoPath,
                metadata: SAVED_SEARCH_META,
                remoteSettings: { remoteUrl: barePath, sharedBranch: SHARED_BRANCH },
                author: { name: 'Test User', email: 'test@example.com' }
            });

            assert.equal(result.imported, false);
            assert.equal(result.fetched, true);
            assert.equal(result.stanzaSource, 'head');
            assert.equal(result.warning, '');
            assert.equal(
                extractStanza(fs.readFileSync(path.join(repoPath, CONF_PATH), 'utf8'), 'Error Rate'),
                ERROR_RATE_STANZA
            );

            const versions = await listVersions(git, CONF_PATH, 10, { stanza: 'Error Rate' });
            assert.equal(versions.length, 1);
            assert.equal(versions[0].message, 'Import saved search');
        } finally {
            cleanupTempRepo(barePath);
            cleanupTempRepo(repoAPath);
        }
    });
});
