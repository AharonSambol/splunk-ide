const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const {
    ensureRepo,
    getFileStatus,
    saveVersion,
    listVersions,
    restoreVersion,
    readCurrentQuery,
    renameQueryFile,
    consumeAutoSave,
    setVersionTag,
    listVersionTags,
    versionTagRef
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

    it('detects isAutoSave when body has both Query-Parent and Query-Autosave trailers', async () => {
        await saveVersion(git, relativePath, 'First save');
        writeSplFile(repoPath, relativePath, SPL_URL_V2);
        await saveVersion(git, relativePath, 'Second save');

        writeSplFile(repoPath, relativePath, 'http://localhost:8010/en-US/app/search/search?q=search%20index%3Dmain%20dirty');
        const versions = await listVersions(git, relativePath);
        await restoreVersion(git, relativePath, versions[1].hash, versions[0].hash);

        const [autoSave] = await listVersions(git, relativePath);
        assert.match(autoSave.message, /Auto-save before restore/);
        assert.equal(autoSave.parentHash, versions[0].hash);
        assert.equal(autoSave.isAutoSave, true);
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

    it('marks auto-save before restore with isAutoSave', async () => {
        writeSplFile(repoPath, relativePath, 'http://localhost:8010/en-US/app/search/search?q=search%20index%3Dmain%20dirty');
        const versions = await listVersions(git, relativePath);
        const firstHash = versions[1].hash;

        await restoreVersion(git, relativePath, firstHash);

        const [autoSave] = await listVersions(git, relativePath);
        assert.equal(autoSave.isAutoSave, true);
        assert.equal(autoSave.isConsumedAutoSave, undefined);
    });

    it('hides consumed auto-save from listVersions by default', async () => {
        writeSplFile(repoPath, relativePath, 'http://localhost:8010/en-US/app/search/search?q=search%20index%3Dmain%20dirty');
        const versions = await listVersions(git, relativePath);
        const firstHash = versions[1].hash;

        await restoreVersion(git, relativePath, firstHash);

        const beforeConsume = await listVersions(git, relativePath);
        assert.equal(beforeConsume.length, 3);
        const autoSaveHash = beforeConsume[0].hash;

        await consumeAutoSave(git, autoSaveHash);

        const afterConsume = await listVersions(git, relativePath);
        assert.equal(afterConsume.length, 2);
        assert.ok(!afterConsume.some(version => version.hash === autoSaveHash));

        const withConsumed = await listVersions(git, relativePath, 30, { includeConsumedAutoSaves: true });
        const consumed = withConsumed.find(version => version.hash === autoSaveHash);
        assert.equal(consumed.isAutoSave, true);
        assert.equal(consumed.isConsumedAutoSave, true);
    });

    it('can restore without creating an auto-save when requested', async () => {
        writeSplFile(repoPath, relativePath, 'http://localhost:8010/en-US/app/search/search?q=search%20index%3Dmain%20dirty');
        const versions = await listVersions(git, relativePath);
        const firstHash = versions[1].hash;

        await restoreVersion(git, relativePath, firstHash, undefined, { skipAutoSave: true });

        const afterRestore = await listVersions(git, relativePath);
        assert.equal(afterRestore.length, 2);
        assert.equal(afterRestore.some(version => version.isAutoSave), false);
    });

    it('does not create auto-save when jumping forward without user draft edits', async () => {
        const versions = await listVersions(git, relativePath);
        const firstHash = versions[1].hash;
        const latestHash = versions[0].hash;

        await restoreVersion(git, relativePath, firstHash, latestHash, { skipAutoSave: true });
        await restoreVersion(git, relativePath, latestHash, latestHash, { skipAutoSave: true });

        const afterJump = await listVersions(git, relativePath);
        assert.equal(afterJump.length, 2);
        assert.equal(afterJump.some(version => version.isAutoSave), false);
    });
});

describe('readCurrentQuery', () => {
    it('returns empty content for missing files', () => {
        const result = readCurrentQuery('/tmp/does-not-exist.spl');
        assert.deepEqual(result, { url: '', query: '' });
    });
});

describe('version tags', () => {
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

    it('creates and lists an annotated tag for a commit', async () => {
        const [version] = await listVersions(git, relativePath);
        const { ref } = await setVersionTag(git, relativePath, version.hash, 'v1.0');

        assert.equal(ref, 'search-tag/queries--main.spl/v1.0');

        const tags = await listVersionTags(git, relativePath);
        assert.equal(tags.length, 1);
        assert.equal(tags[0].name, 'v1.0');
        assert.equal(tags[0].hash, version.hash);
        assert.match(tags[0].date, /^\d{4}-\d{2}-\d{2}T/);

        const show = await git.show([ref]);
        assert.match(show, /^tag search-tag\/queries--main\.spl\/v1\.0/);
        assert.match(show, /\nv1\.0\n/);
    });

    it('scopes the same tag name to each relative path', async () => {
        const otherPath = 'queries/other.spl';
        writeSplFile(repoPath, otherPath, SPL_URL_V2);
        await saveVersion(git, otherPath, 'Other version');

        const [mainVersion] = await listVersions(git, relativePath);
        const [otherVersion] = await listVersions(git, otherPath);

        await setVersionTag(git, relativePath, mainVersion.hash, 'release');
        await setVersionTag(git, otherPath, otherVersion.hash, 'release');

        assert.equal(
            versionTagRef(relativePath, 'release'),
            'search-tag/queries--main.spl/release'
        );
        assert.equal(
            versionTagRef(otherPath, 'release'),
            'search-tag/queries--other.spl/release'
        );

        const mainTags = await listVersionTags(git, relativePath);
        const otherTags = await listVersionTags(git, otherPath);

        assert.equal(mainTags.length, 1);
        assert.equal(otherTags.length, 1);
        assert.equal(mainTags[0].name, 'release');
        assert.equal(otherTags[0].name, 'release');
        assert.equal(mainTags[0].hash, mainVersion.hash);
        assert.equal(otherTags[0].hash, otherVersion.hash);
        assert.notEqual(mainTags[0].hash, otherTags[0].hash);
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
