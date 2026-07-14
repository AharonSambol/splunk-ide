const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { simpleGit } = require('simple-git');
const { extractStanza } = require('../lib/conf-stanza');
const { getSavedSearchConfPath } = require('../lib/object-paths');
const { saveStanzaVersion } = require('../lib/query-versions');
const {
    saveStanzaDraft,
    getStanzaDraft,
    listStanzaDraftsForConf,
    recomposeWorktree
} = require('../lib/stanza-drafts');
const { ensureRemote, pushSharedHistory, pushSharedHistoryWithReconcile } = require('../lib/git-sync');
const { reconcileConfFromRest, STANZA_CONFLICT_STATUS } = require('../lib/reconcile');
const { cleanupTempRepo } = require('./helpers/temp-git-repo');

const META = { instance: 'prod', app: 'search', owner: 'nobody', name: 'Error Rate' };
const CONF_PATH = getSavedSearchConfPath(META);
const SHARED_BRANCH = 'main';

const ERROR_RATE_V0 = `[Error Rate]
search = index=main
disabled = 0

`;

const ERROR_RATE_LOCAL = `[Error Rate]
search = index=main | stats count by host
disabled = 0

`;

const ERROR_RATE_REMOTE_REST = `[Error Rate]
search = index=main | stats count
disabled = 0

`;

const OTHER_SEARCH_DRAFT = `[Other Search]
search = index=other | head 5
disabled = 1

`;

const HEAD_CONF = `${ERROR_RATE_V0}[Other Search]
search = index=other
disabled = 1

`;

function writeConf(repoPath, content) {
    const absolutePath = path.join(repoPath, CONF_PATH);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, content, 'utf8');
}

function mockRestExport(stanzaByName) {
    return async ({ name }) => {
        if (!Object.prototype.hasOwnProperty.call(stanzaByName, name)) {
            throw new Error(`unexpected stanza ${name}`);
        }
        return stanzaByName[name];
    };
}

async function createBareRemote() {
    const barePath = fs.mkdtempSync(path.join(os.tmpdir(), 'splunk-ide-bare-'));
    await simpleGit(barePath).init(['--bare']);
    return barePath;
}

async function createLocalRepo() {
    const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'splunk-ide-reconcile-'));
    const git = simpleGit(repoPath);
    await git.init();
    await git.addConfig('user.name', 'Test User');
    await git.addConfig('user.email', 'test@example.com');
    return { repoPath, git };
}

describe('reconcileConfFromRest', () => {
    let barePath;
    let repoAPath;
    let repoBPath;
    let gitA;
    let gitB;

    beforeEach(async () => {
        barePath = await createBareRemote();
        ({ repoPath: repoAPath, git: gitA } = await createLocalRepo());
        ({ repoPath: repoBPath, git: gitB } = await createLocalRepo());

        writeConf(repoAPath, HEAD_CONF);
        await gitA.add(CONF_PATH);
        await gitA.commit('Seed conf');
        assert.equal((await ensureRemote(gitA, { remoteUrl: barePath })).ok, true);
        assert.equal((await ensureRemote(gitB, { remoteUrl: barePath })).ok, true);
        assert.equal((await pushSharedHistory(gitA, { sharedBranch: SHARED_BRANCH })).ok, true);

        await gitB.fetch();
        await gitB.checkout(['-B', SHARED_BRANCH, `refs/remotes/origin/${SHARED_BRANCH}`]);
    });

    afterEach(() => {
        cleanupTempRepo(barePath);
        cleanupTempRepo(repoAPath);
        cleanupTempRepo(repoBPath);
    });

    it('re-exports from REST, commits, pushes after diverge, and keeps unrelated draft', async () => {
        const baseHash = (await gitB.revparse(['HEAD'])).trim();

        await saveStanzaDraft(gitB, CONF_PATH, 'Other Search', baseHash, OTHER_SEARCH_DRAFT);
        await recomposeWorktree(gitB, CONF_PATH, baseHash);

        writeConf(repoBPath, `${ERROR_RATE_LOCAL}[Other Search]
search = index=other | head 5
disabled = 1

`);
        await saveStanzaVersion(gitB, CONF_PATH, 'Error Rate', 'Local save');

        writeConf(repoAPath, `${ERROR_RATE_REMOTE_REST}[Other Search]
search = index=other
disabled = 1

`);
        await gitA.add(CONF_PATH);
        await gitA.commit('Watchdog update Error Rate');
        assert.equal((await pushSharedHistory(gitA, { sharedBranch: SHARED_BRANCH })).ok, true);

        const pushFail = await pushSharedHistory(gitB, { sharedBranch: SHARED_BRANCH });
        assert.equal(pushFail.ok, false);

        const result = await pushSharedHistoryWithReconcile(gitB, {
            sharedBranch: SHARED_BRANCH,
            reconcile: {
                confPath: CONF_PATH,
                metadata: META,
                stanzas: ['Error Rate'],
                restSettings: { baseUrl: 'https://splunk.example.com:8089' },
                fetchSavedSearchStanza: mockRestExport({
                    'Error Rate': ERROR_RATE_REMOTE_REST,
                    'Other Search': `[Other Search]
search = index=other
disabled = 1

`
                }),
                author: { name: 'Test User', email: 'test@example.com' }
            }
        });

        assert.equal(result.ok, true);
        assert.equal(result.reconciled, true);

        const headConf = await gitB.show([`HEAD:${CONF_PATH}`]);
        assert.equal(extractStanza(headConf, 'Error Rate'), ERROR_RATE_REMOTE_REST);

        const onDisk = fs.readFileSync(path.join(repoBPath, CONF_PATH), 'utf8');
        assert.equal(extractStanza(onDisk, 'Other Search'), OTHER_SEARCH_DRAFT);
        const otherDraft = await getStanzaDraft(gitB, CONF_PATH, 'Other Search', baseHash);
        assert.ok(otherDraft);
        assert.equal(otherDraft.text, OTHER_SEARCH_DRAFT);
        assert.equal((await listStanzaDraftsForConf(gitB, CONF_PATH)).length, 1);

        const bareHead = (await simpleGit(barePath).raw(['rev-parse', `refs/heads/${SHARED_BRANCH}`])).trim();
        assert.equal(bareHead, (await gitB.revparse(['HEAD'])).trim());
    });

    it('surfaces Stanza conflict when remote and local draft changed the same stanza', async () => {
        const baseHash = (await gitB.revparse(['HEAD'])).trim();
        const draftStanza = `[Error Rate]
search = index=main | stats dc(user)
disabled = 0

`;

        await saveStanzaDraft(gitB, CONF_PATH, 'Error Rate', baseHash, draftStanza);
        await recomposeWorktree(gitB, CONF_PATH, baseHash);

        writeConf(repoAPath, `${ERROR_RATE_REMOTE_REST}[Other Search]
search = index=other
disabled = 1

`);
        await gitA.add(CONF_PATH);
        await gitA.commit('Watchdog update Error Rate');
        assert.equal((await pushSharedHistory(gitA, { sharedBranch: SHARED_BRANCH })).ok, true);

        const result = await reconcileConfFromRest(gitB, {
            confPath: CONF_PATH,
            metadata: META,
            stanzas: ['Error Rate'],
            restSettings: { baseUrl: 'https://splunk.example.com:8089' },
            fetchSavedSearchStanza: mockRestExport({ 'Error Rate': ERROR_RATE_REMOTE_REST }),
            remoteSettings: { sharedBranch: SHARED_BRANCH },
            author: { name: 'Test User', email: 'test@example.com' }
        });

        assert.equal(result.ok, true);
        assert.equal(result.conflicts.length, 1);
        assert.equal(result.conflicts[0].name, 'Error Rate');
        assert.equal(result.conflicts[0].status, STANZA_CONFLICT_STATUS);

        const onDisk = fs.readFileSync(path.join(repoBPath, CONF_PATH), 'utf8');
        assert.equal(extractStanza(onDisk, 'Error Rate'), draftStanza);
    });
});
