const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const {
    getFileStatus,
    saveVersion,
    listVersions,
    restoreVersion,
    readCurrentQuery
} = require('../lib/query-versions');
const { createTempGitRepo, writeSplFile, cleanupTempRepo } = require('./helpers/temp-git-repo');

const SPL_URL_V1 = 'http://localhost:8010/en-US/app/search/search?q=search%20index%3Dmain';
const SPL_URL_V2 = 'http://localhost:8010/en-US/app/search/search?q=search%20index%3Dmain%20error';

describe('getFileStatus', () => {
    let repoPath;
    let git;
    let relativePath;

    beforeEach(async () => {
        ({ repoPath, git, relativePath } = await createTempGitRepo('queries/main.spl', SPL_URL_V1));
    });

    afterEach(() => {
        cleanupTempRepo(repoPath);
    });

    it('reports untracked for a new file', async () => {
        const result = await getFileStatus(git, relativePath);
        assert.equal(result.status, 'untracked');
        assert.equal(result.hasChanges, true);
    });

    it('reports clean after commit', async () => {
        await saveVersion(git, relativePath, 'Initial version');
        const result = await getFileStatus(git, relativePath);
        assert.equal(result.status, 'clean');
        assert.equal(result.hasChanges, false);
    });

    it('reports modified after changing a tracked file', async () => {
        await saveVersion(git, relativePath, 'Initial version');
        writeSplFile(repoPath, relativePath, SPL_URL_V2);
        const result = await getFileStatus(git, relativePath);
        assert.equal(result.status, 'modified');
        assert.equal(result.hasChanges, true);
    });
});

describe('saveVersion', () => {
    let repoPath;
    let git;
    let relativePath;

    beforeEach(async () => {
        ({ repoPath, git, relativePath } = await createTempGitRepo('queries/main.spl', SPL_URL_V1));
    });

    afterEach(() => {
        cleanupTempRepo(repoPath);
    });

    it('stages and commits only the target file', async () => {
        writeSplFile(repoPath, 'other.spl', 'other content');
        await saveVersion(git, relativePath, 'Save main query');

        const log = await git.log({ file: relativePath });
        assert.equal(log.total, 1);
        assert.equal(log.latest.message, 'Save main query');

        const status = await getFileStatus(git, relativePath);
        assert.equal(status.status, 'clean');

        const otherStatus = await getFileStatus(git, 'other.spl');
        assert.equal(otherStatus.status, 'untracked');
    });
});

describe('listVersions', () => {
    let repoPath;
    let git;
    let relativePath;

    beforeEach(async () => {
        ({ repoPath, git, relativePath } = await createTempGitRepo('queries/main.spl', SPL_URL_V1));
    });

    afterEach(() => {
        cleanupTempRepo(repoPath);
    });

    it('returns empty array when file has no commits', async () => {
        const versions = await listVersions(git, repoPath, relativePath);
        assert.deepEqual(versions, []);
    });

    it('returns version entries with decoded query text', async () => {
        await saveVersion(git, relativePath, 'First save');
        writeSplFile(repoPath, relativePath, SPL_URL_V2);
        await saveVersion(git, relativePath, 'Second save');

        const versions = await listVersions(git, repoPath, relativePath);
        assert.equal(versions.length, 2);
        assert.equal(versions[0].message, 'Second save');
        assert.equal(versions[0].query, 'index=main error');
        assert.equal(versions[1].message, 'First save');
        assert.equal(versions[1].query, 'index=main');
        assert.match(versions[0].hash, /^[0-9a-f]{40}$/);
    });
});

describe('restoreVersion', () => {
    let repoPath;
    let git;
    let relativePath;

    beforeEach(async () => {
        ({ repoPath, git, relativePath } = await createTempGitRepo('queries/main.spl', SPL_URL_V1));
        await saveVersion(git, relativePath, 'First save');
        writeSplFile(repoPath, relativePath, SPL_URL_V2);
        await saveVersion(git, relativePath, 'Second save');
    });

    afterEach(() => {
        cleanupTempRepo(repoPath);
    });

    it('restores file content from a prior commit', async () => {
        const versions = await listVersions(git, repoPath, relativePath);
        const firstHash = versions[1].hash;

        const restored = await restoreVersion(git, relativePath, firstHash);
        assert.equal(restored.query, 'index=main');
        assert.equal(restored.url, SPL_URL_V1);

        const onDisk = readCurrentQuery(require('node:path').join(repoPath, relativePath));
        assert.equal(onDisk.query, 'index=main');
    });
});
