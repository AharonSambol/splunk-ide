'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { ipcRenderer } = require('electron');
const { parseSavedSearchFromUrl, withSplunkOrigin } = require('../lib/url-utils');
const { getSavedSearchId } = require('../lib/objects/saved-search-id');
const { saveVersion } = require('../lib/git/query-versions');
const {
    IDE_FOLDERS_FILE,
    explorerIdForFile,
    folderNames,
    pruneIdeFolders,
    readIdeFolders,
    writeIdeFolders,
} = require('../lib/explorer/ide-folders');
const { getGitAuthorFromSettings } = require('./git-settings');
const { hideNewItemMenu } = require('./explorer-modals');
const state = require('./state');
const {
    newFileBtn,
    newFolderBtn,
    projectNameLabel,
    tabBar,
} = require('./dom');

let openFile;
let updateExplorer;
let scanProjectFiles;
let initializeQueryVersions;
let applySavedSearchToFile;

function attachExplorerProject(deps) {
    ({
        openFile = openFile,
        updateExplorer = updateExplorer,
        scanProjectFiles = scanProjectFiles,
        initializeQueryVersions = initializeQueryVersions,
        applySavedSearchToFile = applySavedSearchToFile,
    } = deps);
}

const EXPLORER_COLLAPSED_KEY = 'splunk-ide-explorer-collapsed';

function openStartupSearch() {
    let fileId = state.fileMru.find(id => state.files.some(file => file.id === id));
    if (!fileId) {
        const sorted = [...state.files].sort((a, b) => {
            const aMtime = fs.statSync(a.path).mtimeMs;
            const bMtime = fs.statSync(b.path).mtimeMs;
            return bMtime - aMtime;
        });
        fileId = sorted[0]?.id;
    }
    if (fileId) {
        openFile(fileId);
    }
}

async function createNewProject() {
    const result = await ipcRenderer.invoke('select-project-folder', {
        title: 'Select a folder for the new project',
        buttonLabel: 'Create',
        properties: ['openDirectory', 'createDirectory']
    });

    if (result.canceled || !result.filePaths.length) {
        return;
    }

    await loadProject(result.filePaths[0]);
}

async function openProject() {
    const result = await ipcRenderer.invoke('select-project-folder', {
        title: 'Open an existing project folder',
        buttonLabel: 'Open',
        properties: ['openDirectory']
    });

    if (result.canceled || !result.filePaths.length) {
        return;
    }

    await loadProject(result.filePaths[0]);
}

async function loadProject(projectPath) {
    state.currentProjectPath = projectPath;
    state.currentProjectName = path.basename(projectPath);
    updateProjectDisplay();
    await initializeQueryVersions();

    state.files = [];
    state.folders = [];
    state.ideFolders = {};
    state.fileMru = [];
    state.activeFileId = null;
    state.restoreParentByFileId.clear();
    state.forcedDraftByFileId.clear();
    state.userDraftByFileId.clear();
    clearOpenTabs();

    const filePaths = scanProjectFiles(state.currentProjectPath);
    const sortedPaths = [...filePaths].sort((left, right) => {
        const leftCanonical = left.includes(`${path.sep}saved-searches${path.sep}`) ? 0 : 1;
        const rightCanonical = right.includes(`${path.sep}saved-searches${path.sep}`) ? 0 : 1;
        return leftCanonical - rightCanonical;
    });
    const seenSavedSearchIds = new Set();
    for (const filePath of sortedPaths) {
        const url = withSplunkOrigin(fs.readFileSync(filePath, 'utf8').trim() || state.SPLUNK_URL, state.SPLUNK_URL);
        const name = path.relative(projectPath, filePath).replace(/\.spl$/i, '').split(path.sep).join('/');
        const savedSearch = parseSavedSearchFromUrl(url);
        if (savedSearch) {
            const searchId = getSavedSearchId(savedSearch);
            if (seenSavedSearchIds.has(searchId)) {
                continue;
            }
            seenSavedSearchIds.add(searchId);
        }
        const fileRecord = { id: `splunk-view-${Date.now()}-${Math.random()}`, name, path: filePath, url };
        if (savedSearch) {
            fileRecord.savedSearch = savedSearch;
            state.files.push(fileRecord);
            await applySavedSearchToFile(fileRecord, savedSearch, url);
        } else {
            state.files.push(fileRecord);
        }
    }

    loadIdeFoldersFromProject();
    loadCollapsedExplorerFolders();
    updateExplorer();
}

function clearOpenTabs() {
    while (tabBar.firstChild) {
        tabBar.firstChild.remove();
    }
    document.querySelectorAll('webview').forEach(view => view.remove());
}

function syncFolderList() {
    state.folders = folderNames(state.ideFolders);
}

function collapsedFoldersStorageKey() {
    return `${EXPLORER_COLLAPSED_KEY}:${state.currentProjectPath || ''}`;
}

function loadCollapsedExplorerFolders() {
    try {
        state.collapsedExplorerFolders = new Set(JSON.parse(localStorage.getItem(collapsedFoldersStorageKey()) || '[]'));
    } catch {
        state.collapsedExplorerFolders = new Set();
    }
}

function persistCollapsedExplorerFolders() {
    localStorage.setItem(collapsedFoldersStorageKey(), JSON.stringify([...state.collapsedExplorerFolders]));
}

async function persistIdeFolders() {
    if (!state.currentProjectPath) {
        return;
    }
    writeIdeFolders(state.currentProjectPath, state.ideFolders);
    if (!state.currentGit) {
        return;
    }
    try {
        await saveVersion(state.currentGit, IDE_FOLDERS_FILE, 'Update search folders', undefined, {
            author: getGitAuthorFromSettings(),
        });
    } catch (err) {
        console.error('Failed to commit search folders', err);
    }
}

function loadIdeFoldersFromProject() {
    const knownIds = state.files.map(explorerIdForFile);
    state.ideFolders = pruneIdeFolders(readIdeFolders(state.currentProjectPath), knownIds);
    syncFolderList();
}

function updateProjectDisplay() {
    projectNameLabel.textContent = state.currentProjectPath ? state.currentProjectName : 'No project loaded';
    projectNameLabel.title = state.currentProjectPath || '';
    newFileBtn.disabled = !state.currentProjectPath;
    newFolderBtn.disabled = !state.currentProjectPath;
    if (!state.currentProjectPath) {
        hideNewItemMenu();
    }
}

module.exports = {
    attachExplorerProject,
    EXPLORER_COLLAPSED_KEY,
    openStartupSearch,
    createNewProject,
    openProject,
    loadProject,
    clearOpenTabs,
    syncFolderList,
    collapsedFoldersStorageKey,
    loadCollapsedExplorerFolders,
    persistCollapsedExplorerFolders,
    persistIdeFolders,
    loadIdeFoldersFromProject,
    updateProjectDisplay,
};
