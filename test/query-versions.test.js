const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const {
    ensureRepo,
    getFileStatus,
    saveVersion,
    listVersions,
    restoreVersion,
    readCurrentQuery,
    renameQueryFile
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

    it('reports untracked when project has no git repo yet', async () => {
        const barePath = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'splunk-ide-bare-'));
        const bareGit = require('simple-git')(barePath);
        writeSplFile(barePath, 'new.spl', SPL_URL_V1);

        const result = await getFileStatus(bareGit, 'new.spl');
        assert.equal(result.status, 'untracked');
        assert.equal(result.hasChanges, true);

        cleanupTempRepo(barePath);
    });

    it('ignores a parent git repo and treats the project as untracked', async () => {
        const fs = require('node:fs');
        const path = require('node:path');
        const os = require('node:os');
        const parentPath = fs.mkdtempSync(path.join(os.tmpdir(), 'splunk-ide-parent-'));
        await require('simple-git')(parentPath).init();

        const projectPath = path.join(parentPath, 'splunk-project');
        fs.mkdirSync(projectPath);
        writeSplFile(projectPath, 'Search 1.spl', SPL_URL_V1);

        const result = await getFileStatus(require('simple-git')(projectPath), 'Search 1.spl');
        assert.equal(result.status, 'untracked');
        assert.equal(result.hasChanges, true);

        cleanupTempRepo(parentPath);
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

    it('reports modified when staged then edited again', async () => {
        await saveVersion(git, relativePath, 'Initial version');
        writeSplFile(repoPath, relativePath, SPL_URL_V2);
        await git.add(relativePath);
        writeSplFile(repoPath, relativePath, 'http://localhost:8010/en-US/app/search/search?q=search%20index%3Dmain%20warn');

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
        const result = await saveVersion(git, relativePath, 'Save main query');
        assert.equal(result.saved, true);

        const log = await git.log({ file: relativePath });
        assert.equal(log.total, 1);
        assert.equal(log.latest.message, 'Save main query');

        const status = await getFileStatus(git, relativePath);
        assert.equal(status.status, 'clean');

        const otherStatus = await getFileStatus(git, 'other.spl');
        assert.equal(otherStatus.status, 'untracked');
    });

    it('skips commit when file has no changes', async () => {
        await saveVersion(git, relativePath, 'Initial version');
        const result = await saveVersion(git, relativePath, 'Duplicate save');
        assert.equal(result.saved, false);
        assert.equal(result.reason, 'no-changes');

        const log = await git.log({ file: relativePath });
        assert.equal(log.total, 1);
    });

    it('initializes git repo lazily on first save', async () => {
        const barePath = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'splunk-ide-lazy-'));
        const bareGit = require('simple-git')(barePath);
        const lazyPath = 'queries/main.spl';
        writeSplFile(barePath, lazyPath, SPL_URL_V1);

        assert.equal(await bareGit.checkIsRepo(), false);
        const result = await saveVersion(bareGit, lazyPath, 'First version');
        assert.equal(result.saved, true);
        assert.equal(await bareGit.checkIsRepo(), true);

        cleanupTempRepo(barePath);
    });

    it('creates the project repo instead of using a parent repo', async () => {
        const fs = require('node:fs');
        const path = require('node:path');
        const os = require('node:os');
        const parentPath = fs.mkdtempSync(path.join(os.tmpdir(), 'splunk-ide-parent-save-'));
        await require('simple-git')(parentPath).init();

        const projectPath = path.join(parentPath, 'splunk-project');
        fs.mkdirSync(projectPath);
        const childGit = require('simple-git')(projectPath);
        writeSplFile(projectPath, 'Search 1.spl', SPL_URL_V1);

        await saveVersion(childGit, 'Search 1.spl', 'First version');

        assert.equal(fs.existsSync(path.join(projectPath, '.git')), true);
        const versions = await listVersions(childGit, 'Search 1.spl');
        assert.equal(versions.length, 1);

        cleanupTempRepo(parentPath);
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
        const versions = await listVersions(git, relativePath);
        assert.deepEqual(versions, []);
    });

    it('returns version entries with decoded query text', async () => {
        await saveVersion(git, relativePath, 'First save');
        writeSplFile(repoPath, relativePath, SPL_URL_V2);
        await saveVersion(git, relativePath, 'Second save');

        const versions = await listVersions(git, relativePath);
        assert.equal(versions.length, 2);
        assert.equal(versions[0].message, 'Second save');
        assert.equal(versions[0].query, 'index=main error');
        assert.equal(versions[1].message, 'First save');
        assert.equal(versions[1].query, 'index=main');
        assert.match(versions[0].hash, /^[0-9a-f]{40}$/);
    });

    it('returns parentHash when saved with a parent', async () => {
        await saveVersion(git, relativePath, 'First save');
        const [parent] = await listVersions(git, relativePath);

        writeSplFile(repoPath, relativePath, SPL_URL_V2);
        await saveVersion(git, relativePath, 'Child save', parent.hash);

        const versions = await listVersions(git, relativePath);
        assert.equal(versions.length, 2);
        assert.equal(versions[0].message, 'Child save');
        assert.equal(versions[0].parentHash, parent.hash);
        assert.equal(versions[1].parentHash, undefined);
    });

    it('omits parentHash for commits without the trailer', async () => {
        await saveVersion(git, relativePath, 'Standalone save');

        const [version] = await listVersions(git, relativePath);
        assert.equal(version.message, 'Standalone save');
        assert.equal(version.parentHash, undefined);
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
        const versions = await listVersions(git, relativePath);
        const firstHash = versions[1].hash;

        const restored = await restoreVersion(git, relativePath, firstHash);
        assert.equal(restored.query, 'index=main');
        assert.equal(restored.url, SPL_URL_V1);

        const onDisk = readCurrentQuery(require('node:path').join(repoPath, relativePath));
        assert.equal(onDisk.query, 'index=main');
    });

    it('auto-saves dirty changes before restoring an older version', async () => {
        writeSplFile(repoPath, relativePath, 'http://localhost:8010/en-US/app/search/search?q=search%20index%3Dmain%20dirty');
        const versions = await listVersions(git, relativePath);
        const firstHash = versions[1].hash;

        await restoreVersion(git, relativePath, firstHash);

        const log = await git.log({ file: relativePath });
        assert.match(log.latest.message, /Auto-save before restore/);
        assert.equal(log.total, 3);
    });

    it('records parentHash on auto-save before restore when provided', async () => {
        writeSplFile(repoPath, relativePath, 'http://localhost:8010/en-US/app/search/search?q=search%20index%3Dmain%20dirty');
        const versions = await listVersions(git, relativePath);
        const latestHash = versions[0].hash;
        const firstHash = versions[1].hash;

        await restoreVersion(git, relativePath, firstHash, latestHash);

        const [autoSave] = await listVersions(git, relativePath);
        assert.match(autoSave.message, /Auto-save before restore/);
        assert.equal(autoSave.parentHash, latestHash);
    });
});

describe('readCurrentQuery', () => {
    it('returns empty content for missing files', () => {
        const result = readCurrentQuery('/tmp/does-not-exist.spl');
        assert.deepEqual(result, { url: '', query: '' });
    });
});

describe('renameQueryFile', () => {
    let repoPath;
    let git;
    let relativePath;

    beforeEach(async () => {
        ({ repoPath, git, relativePath } = await createTempGitRepo('queries/main.spl', SPL_URL_V1));
        await saveVersion(git, relativePath, 'Initial version');
    });

    afterEach(() => {
        cleanupTempRepo(repoPath);
    });

    it('preserves version history after git mv', async () => {
        const newPath = 'queries/renamed.spl';
        await renameQueryFile(git, repoPath, relativePath, newPath);

        const versions = await listVersions(git, newPath);
        assert.equal(versions.length, 2);
        assert.equal(versions[1].message, 'Initial version');
        assert.equal(versions[1].query, 'index=main');
    });

    it('renames on disk when file is untracked', async () => {
        const barePath = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'splunk-ide-rename-'));
        const bareGit = require('simple-git')(barePath);
        const oldPath = 'draft.spl';
        writeSplFile(barePath, oldPath, SPL_URL_V1);

        await renameQueryFile(bareGit, barePath, oldPath, 'published.spl');

        assert.equal(require('node:fs').existsSync(require('node:path').join(barePath, 'published.spl')), true);
        assert.equal(require('node:fs').existsSync(require('node:path').join(barePath, oldPath)), false);

        cleanupTempRepo(barePath);
    });
});
