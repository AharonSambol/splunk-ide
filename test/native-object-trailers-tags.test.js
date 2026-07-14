const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { extractStanza } = require('../lib/conf-stanza');
const {
    saveVersion,
    saveStanzaVersion,
    setVersionTag,
    listVersionTags,
    versionTagRef
} = require('../lib/query-versions');
const { saveStanzaDraft, recomposeWorktree } = require('../lib/stanza-drafts');
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

const savedSearchMeta = {
    instance: 'prod',
    app: 'search',
    owner: 'nobody',
    name: 'Error Rate',
    id: 'prod|search|nobody|Error Rate'
};

function writeConf(repoPath, content) {
    const absolutePath = path.join(repoPath, CONF_PATH);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, content, 'utf8');
}

async function getCommitBody(git, hash) {
    return (await git.raw(['show', '-s', '--pretty=format:%b', hash])).trim();
}

describe('native object commit trailers', () => {
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

    it('saveStanzaVersion writes Object-Type and Saved-Search trailers', async () => {
        await saveStanzaDraft(git, CONF_PATH, 'Error Rate', baseHash, DRAFT_ERROR_RATE);
        await recomposeWorktree(git, CONF_PATH, baseHash);

        const result = await saveStanzaVersion(git, CONF_PATH, 'Error Rate', 'Save Error Rate', {
            savedSearch: savedSearchMeta
        });
        assert.equal(result.saved, true);

        const body = await getCommitBody(git, result.hash);
        assert.match(body, /^Object-Type: savedsearch$/m);
        assert.match(body, /^Splunk-Instance: prod$/m);
        assert.match(body, /^Splunk-App: search$/m);
        assert.match(body, /^Splunk-Owner: nobody$/m);
        assert.match(body, /^Saved-Search: Error Rate$/m);
        assert.match(body, /^Saved-Search-Id: prod\|search\|nobody\|Error Rate$/m);
    });

    it('dashboard saveVersion writes Object-Type trailer', async () => {
        const viewPath = 'prod/apps/search/local/data/ui/views/error_overview.xml';
        const absolutePath = path.join(repoPath, viewPath);
        fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
        fs.writeFileSync(absolutePath, '<dashboard></dashboard>', 'utf8');

        const result = await saveVersion(git, viewPath, 'Save dashboard', undefined, {
            dashboard: {
                instance: 'prod',
                app: 'search',
                owner: 'nobody',
                name: 'error_overview',
                ext: 'xml'
            }
        });
        assert.equal(result.saved, true);

        const body = await getCommitBody(git, result.hash);
        assert.match(body, /^Object-Type: dashboard$/m);
    });
});

describe('stanza-scoped version tags', () => {
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

    it('scopes tag refs by stanza slug on the same conf', async () => {
        assert.equal(
            versionTagRef(CONF_PATH, 'release', 'Error Rate'),
            'search-tag/prod--apps--search--local--savedsearches.conf/error-rate/release'
        );
        assert.equal(
            versionTagRef(CONF_PATH, 'release', 'Other Search'),
            'search-tag/prod--apps--search--local--savedsearches.conf/other-search/release'
        );
        assert.notEqual(
            versionTagRef(CONF_PATH, 'release', 'Error Rate'),
            versionTagRef(CONF_PATH, 'release', 'Other Search')
        );
    });

    it('two stanzas on one conf do not share tag namespace', async () => {
        await saveStanzaDraft(git, CONF_PATH, 'Error Rate', baseHash, DRAFT_ERROR_RATE);
        await saveStanzaDraft(git, CONF_PATH, 'Other Search', baseHash, DRAFT_OTHER_SEARCH);
        await recomposeWorktree(git, CONF_PATH, baseHash);

        const savedA = await saveStanzaVersion(git, CONF_PATH, 'Error Rate', 'Save A');
        const savedB = await saveStanzaVersion(git, CONF_PATH, 'Other Search', 'Save B');
        assert.equal(savedA.saved, true);
        assert.equal(savedB.saved, true);

        await setVersionTag(git, CONF_PATH, savedA.hash, 'release', 'Error Rate');
        await setVersionTag(git, CONF_PATH, savedB.hash, 'release', 'Other Search');

        const tagsA = await listVersionTags(git, CONF_PATH, 'Error Rate');
        const tagsB = await listVersionTags(git, CONF_PATH, 'Other Search');

        assert.equal(tagsA.length, 1);
        assert.equal(tagsB.length, 1);
        assert.equal(tagsA[0].name, 'release');
        assert.equal(tagsB[0].name, 'release');
        assert.equal(tagsA[0].hash, savedA.hash);
        assert.equal(tagsB[0].hash, savedB.hash);
        assert.notEqual(tagsA[0].hash, tagsB[0].hash);
    });

    it('file-scoped tags without stanza stay unchanged', async () => {
        const splPath = 'queries/main.spl';
        const absolutePath = path.join(repoPath, splPath);
        fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
        fs.writeFileSync(
            absolutePath,
            'http://localhost:8010/en-US/app/search/search?q=search%20index%3Dmain',
            'utf8'
        );
        const saved = await saveVersion(git, splPath, 'Initial');
        assert.equal(saved.saved, true);

        const { ref } = await setVersionTag(git, splPath, saved.hash, 'v1.0');
        assert.equal(ref, 'search-tag/queries--main.spl/v1.0');

        const tags = await listVersionTags(git, splPath);
        assert.equal(tags.length, 1);
        assert.equal(tags[0].name, 'v1.0');
        assert.equal(tags[0].hash, saved.hash);
    });
});
