const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { extractStanza } = require('../lib/conf-stanza');
const { saveVersion, listVersions, readVersionStanza } = require('../lib/query-versions');
const { createTempGitRepo, cleanupTempRepo } = require('./helpers/temp-git-repo');

const CONF_PATH = 'prod/apps/search/local/savedsearches.conf';

const HEAD_CONF = `[Error Rate]
search = index=main
disabled = 0

[Other Search]
search = index=other
disabled = 1
`;

const OTHER_ONLY_CONF = `[Error Rate]
search = index=main
disabled = 0

[Other Search]
search = index=other | head 10
disabled = 1
`;

const ERROR_RATE_CHANGED_CONF = `[Error Rate]
search = index=main | stats count
disabled = 0

[Other Search]
search = index=other | head 10
disabled = 1
`;

function writeConf(repoPath, content) {
    const absolutePath = path.join(repoPath, CONF_PATH);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, content, 'utf8');
}

describe('stanza-filtered listVersions', () => {
    let repoPath;
    let git;

    beforeEach(async () => {
        ({ repoPath, git } = await createTempGitRepo());
        writeConf(repoPath, HEAD_CONF);
        await saveVersion(git, CONF_PATH, 'Initial conf');
        writeConf(repoPath, OTHER_ONLY_CONF);
        await saveVersion(git, CONF_PATH, 'Watchdog: Other Search only');
        writeConf(repoPath, ERROR_RATE_CHANGED_CONF);
        await saveVersion(git, CONF_PATH, 'Update Error Rate');
    });

    afterEach(() => {
        cleanupTempRepo(repoPath);
    });

    it('hides sibling-only commits when filtering by stanza', async () => {
        const all = await listVersions(git, CONF_PATH);
        assert.equal(all.length, 3);

        const filtered = await listVersions(git, CONF_PATH, 30, { stanza: 'Error Rate' });
        assert.equal(filtered.length, 2);
        assert.equal(filtered[0].message, 'Update Error Rate');
        assert.equal(filtered[1].message, 'Initial conf');
        assert.ok(!filtered.some((version) => version.message === 'Watchdog: Other Search only'));
    });

    it('returns stanza body text, not whole conf', async () => {
        const [latest] = await listVersions(git, CONF_PATH, 30, { stanza: 'Error Rate' });
        const expected = extractStanza(ERROR_RATE_CHANGED_CONF, 'Error Rate');
        assert.equal(latest.stanzaText, expected);
        assert.ok(!latest.stanzaText.includes('[Other Search]'));
    });

    it('readVersionStanza returns stanza at a commit', async () => {
        const versions = await listVersions(git, CONF_PATH);
        const initialHash = versions[2].hash;
        const text = await readVersionStanza(git, CONF_PATH, initialHash, 'Error Rate');
        assert.equal(text, extractStanza(HEAD_CONF, 'Error Rate'));
    });
});

describe('file-scoped listVersions without stanza option', () => {
    let repoPath;
    let git;
    let relativePath;

    const SPL_URL_V1 = 'http://localhost:8010/en-US/app/search/search?q=search%20index%3Dmain';
    const SPL_URL_V2 = 'http://localhost:8010/en-US/app/search/search?q=search%20index%3Dmain%20error';

    beforeEach(async () => {
        ({ repoPath, git, relativePath } = await createTempGitRepo('queries/main.spl', SPL_URL_V1));
        await saveVersion(git, relativePath, 'First save');
        const { writeSplFile } = require('./helpers/temp-git-repo');
        writeSplFile(repoPath, relativePath, SPL_URL_V2);
        await saveVersion(git, relativePath, 'Second save');
    });

    afterEach(() => {
        cleanupTempRepo(repoPath);
    });

    it('returns all file commits unchanged without stanza filter', async () => {
        const versions = await listVersions(git, relativePath);
        assert.equal(versions.length, 2);
        assert.equal(versions[0].query, 'index=main error');
        assert.equal(versions[0].stanzaText, undefined);
    });
});
