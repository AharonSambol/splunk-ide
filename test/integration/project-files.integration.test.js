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
} = require('../../lib/project-files');

describe('project-files integration', () => {
    let projectPath;

    beforeEach(() => {
        projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'splunk-ide-'));
    });

    afterEach(() => {
        fs.rmSync(projectPath, { recursive: true, force: true });
    });

    it('creates a project workspace with nested folders and .spl files', () => {
        const queriesDir = path.join(projectPath, 'queries', 'archive');
        ensureDirectoryExists(fs, queriesDir, path);

        const rootFile = getProjectFilePath(projectPath, 'root', path);
        const nestedFile = getProjectFilePath(projectPath, 'queries/archive/main', path);
        fs.writeFileSync(rootFile, 'https://splunk.example/root', 'utf8');
        fs.writeFileSync(nestedFile, 'https://splunk.example/main', 'utf8');

        assert.equal(fs.existsSync(queriesDir), true);
        assert.equal(fs.readFileSync(rootFile, 'utf8'), 'https://splunk.example/root');
        assert.equal(fs.readFileSync(nestedFile, 'utf8'), 'https://splunk.example/main');
    });

    it('scans project files and folders on disk', () => {
        ensureDirectoryExists(fs, path.join(projectPath, 'queries', 'archive'), path);
        fs.writeFileSync(getProjectFilePath(projectPath, 'root', path), 'url', 'utf8');
        fs.writeFileSync(getProjectFilePath(projectPath, 'queries/main', path), 'url', 'utf8');
        fs.writeFileSync(getProjectFilePath(projectPath, 'queries/archive/old', path), 'url', 'utf8');
        fs.writeFileSync(path.join(projectPath, 'notes.txt'), 'ignore', 'utf8');
        fs.mkdirSync(path.join(projectPath, '.git'));
        fs.writeFileSync(path.join(projectPath, '.git', 'config'), 'ignore', 'utf8');

        const files = scanProjectFiles(fs, path, projectPath).sort();
        const folders = scanProjectFolders(fs, path, projectPath, projectPath).sort();

        assert.deepEqual(files, [
            path.join(projectPath, 'queries', 'archive', 'old.spl'),
            path.join(projectPath, 'queries', 'main.spl'),
            path.join(projectPath, 'root.spl'),
        ]);
        assert.deepEqual(folders, ['queries', 'queries/archive']);
    });

    it('moves a file using move target helpers and renameSync', () => {
        const sourceRelative = 'queries/main';
        const sourcePath = getProjectFilePath(projectPath, sourceRelative, path);
        ensureDirectoryExists(fs, path.dirname(sourcePath), path);
        fs.writeFileSync(sourcePath, 'https://splunk.example/main', 'utf8');

        const destinationPath = getMoveTargetPath(
            projectPath,
            `${sourceRelative}.spl`,
            'archive',
            path
        );
        ensureDirectoryExists(fs, path.dirname(destinationPath), path);
        fs.renameSync(sourcePath, destinationPath);

        assert.equal(fs.existsSync(sourcePath), false);
        assert.equal(fs.existsSync(destinationPath), true);
        assert.equal(fs.readFileSync(destinationPath, 'utf8'), 'https://splunk.example/main');
        assert.deepEqual(scanProjectFiles(fs, path, projectPath), [destinationPath]);
        assert.deepEqual(scanProjectFolders(fs, path, projectPath, projectPath).sort(), [
            'archive',
            'queries',
        ]);
    });

    it('renames a file on disk using normalized paths from helpers', () => {
        const oldRelative = normalizeRelativePath('queries\\main');
        const oldPath = getProjectFilePath(projectPath, oldRelative, path);
        ensureDirectoryExists(fs, path.dirname(oldPath), path);
        fs.writeFileSync(oldPath, 'https://splunk.example/main', 'utf8');

        const newPath = getProjectFilePath(projectPath, 'queries/renamed-main', path);
        fs.renameSync(oldPath, newPath);

        assert.equal(fs.existsSync(oldPath), false);
        assert.equal(fs.existsSync(newPath), true);
        assert.deepEqual(scanProjectFiles(fs, path, projectPath), [newPath]);
    });

    it('documents delete flows as renderer-level integration (helpers have no delete API)', () => {
        const filePath = getProjectFilePath(projectPath, 'temporary', path);
        fs.writeFileSync(filePath, 'url', 'utf8');
        assert.equal(fs.existsSync(filePath), true);

        // Renderer uses fs.unlinkSync / recursive folder removal directly.
        // Future renderer-level integration tests should cover deleteFile/deleteFolder.
        fs.unlinkSync(filePath);
        assert.equal(fs.existsSync(filePath), false);
        assert.deepEqual(scanProjectFiles(fs, path, projectPath), []);
    });
});
