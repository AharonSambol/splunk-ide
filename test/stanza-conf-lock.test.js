const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { listStanzaNames, extractStanza } = require('../lib/conf-stanza');
const {
    saveVersion,
    saveStanzaVersion,
    discardStanzaDraft
} = require('../lib/query-versions');
const {
    saveStanzaDraft,
    getStanzaDraft,
    listStanzaDraftsForConf,
    recomposeWorktree
} = require('../lib/stanza-drafts');
const { createTempGitRepo, cleanupTempRepo } = require('./helpers/temp-git-repo');

const CONF_PATH = 'prod/apps/search/local/savedsearches.conf';

const HEAD_CONF = `[Error Rate]
search = index=main
disabled = 0

[Other Search]
search = index=other
disabled = 1
`;

const DRAFT_ERROR_RATE = `[Error Rate]
search = index=main | stats count
disabled = 0

`;

const DRAFT_OTHER_SEARCH = `[Other Search]
search = index=other | head 10
disabled = 1

`;

function writeConf(repoPath, content) {
    const absolutePath = path.join(repoPath, CONF_PATH);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, content, 'utf8');
}

function countStanzaHeaders(confText, stanzaName) {
    const escaped = stanzaName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`^\\[${escaped}\\]`, 'gm');
    return (confText.match(re) || []).length;
}

describe('stanza conf lock', () => {
    let repoPath;
    let git;
    let baseHash;

    beforeEach(async () => {
        ({ repoPath, git } = await createTempGitRepo());
        writeConf(repoPath, HEAD_CONF);
        await saveVersion(git, CONF_PATH, 'Initial conf');
        baseHash = (await git.revparse(['HEAD'])).trim();
    });

    afterEach(() => {
        cleanupTempRepo(repoPath);
    });

    it('overlapping save A + save B: both commits correct, no lost draft', async () => {
        await saveStanzaDraft(git, CONF_PATH, 'Error Rate', baseHash, DRAFT_ERROR_RATE);
        await saveStanzaDraft(git, CONF_PATH, 'Other Search', baseHash, DRAFT_OTHER_SEARCH);
        await recomposeWorktree(git, CONF_PATH, baseHash);

        const [resultA, resultB] = await Promise.all([
            saveStanzaVersion(git, CONF_PATH, 'Error Rate', 'Save Error Rate'),
            saveStanzaVersion(git, CONF_PATH, 'Other Search', 'Save Other Search')
        ]);

        assert.equal(resultA.saved, true);
        assert.equal(resultB.saved, true);

        const headHash = (await git.revparse(['HEAD'])).trim();
        const headConf = await git.show([`${headHash}:${CONF_PATH}`]);
        assert.equal(extractStanza(headConf, 'Error Rate'), DRAFT_ERROR_RATE);
        assert.equal(extractStanza(headConf, 'Other Search'), DRAFT_OTHER_SEARCH);
        assert.equal(await getStanzaDraft(git, CONF_PATH, 'Error Rate', baseHash), null);
        assert.equal(await getStanzaDraft(git, CONF_PATH, 'Other Search', baseHash), null);
        assert.equal((await listStanzaDraftsForConf(git, CONF_PATH)).length, 0);

        const onDisk = fs.readFileSync(path.join(repoPath, CONF_PATH), 'utf8');
        assert.equal(countStanzaHeaders(onDisk, 'Error Rate'), 1);
        assert.equal(countStanzaHeaders(onDisk, 'Other Search'), 1);
    });

    it('overlapping reset A + save B does not corrupt conf', async () => {
        await saveStanzaDraft(git, CONF_PATH, 'Error Rate', baseHash, DRAFT_ERROR_RATE);
        await saveStanzaDraft(git, CONF_PATH, 'Other Search', baseHash, DRAFT_OTHER_SEARCH);
        await recomposeWorktree(git, CONF_PATH, baseHash);

        const [discardResult, saveResult] = await Promise.all([
            discardStanzaDraft(git, CONF_PATH, 'Error Rate'),
            saveStanzaVersion(git, CONF_PATH, 'Other Search', 'Save Other Search')
        ]);

        assert.equal(discardResult.discarded, true);
        assert.equal(saveResult.saved, true);

        const headHash = (await git.revparse(['HEAD'])).trim();
        const headConf = await git.show([`${headHash}:${CONF_PATH}`]);
        const onDisk = fs.readFileSync(path.join(repoPath, CONF_PATH), 'utf8');

        assert.equal(extractStanza(headConf, 'Other Search'), DRAFT_OTHER_SEARCH);
        assert.equal(extractStanza(onDisk, 'Error Rate'), extractStanza(HEAD_CONF, 'Error Rate'));
        assert.equal(extractStanza(onDisk, 'Other Search'), DRAFT_OTHER_SEARCH);
        assert.equal(countStanzaHeaders(onDisk, 'Error Rate'), 1);
        assert.equal(countStanzaHeaders(onDisk, 'Other Search'), 1);
        assert.equal(listStanzaNames(onDisk).length, 2);
        assert.equal(await getStanzaDraft(git, CONF_PATH, 'Error Rate', baseHash), null);
    });
});
