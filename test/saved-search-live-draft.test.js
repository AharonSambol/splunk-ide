const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { saveVersion } = require('../lib/query-versions');
const {
    saveStanzaDraft,
    listStanzaDraftsForConf,
    recomposeWorktree
} = require('../lib/stanza-drafts');
const { urlsMatchForDraft } = require('../lib/url-utils');
const { createTempGitRepo, cleanupTempRepo } = require('./helpers/temp-git-repo');

const CONF_PATH = 'prod/apps/search/local/savedsearches.conf';
const SPL_URL_V1 = 'http://localhost:8010/en-US/app/search/search?q=search%20index%3Dmain&s=%2FservicesNS%2Fnobody%2Fsearch%2Fsaved%2Fsearches%2FError%2520Rate&sid=1';
const SPL_URL_V2 = 'http://localhost:8010/en-US/app/search/search?s=%2FservicesNS%2Fnobody%2Fsearch%2Fsaved%2Fsearches%2FError%2520Rate&q=search%20index%3Dmain&sid=2';

const HEAD_CONF = `[Error Rate]
search = index=main
disabled = 0
`;

const EDITED_STANZA = `[Error Rate]
search = index=main | stats count
disabled = 0

`;

function writeConf(repoPath, content) {
    const absolutePath = path.join(repoPath, CONF_PATH);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, content, 'utf8');
}

describe('saved-search live draft persistence', () => {
    let repoPath;
    let git;
    let baseHash;

    beforeEach(async () => {
        ({ repoPath, git } = await createTempGitRepo('queries/error-rate.spl', SPL_URL_V1));
        writeConf(repoPath, HEAD_CONF);
        await saveVersion(git, CONF_PATH, 'Initial conf');
        baseHash = (await git.revparse(['HEAD'])).trim();
    });

    afterEach(() => {
        cleanupTempRepo(repoPath);
    });

    it('keeps stanza draft when only the tab URL pointer changes', async () => {
        await saveStanzaDraft(git, CONF_PATH, 'Error Rate', baseHash, EDITED_STANZA);
        await recomposeWorktree(git, CONF_PATH, baseHash);

        const splPath = path.join(repoPath, 'queries/error-rate.spl');
        fs.writeFileSync(splPath, SPL_URL_V2, 'utf8');
        assert.equal(urlsMatchForDraft(SPL_URL_V1, SPL_URL_V2), true);

        const drafts = await listStanzaDraftsForConf(git, CONF_PATH);
        assert.equal(drafts.length, 1);
        assert.equal(drafts[0].name, 'Error Rate');
        assert.match(drafts[0].text, /search = index=main \| stats count/);
    });

    it('records durable draft when live search differs from HEAD stanza', async () => {
        await saveStanzaDraft(git, CONF_PATH, 'Error Rate', baseHash, EDITED_STANZA);
        await recomposeWorktree(git, CONF_PATH, baseHash);

        const drafts = await listStanzaDraftsForConf(git, CONF_PATH);
        assert.equal(drafts.length, 1);
        assert.match(drafts[0].text, /search = index=main \| stats count/);
    });
});
