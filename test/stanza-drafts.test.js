const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { simpleGit } = require('simple-git');
const { extractStanza, listStanzaNames } = require('../lib/conf-stanza');
const { saveVersion } = require('../lib/query-versions');
const {
    stanzaDraftStashRef,
    recompose,
    getStanzaDraft,
    saveStanzaDraft,
    deleteStanzaDraft,
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

describe('stanza draft stash refs', () => {
    let repoPath;
    let git;

    beforeEach(async () => {
        ({ repoPath, git } = await createTempGitRepo());
        writeConf(repoPath, HEAD_CONF);
        await saveVersion(git, CONF_PATH, 'Initial conf');
    });

    afterEach(() => {
        cleanupTempRepo(repoPath);
    });

    it('save/load/delete draft by confPath, stanzaName, and baseHash', async () => {
        const baseHash = (await git.revparse(['HEAD'])).trim();
        const ref = stanzaDraftStashRef(CONF_PATH, 'Error Rate', baseHash);

        assert.equal(await getStanzaDraft(git, CONF_PATH, 'Error Rate', baseHash), null);

        const saved = await saveStanzaDraft(
            git,
            CONF_PATH,
            'Error Rate',
            baseHash,
            DRAFT_ERROR_RATE
        );
        assert.equal(saved.saved, true);
        assert.equal(saved.ref, ref);

        const loaded = await getStanzaDraft(git, CONF_PATH, 'Error Rate', baseHash);
        assert.equal(loaded.text, DRAFT_ERROR_RATE);
        assert.equal(loaded.ref, ref);

        const deleted = await deleteStanzaDraft(git, CONF_PATH, 'Error Rate', baseHash);
        assert.equal(deleted.deleted, true);
        assert.equal(await getStanzaDraft(git, CONF_PATH, 'Error Rate', baseHash), null);
    });

    it('stores stanza-only blob without sibling stanzas', async () => {
        const baseHash = (await git.revparse(['HEAD'])).trim();
        await saveStanzaDraft(git, CONF_PATH, 'Error Rate', baseHash, DRAFT_ERROR_RATE);

        const draft = await getStanzaDraft(git, CONF_PATH, 'Error Rate', baseHash);
        assert.deepEqual(listStanzaNames(draft.text), ['Error Rate']);
        assert.doesNotMatch(draft.text, /\[Other Search\]/);
    });

    it('allows two drafts on the same conf to coexist', async () => {
        const baseHash = (await git.revparse(['HEAD'])).trim();

        await saveStanzaDraft(git, CONF_PATH, 'Error Rate', baseHash, DRAFT_ERROR_RATE);
        await saveStanzaDraft(git, CONF_PATH, 'Other Search', baseHash, DRAFT_OTHER_SEARCH);

        const drafts = await listStanzaDraftsForConf(git, CONF_PATH);
        assert.equal(drafts.length, 2);
        const names = drafts.map((draft) => draft.name).sort();
        assert.deepEqual(names, ['Error Rate', 'Other Search']);
    });

    it('recompose roundtrip applies HEAD plus each draft by exact name', () => {
        const composed = recompose(HEAD_CONF, [
            { name: 'Error Rate', text: DRAFT_ERROR_RATE },
            { name: 'Other Search', text: DRAFT_OTHER_SEARCH }
        ]);

        assert.equal(extractStanza(composed, 'Error Rate'), DRAFT_ERROR_RATE);
        assert.equal(extractStanza(composed, 'Other Search'), DRAFT_OTHER_SEARCH);
        assert.equal((composed.match(/^\[Error Rate\]/gm) || []).length, 1);
        assert.equal((composed.match(/^\[Other Search\]/gm) || []).length, 1);
    });

    it('restart simulation reloads refs in a new process and recomposes worktree', async () => {
        const baseHash = (await git.revparse(['HEAD'])).trim();
        await saveStanzaDraft(git, CONF_PATH, 'Error Rate', baseHash, DRAFT_ERROR_RATE);
        await saveStanzaDraft(git, CONF_PATH, 'Other Search', baseHash, DRAFT_OTHER_SEARCH);

        const reloadedGit = simpleGit(repoPath);
        const composed = await recomposeWorktree(reloadedGit, CONF_PATH, baseHash);

        assert.equal(extractStanza(composed, 'Error Rate'), DRAFT_ERROR_RATE);
        assert.equal(extractStanza(composed, 'Other Search'), DRAFT_OTHER_SEARCH);

        const onDisk = fs.readFileSync(path.join(repoPath, CONF_PATH), 'utf8');
        assert.equal(onDisk, composed);
    });

    it('draft stash refs stay under local-only splunk-ide/stashes prefix', async () => {
        const baseHash = (await git.revparse(['HEAD'])).trim();
        await saveStanzaDraft(git, CONF_PATH, 'Error Rate', baseHash, DRAFT_ERROR_RATE);

        const refs = (await git.raw(['for-each-ref', '--format=%(refname)', 'refs/splunk-ide/stashes/']))
            .trim()
            .split('\n')
            .filter(Boolean);

        assert.equal(refs.length, 1);
        assert.match(refs[0], /^refs\/splunk-ide\/stashes\//);
        assert.equal(refs[0], stanzaDraftStashRef(CONF_PATH, 'Error Rate', baseHash));
    });
});
