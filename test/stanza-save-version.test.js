const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { extractStanza } = require('../lib/conf-stanza');
const { saveVersion, saveStanzaVersion } = require('../lib/query-versions');
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

describe('saveStanzaVersion', () => {
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

    it('commits active stanza from HEAD siblings, not sibling drafts', async () => {
        await saveStanzaDraft(git, CONF_PATH, 'Error Rate', baseHash, DRAFT_ERROR_RATE);
        await saveStanzaDraft(git, CONF_PATH, 'Other Search', baseHash, DRAFT_OTHER_SEARCH);
        await recomposeWorktree(git, CONF_PATH, baseHash);

        const result = await saveStanzaVersion(git, CONF_PATH, 'Error Rate', 'Save Error Rate');
        assert.equal(result.saved, true);

        const commitConf = await git.show([`${result.hash}:${CONF_PATH}`]);
        assert.equal(extractStanza(commitConf, 'Error Rate'), DRAFT_ERROR_RATE);
        assert.equal(
            extractStanza(commitConf, 'Other Search'),
            extractStanza(HEAD_CONF, 'Other Search')
        );
        assert.notEqual(extractStanza(commitConf, 'Other Search'), DRAFT_OTHER_SEARCH);
    });

    it('keeps sibling draft loadable after saving active stanza', async () => {
        await saveStanzaDraft(git, CONF_PATH, 'Error Rate', baseHash, DRAFT_ERROR_RATE);
        await saveStanzaDraft(git, CONF_PATH, 'Other Search', baseHash, DRAFT_OTHER_SEARCH);
        await recomposeWorktree(git, CONF_PATH, baseHash);

        await saveStanzaVersion(git, CONF_PATH, 'Error Rate', 'Save Error Rate');

        const siblingDraft = await getStanzaDraft(git, CONF_PATH, 'Other Search', baseHash);
        assert.ok(siblingDraft);
        assert.equal(siblingDraft.text, DRAFT_OTHER_SEARCH);
        assert.equal(await getStanzaDraft(git, CONF_PATH, 'Error Rate', baseHash), null);
    });

    it('recomposes worktree: saved stanza at HEAD, sibling still draft', async () => {
        await saveStanzaDraft(git, CONF_PATH, 'Error Rate', baseHash, DRAFT_ERROR_RATE);
        await saveStanzaDraft(git, CONF_PATH, 'Other Search', baseHash, DRAFT_OTHER_SEARCH);
        await recomposeWorktree(git, CONF_PATH, baseHash);

        const saved = await saveStanzaVersion(git, CONF_PATH, 'Error Rate', 'Save Error Rate');
        const headConf = await git.show([`${saved.hash}:${CONF_PATH}`]);
        const onDisk = fs.readFileSync(path.join(repoPath, CONF_PATH), 'utf8');

        assert.equal(extractStanza(onDisk, 'Error Rate'), extractStanza(headConf, 'Error Rate'));
        assert.equal(extractStanza(onDisk, 'Other Search'), DRAFT_OTHER_SEARCH);
        assert.equal((await listStanzaDraftsForConf(git, CONF_PATH)).length, 1);
    });

    it('returns no-changes when active stanza matches HEAD', async () => {
        const result = await saveStanzaVersion(git, CONF_PATH, 'Error Rate', 'No-op save');
        assert.equal(result.saved, false);
        assert.equal(result.reason, 'no-changes');
    });

    it('returns no-changes when draft matches HEAD stanza', async () => {
        const headStanza = extractStanza(HEAD_CONF, 'Error Rate');
        await saveStanzaDraft(git, CONF_PATH, 'Error Rate', baseHash, headStanza);
        await recomposeWorktree(git, CONF_PATH, baseHash);

        const result = await saveStanzaVersion(git, CONF_PATH, 'Error Rate', 'No-op save');
        assert.equal(result.saved, false);
        assert.equal(result.reason, 'no-changes');
    });

    it('creates conf stanza from seedSearchText when stanza missing from HEAD', async () => {
        writeConf(repoPath, extractStanza(HEAD_CONF, 'Other Search'));
        await saveVersion(git, CONF_PATH, 'Other search only');
        const seededStanza = `[Error Rate]
search = index=main | stats count

`;

        const result = await saveStanzaVersion(git, CONF_PATH, 'Error Rate', 'First save', {
            seedSearchText: 'index=main | stats count'
        });
        assert.equal(result.saved, true);

        const onDisk = fs.readFileSync(path.join(repoPath, CONF_PATH), 'utf8');
        assert.equal(extractStanza(onDisk, 'Error Rate'), seededStanza);
        assert.ok(extractStanza(onDisk, 'Other Search'));
    });

    it('returns missing-query when seedSearchText is empty and stanza missing', async () => {
        writeConf(repoPath, extractStanza(HEAD_CONF, 'Other Search'));
        await saveVersion(git, CONF_PATH, 'Other search only');

        const result = await saveStanzaVersion(git, CONF_PATH, 'Error Rate', 'First save', {
            seedSearchText: '   '
        });
        assert.equal(result.saved, false);
        assert.equal(result.reason, 'missing-query');
    });

    it('returns missing-stanza when no stanza and no seedSearchText', async () => {
        writeConf(repoPath, extractStanza(HEAD_CONF, 'Other Search'));
        await saveVersion(git, CONF_PATH, 'Other search only');

        const result = await saveStanzaVersion(git, CONF_PATH, 'Error Rate', 'First save');
        assert.equal(result.saved, false);
        assert.equal(result.reason, 'missing-stanza');
    });

    it('seeds first commit on empty HEAD', async () => {
        const emptyRepo = await createTempGitRepo();
        try {
            const result = await saveStanzaVersion(emptyRepo.git, CONF_PATH, 'Error Rate', 'First save', {
                seedSearchText: 'index=_audi'
            });
            assert.equal(result.saved, true);
            assert.ok(result.hash);

            const onDisk = fs.readFileSync(path.join(emptyRepo.repoPath, CONF_PATH), 'utf8');
            assert.match(onDisk, /search = index=_audi/);
        } finally {
            cleanupTempRepo(emptyRepo.repoPath);
        }
    });

    it('updates existing stanza search from seedSearchText', async () => {
        const result = await saveStanzaVersion(git, CONF_PATH, 'Error Rate', 'Update search', {
            seedSearchText: 'index=main | stats count'
        });
        assert.equal(result.saved, true);

        const commitConf = await git.show([`${result.hash}:${CONF_PATH}`]);
        assert.match(extractStanza(commitConf, 'Error Rate'), /search = index=main \| stats count/);
    });
});
