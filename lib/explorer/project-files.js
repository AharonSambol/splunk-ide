'use strict';

function normalizeRelativePath(name) {
    return name.replaceAll('\\', '/').trim();
}

function getProjectFilePath(projectPath, fileName, pathModule = require('node:path')) {
    const normalizedRelative = pathModule
        .normalize(fileName)
        .split(pathModule.sep)
        .filter(segment => segment && segment !== '..')
        .map(segment => segment.replace(/[<>:"|?*]/g, '_'))
        .join(pathModule.sep);
    let filePath = pathModule.join(projectPath, normalizedRelative);
    if (!pathModule.extname(filePath)) {
        filePath += '.spl';
    }
    return filePath;
}

function ensureDirectoryExists(fs, directoryPath, pathModule = require('node:path')) {
    if (!fs.existsSync(directoryPath)) {
        ensureDirectoryExists(fs, pathModule.dirname(directoryPath), pathModule);
        fs.mkdirSync(directoryPath);
    }
}

function scanProjectFiles(fs, pathModule, directory) {
    let results = [];
    fs.readdirSync(directory, { withFileTypes: true }).forEach(dirent => {
        if (dirent.name === '.git') {
            return;
        }
        const fullPath = pathModule.join(directory, dirent.name);
        if (dirent.isDirectory()) {
            results = results.concat(scanProjectFiles(fs, pathModule, fullPath));
        } else if (dirent.isFile() && pathModule.extname(dirent.name).toLowerCase() === '.spl') {
            results.push(fullPath);
        }
    });
    return results;
}

function scanProjectFolders(fs, pathModule, directory, projectPath) {
    let results = [];
    fs.readdirSync(directory, { withFileTypes: true }).forEach(dirent => {
        const fullPath = pathModule.join(directory, dirent.name);
        if (dirent.isDirectory() && dirent.name !== '.git') {
            const relativePath = pathModule.relative(projectPath, fullPath).split(pathModule.sep).join('/');
            results.push(relativePath);
            results = results.concat(scanProjectFolders(fs, pathModule, fullPath, projectPath));
        }
    });
    return results;
}

function getMoveTargetPath(projectPath, fileName, targetFolder, pathModule = require('node:path')) {
    const baseName = fileName.split('/').pop();
    const newRelativeName = targetFolder ? `${targetFolder}/${baseName}` : baseName;
    return getProjectFilePath(projectPath, newRelativeName, pathModule);
}

module.exports = {
    normalizeRelativePath,
    getProjectFilePath,
    ensureDirectoryExists,
    scanProjectFiles,
    scanProjectFolders,
    getMoveTargetPath,
};
