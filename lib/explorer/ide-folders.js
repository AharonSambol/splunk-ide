'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { getSavedSearchId } = require('../objects/saved-search-id');

const IDE_FOLDERS_FILE = 'ide-folders.json';

function sanitizeFolderName(name) {
    return String(name ?? '')
        .trim()
        .replace(/[/\\]+/g, '-')
        .replace(/\s+/g, ' ');
}

function explorerIdForFile(file) {
    if (file?.savedSearch) {
        return getSavedSearchId(file.savedSearch);
    }
    return `file:${file?.name || ''}`;
}

function normalizeIdeFolders(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
        return {};
    }
    const out = {};
    for (const [rawName, rawIds] of Object.entries(input)) {
        const name = sanitizeFolderName(rawName);
        if (!name) {
            continue;
        }
        const seen = new Set(out[name] || []);
        const ids = Array.isArray(rawIds) ? rawIds : [];
        out[name] = out[name] || [];
        for (const id of ids) {
            const value = String(id ?? '').trim();
            if (!value || seen.has(value)) {
                continue;
            }
            seen.add(value);
            out[name].push(value);
        }
    }
    return out;
}

function folderNames(folders) {
    return Object.keys(normalizeIdeFolders(folders)).sort((a, b) => (
        a.localeCompare(b, undefined, { sensitivity: 'base' })
    ));
}

function folderForId(folders, id) {
    const normalized = normalizeIdeFolders(folders);
    for (const [name, ids] of Object.entries(normalized)) {
        if (ids.includes(id)) {
            return name;
        }
    }
    return '';
}

function createFolder(folders, name) {
    const key = sanitizeFolderName(name);
    if (!key) {
        return normalizeIdeFolders(folders);
    }
    const next = normalizeIdeFolders(folders);
    if (!next[key]) {
        next[key] = [];
    }
    return next;
}

function deleteFolder(folders, name) {
    const next = normalizeIdeFolders(folders);
    delete next[sanitizeFolderName(name)];
    return next;
}

function setItemFolder(folders, id, folderName) {
    const itemId = String(id ?? '').trim();
    const next = {};
    for (const [name, ids] of Object.entries(normalizeIdeFolders(folders))) {
        next[name] = ids.filter(existing => existing !== itemId);
    }
    const dest = sanitizeFolderName(folderName);
    if (itemId && dest) {
        if (!next[dest]) {
            next[dest] = [];
        }
        next[dest].push(itemId);
    }
    return next;
}

function replaceItemId(folders, oldId, newId) {
    const from = String(oldId ?? '').trim();
    const to = String(newId ?? '').trim();
    if (!from || !to || from === to) {
        return normalizeIdeFolders(folders);
    }
    const next = {};
    for (const [name, ids] of Object.entries(normalizeIdeFolders(folders))) {
        next[name] = ids.map(id => (id === from ? to : id));
    }
    return normalizeIdeFolders(next);
}

function pruneIdeFolders(folders, knownIds) {
    const known = new Set(knownIds);
    const next = {};
    for (const [name, ids] of Object.entries(normalizeIdeFolders(folders))) {
        next[name] = ids.filter(id => known.has(id));
    }
    return next;
}

function toExplorerInput(files, folders) {
    const map = normalizeIdeFolders(folders);
    return {
        fileList: files.map(file => {
            const displayName = String(file.name || '').split('/').pop() || file.name;
            const folder = folderForId(map, explorerIdForFile(file));
            return {
                ...file,
                displayName,
                name: folder ? `${folder}/${displayName}` : displayName,
            };
        }),
        folderList: Object.keys(map),
    };
}

function ideFoldersPath(projectPath) {
    return path.join(projectPath, IDE_FOLDERS_FILE);
}

function readIdeFolders(projectPath) {
    try {
        return normalizeIdeFolders(JSON.parse(fs.readFileSync(ideFoldersPath(projectPath), 'utf8')));
    } catch {
        return {};
    }
}

function writeIdeFolders(projectPath, folders) {
    fs.writeFileSync(
        ideFoldersPath(projectPath),
        `${JSON.stringify(normalizeIdeFolders(folders), null, 2)}\n`
    );
}

module.exports = {
    IDE_FOLDERS_FILE,
    sanitizeFolderName,
    explorerIdForFile,
    normalizeIdeFolders,
    folderNames,
    folderForId,
    createFolder,
    deleteFolder,
    setItemFolder,
    replaceItemId,
    pruneIdeFolders,
    toExplorerInput,
    readIdeFolders,
    writeIdeFolders,
};
