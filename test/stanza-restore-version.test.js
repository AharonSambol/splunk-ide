const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { extractStanza } = require('../lib/conf-stanza');
const { saveVersion, saveStanzaVersion, restoreStanzaVersion } = require('../lib/query-versions');
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

const OLD_ERROR_RATE = `[Error Rate]
search = index=legacy
disabled = 0

`;

function writeConf(repoPath, content) {
    const absolutePath = path.join(repoPath, CONF_PATH);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, content, 'utf8');
}

describe('restoreStanzaVersion', () => {
    let repoPath;
    let git;
    let initialHash;
    let headHash;

    beforeEach(async () => {
        ({ repoPath, git } = await createTempGitRepo());
        writeConf(repoPath, HEAD_CONF);
        await saveVersion(git, CONF_PATH, 'Initial conf');
        initialHash = (await git.revparse(['HEAD'])).trim();

        writeConf(
            repoPath,
            HEAD_CONF.replace(
                extractStanza(HEAD_CONF, 'Error Rate'),
                OLD_ERROR_RATE
            )
        );
        await saveVersion(git, CONF_PATH, 'Update Error Rate');
        headHash = (await git.revparse(['HEAD'])).trim();
    });

    afterEach(() => {
        cleanupTempRepo(repoPath);
    });

    it('restores historical stanza into draft and worktree without new commit', async () => {
        const headBefore = headHash;

        const result = await restoreStanzaVersion(
            git,
            CONF_PATH,
            'Error Rate',
            initialHash
        );
        assert.equal(result.restored, true);
        assert.equal(result.stanzaText, extractStanza(HEAD_CONF, 'Error Rate'));

        const headAfter = (await git.revparse(['HEAD'])).trim();
        assert.equal(headAfter, headBefore);

        const onDisk = fs.readFileSync(path.join(repoPath, CONF_PATH), 'utf8');
        assert.equal(extractStanza(onDisk, 'Error Rate'), extractStanza(HEAD_CONF, 'Error Rate'));
        assert.equal(
            extractStanza(onDisk, 'Other Search'),
            extractStanza(HEAD_CONF, 'Other Search')
        );

        const draft = await getStanzaDraft(git, CONF_PATH, 'Error Rate', initialHash);
        assert.ok(draft);
        assert.equal(draft.text, extractStanza(HEAD_CONF, 'Error Rate'));
    });

    it('leaves sibling drafts intact when restoring one stanza', async () => {
        await saveStanzaDraft(git, CONF_PATH, 'Other Search', headHash, DRAFT_OTHER_SEARCH);
        await recomposeWorktree(git, CONF_PATH, headHash);

        await restoreStanzaVersion(git, CONF_PATH, 'Error Rate', initialHash);

        const onDisk = fs.readFileSync(path.join(repoPath, CONF_PATH), 'utf8');
        assert.equal(extractStanza(onDisk, 'Error Rate'), extractStanza(HEAD_CONF, 'Error Rate'));
        assert.equal(extractStanza(onDisk, 'Other Search'), DRAFT_OTHER_SEARCH);

        const siblingDraft = await getStanzaDraft(git, CONF_PATH, 'Other Search', headHash);
        assert.ok(siblingDraft);
        assert.equal(siblingDraft.text, DRAFT_OTHER_SEARCH);
        assert.equal((await listStanzaDraftsForConf(git, CONF_PATH)).length, 2);
    });

    it('replaces an existing draft for the restored stanza', async () => {
        await saveStanzaDraft(git, CONF_PATH, 'Error Rate', headHash, DRAFT_ERROR_RATE);
        await recomposeWorktree(git, CONF_PATH, headHash);

        await restoreStanzaVersion(git, CONF_PATH, 'Error Rate', initialHash);

        assert.equal(await getStanzaDraft(git, CONF_PATH, 'Error Rate', headHash), null);
        const restoredDraft = await getStanzaDraft(git, CONF_PATH, 'Error Rate', initialHash);
        assert.ok(restoredDraft);
        assert.equal(restoredDraft.text, extractStanza(HEAD_CONF, 'Error Rate'));
    });

    it('fails when historical stanza is missing', async () => {
        const result = await restoreStanzaVersion(
            git,
            CONF_PATH,
            'Nonexistent Search',
            initialHash
        );
        assert.equal(result.restored, false);
        assert.equal(result.reason, 'missing-stanza');
    });

    it('does not use whole-conf checkout', async () => {
        const checkoutCalls = [];
        const originalCheckout = git.checkout.bind(git);
        git.checkout = async (...args) => {
            checkoutCalls.push(args);
            return originalCheckout(...args);
        };

        await restoreStanzaVersion(git, CONF_PATH, 'Error Rate', initialHash);

        const confCheckouts = checkoutCalls.filter(
            (args) => args.some((arg) => String(arg).includes('savedsearches.conf'))
        );
        assert.equal(confCheckouts.length, 0);
    });
});
