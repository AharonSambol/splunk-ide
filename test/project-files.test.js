const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
    normalizeRelativePath,
    getProjectFilePath,
    ensureDirectoryExists,
    scanProjectFiles,
    scanProjectFolders,
    getMoveTargetPath,
} = require('../lib/project-files');

describe('normalizeRelativePath', () => {
    it('converts backslashes and trims whitespace', () => {
        assert.equal(normalizeRelativePath('  queries\\main  '), 'queries/main');
    });
});

describe('getProjectFilePath', () => {
    it('joins project path and adds .spl extension', () => {
        const projectPath = '/tmp/project';
        assert.equal(
            getProjectFilePath(projectPath, 'queries/main', path),
            path.join(projectPath, 'queries', 'main.spl')
        );
    });

    it('sanitizes invalid path characters', () => {
        const projectPath = '/tmp/project';
        const result = getProjectFilePath(projectPath, 'bad<file>:name', path);
        assert.equal(result, path.join(projectPath, 'bad_file__name.spl'));
    });

    it('preserves existing .spl extension', () => {
        const projectPath = '/tmp/project';
        assert.equal(
            getProjectFilePath(projectPath, 'main.spl', path),
            path.join(projectPath, 'main.spl')
        );
    });
});

describe('ensureDirectoryExists', () => {
    let tempDir;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'splunk-ide-test-'));
    });

    afterEach(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('creates nested directories', () => {
        const nested = path.join(tempDir, 'a', 'b', 'c');
        ensureDirectoryExists(fs, nested, path);
        assert.equal(fs.existsSync(nested), true);
    });

    it('is a no-op when directory already exists', () => {
        ensureDirectoryExists(fs, tempDir, path);
        assert.equal(fs.existsSync(tempDir), true);
    });
});

describe('scanProjectFiles', () => {
    let tempDir;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'splunk-ide-scan-'));
        fs.mkdirSync(path.join(tempDir, 'queries'));
        fs.writeFileSync(path.join(tempDir, 'root.spl'), 'url');
        fs.writeFileSync(path.join(tempDir, 'queries', 'main.spl'), 'url');
        fs.writeFileSync(path.join(tempDir, 'queries', 'readme.txt'), 'ignore');
        fs.mkdirSync(path.join(tempDir, '.git'));
        fs.writeFileSync(path.join(tempDir, '.git', 'config'), 'ignore');
    });

    afterEach(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('finds .spl files recursively and skips .git', () => {
        const results = scanProjectFiles(fs, path, tempDir).sort();
        assert.deepEqual(results, [
            path.join(tempDir, 'queries', 'main.spl'),
            path.join(tempDir, 'root.spl'),
        ]);
    });
});

describe('scanProjectFolders', () => {
    let tempDir;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'splunk-ide-folders-'));
        fs.mkdirSync(path.join(tempDir, 'queries'));
        fs.mkdirSync(path.join(tempDir, 'queries', 'archive'));
        fs.mkdirSync(path.join(tempDir, '.git'));
    });

    afterEach(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('returns relative folder paths with forward slashes', () => {
        const results = scanProjectFolders(fs, path, tempDir, tempDir).sort();
        assert.deepEqual(results, ['queries', 'queries/archive']);
    });
});

describe('getMoveTargetPath', () => {
    it('builds destination path for a file moved into a folder', () => {
        const projectPath = '/tmp/project';
        const result = getMoveTargetPath(projectPath, 'queries/main.spl', 'archive', path);
        assert.equal(result, path.join(projectPath, 'archive', 'main.spl'));
    });

    it('builds destination path for a file moved to root', () => {
        const projectPath = '/tmp/project';
        const result = getMoveTargetPath(projectPath, 'queries/main.spl', '', path);
        assert.equal(result, path.join(projectPath, 'main.spl'));
    });
});
