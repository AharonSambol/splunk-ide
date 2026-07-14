const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { extractStanza } = require('../lib/conf-stanza');
const { saveVersion, discardStanzaDraft } = require('../lib/query-versions');
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

describe('discardStanzaDraft', () => {
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

    it('keeps sibling draft when discarding one stanza', async () => {
        await saveStanzaDraft(git, CONF_PATH, 'Error Rate', baseHash, DRAFT_ERROR_RATE);
        await saveStanzaDraft(git, CONF_PATH, 'Other Search', baseHash, DRAFT_OTHER_SEARCH);
        await recomposeWorktree(git, CONF_PATH, baseHash);

        const result = await discardStanzaDraft(git, CONF_PATH, 'Error Rate');
        assert.equal(result.discarded, true);

        const siblingDraft = await getStanzaDraft(git, CONF_PATH, 'Other Search', baseHash);
        assert.ok(siblingDraft);
        assert.equal(siblingDraft.text, DRAFT_OTHER_SEARCH);
        assert.equal(await getStanzaDraft(git, CONF_PATH, 'Error Rate', baseHash), null);
        assert.equal((await listStanzaDraftsForConf(git, CONF_PATH)).length, 1);
    });

    it('recomposes discarded stanza back to HEAD', async () => {
        await saveStanzaDraft(git, CONF_PATH, 'Error Rate', baseHash, DRAFT_ERROR_RATE);
        await saveStanzaDraft(git, CONF_PATH, 'Other Search', baseHash, DRAFT_OTHER_SEARCH);
        await recomposeWorktree(git, CONF_PATH, baseHash);

        await discardStanzaDraft(git, CONF_PATH, 'Error Rate');

        const headConf = await git.show([`${baseHash}:${CONF_PATH}`]);
        const onDisk = fs.readFileSync(path.join(repoPath, CONF_PATH), 'utf8');
        assert.equal(extractStanza(onDisk, 'Error Rate'), extractStanza(headConf, 'Error Rate'));
        assert.equal(extractStanza(onDisk, 'Other Search'), DRAFT_OTHER_SEARCH);
    });

    it('returns no-draft when stanza has no draft', async () => {
        const result = await discardStanzaDraft(git, CONF_PATH, 'Error Rate');
        assert.equal(result.discarded, false);
        assert.equal(result.reason, 'no-draft');
    });
});
