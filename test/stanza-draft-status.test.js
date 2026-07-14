const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { extractStanza } = require('../lib/conf-stanza');
const { saveVersion, saveStanzaVersion } = require('../lib/query-versions');
const {
    saveStanzaDraft,
    getStanzaDraftStatus,
    isCommitAncestor,
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

describe('getStanzaDraftStatus', () => {
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

    it('reports no draft as not stale', async () => {
        const status = await getStanzaDraftStatus(git, CONF_PATH, 'Error Rate');
        assert.deepEqual(status, { stale: false, hasDraft: false });
    });

    it('reports fresh when draft baseHash equals HEAD', async () => {
        await saveStanzaDraft(git, CONF_PATH, 'Error Rate', baseHash, DRAFT_ERROR_RATE);

        const status = await getStanzaDraftStatus(git, CONF_PATH, 'Error Rate');
        assert.equal(status.stale, false);
        assert.equal(status.hasDraft, true);
        assert.equal(status.baseHash, baseHash);
        assert.equal(status.headHash, baseHash);
        assert.equal(status.status, undefined);
    });

    it('reports stale when HEAD moved after draft was created', async () => {
        await saveStanzaDraft(git, CONF_PATH, 'Error Rate', baseHash, DRAFT_ERROR_RATE);
        await recomposeWorktree(git, CONF_PATH, baseHash);

        writeConf(
            repoPath,
            `[Error Rate]
search = index=main
disabled = 0

[Other Search]
search = index=other | stats count
disabled = 1
`
        );
        await saveVersion(git, CONF_PATH, 'Watchdog touched sibling');
        const headHash = (await git.revparse(['HEAD'])).trim();

        assert.notEqual(headHash, baseHash);
        assert.equal(await isCommitAncestor(git, baseHash, headHash), true);

        const status = await getStanzaDraftStatus(git, CONF_PATH, 'Error Rate');
        assert.equal(status.stale, true);
        assert.equal(status.hasDraft, true);
        assert.equal(status.baseHash, baseHash);
        assert.equal(status.headHash, headHash);
        assert.equal(status.status, 'Stale draft base');
    });

    it('save still upserts draft onto new HEAD when base is stale', async () => {
        await saveStanzaDraft(git, CONF_PATH, 'Error Rate', baseHash, DRAFT_ERROR_RATE);
        await recomposeWorktree(git, CONF_PATH, baseHash);

        writeConf(
            repoPath,
            `[Error Rate]
search = index=main
disabled = 0

[Other Search]
search = index=other | stats count
disabled = 1
`
        );
        await saveVersion(git, CONF_PATH, 'Move HEAD');
        const headBeforeSave = (await git.revparse(['HEAD'])).trim();

        assert.equal(
            (await getStanzaDraftStatus(git, CONF_PATH, 'Error Rate')).status,
            'Stale draft base'
        );

        const saved = await saveStanzaVersion(git, CONF_PATH, 'Error Rate', 'Save stale draft');
        assert.equal(saved.saved, true);
        assert.notEqual(saved.hash, baseHash);

        const commitConf = await git.show([`${saved.hash}:${CONF_PATH}`]);
        assert.equal(extractStanza(commitConf, 'Error Rate'), DRAFT_ERROR_RATE);
        assert.equal(
            extractStanza(commitConf, 'Other Search'),
            extractStanza(
                await git.show([`${headBeforeSave}:${CONF_PATH}`]),
                'Other Search'
            )
        );

        const afterSave = await getStanzaDraftStatus(git, CONF_PATH, 'Error Rate');
        assert.equal(afterSave.hasDraft, false);
        assert.equal(afterSave.stale, false);
    });
});
