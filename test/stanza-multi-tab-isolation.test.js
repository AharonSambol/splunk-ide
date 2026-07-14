const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { extractStanza, listStanzaNames } = require('../lib/conf-stanza');
const {
    saveVersion,
    saveStanzaVersion,
    restoreStanzaVersion,
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
const STANZA_A = 'Error Rate';
const STANZA_B = 'Other Search';

const INITIAL_CONF = `[Error Rate]
search = index=legacy
disabled = 0

[Other Search]
search = index=other
disabled = 1
`;

const HEAD_CONF = `[Error Rate]
search = index=main
disabled = 0

[Other Search]
search = index=other
disabled = 1
`;

const DRAFT_A = `[Error Rate]
search = index=main | stats count
disabled = 0

`;

const DRAFT_B = `[Other Search]
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

function assertNoDuplicateStanza(confText, stanzaName) {
    assert.equal(countStanzaHeaders(confText, stanzaName), 1);
    const names = listStanzaNames(confText);
    assert.equal(names.filter((name) => name === stanzaName).length, 1);
}

describe('stanza multi-tab isolation', () => {
    let repoPath;
    let git;
    let initialHash;
    let headHash;

    beforeEach(async () => {
        ({ repoPath, git } = await createTempGitRepo());
        writeConf(repoPath, INITIAL_CONF);
        await saveVersion(git, CONF_PATH, 'Initial conf');
        initialHash = (await git.revparse(['HEAD'])).trim();

        writeConf(repoPath, HEAD_CONF);
        await saveVersion(git, CONF_PATH, 'Update Error Rate');
        headHash = (await git.revparse(['HEAD'])).trim();
    });

    afterEach(() => {
        cleanupTempRepo(repoPath);
    });

    it('save A leaves B draft intact; reset B keeps A committed; restore A has no duplicate header', async () => {
        await saveStanzaDraft(git, CONF_PATH, STANZA_A, headHash, DRAFT_A);
        await saveStanzaDraft(git, CONF_PATH, STANZA_B, headHash, DRAFT_B);
        await recomposeWorktree(git, CONF_PATH, headHash);

        const saved = await saveStanzaVersion(git, CONF_PATH, STANZA_A, 'Save tab A');
        assert.equal(saved.saved, true);

        const commitConf = await git.show([`${saved.hash}:${CONF_PATH}`]);
        assert.equal(extractStanza(commitConf, STANZA_A), DRAFT_A);
        assert.equal(
            extractStanza(commitConf, STANZA_B),
            extractStanza(HEAD_CONF, STANZA_B)
        );
        assert.notEqual(extractStanza(commitConf, STANZA_B), DRAFT_B);

        const draftB = await getStanzaDraft(git, CONF_PATH, STANZA_B, headHash);
        assert.ok(draftB);
        assert.equal(draftB.text, DRAFT_B);
        assert.equal(await getStanzaDraft(git, CONF_PATH, STANZA_A, headHash), null);

        const resetB = await discardStanzaDraft(git, CONF_PATH, STANZA_B);
        assert.equal(resetB.discarded, true);

        const savedHash = (await git.revparse(['HEAD'])).trim();
        const headConf = await git.show([`${savedHash}:${CONF_PATH}`]);
        const onDisk = fs.readFileSync(path.join(repoPath, CONF_PATH), 'utf8');

        assert.equal(extractStanza(onDisk, STANZA_A), extractStanza(headConf, STANZA_A));
        assert.equal(extractStanza(onDisk, STANZA_A), DRAFT_A);
        assert.equal(
            extractStanza(onDisk, STANZA_B),
            extractStanza(headConf, STANZA_B)
        );
        assert.equal(await getStanzaDraft(git, CONF_PATH, STANZA_A, headHash), null);
        assert.equal(await getStanzaDraft(git, CONF_PATH, STANZA_B, headHash), null);
        assert.equal((await listStanzaDraftsForConf(git, CONF_PATH)).length, 0);

        const restored = await restoreStanzaVersion(git, CONF_PATH, STANZA_A, initialHash);
        assert.equal(restored.restored, true);

        const afterRestore = fs.readFileSync(path.join(repoPath, CONF_PATH), 'utf8');
        assertNoDuplicateStanza(afterRestore, STANZA_A);
        assert.equal(
            extractStanza(afterRestore, STANZA_A),
            extractStanza(INITIAL_CONF, STANZA_A)
        );
    });
});
