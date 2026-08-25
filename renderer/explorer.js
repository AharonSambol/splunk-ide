'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { ipcRenderer } = require('electron');
const { buildFileTree } = require('../lib/file-tree');
const {
    normalizeRelativePath,
    getProjectFilePath: buildProjectFilePath,
    ensureDirectoryExists: ensureProjectDirectoryExists,
    scanProjectFiles: scanProjectFilesOnDisk,
    scanProjectFolders: scanProjectFoldersOnDisk,
} = require('../lib/project-files');
const { parseSavedSearchFromUrl, getFileFolder, withSplunkOrigin } = require('../lib/url-utils');
const { getSavedSearchId } = require('../lib/objects/saved-search-id');
const { getDashboardViewPath } = require('../lib/objects/object-paths');
const { saveVersion, renameQueryFile } = require('../lib/git/query-versions');
const { renderExplorer } = require('../lib/render-explorer');
const {
    IDE_FOLDERS_FILE,
    explorerIdForFile,
    folderNames,
    folderForId,
    createFolder: addIdeFolder,
    deleteFolder: removeIdeFolder,
    setItemFolder,
    pruneIdeFolders,
    toExplorerInput,
    readIdeFolders,
    writeIdeFolders,
} = require('../lib/ide-folders');
const { getGitAuthorFromSettings } = require('./git-settings');
const state = require('./state');
const {
    newFileBtn,
    newItemMenu,
    newSearchChoice,
    newFolderBtn,
    newProjectBtn,
    openProjectBtn,
    projectNameLabel,
    tabBar,
    explorer,
    newFileModal,
    newFileModalLabel,
    newFileModalInput,
    newFileFolderRow,
    newFileFolderSelect,
    newFileCreateBtn,
    newFileCancelBtn,
} = require('./dom');

const EXPLORER_COLLAPSED_KEY = 'splunk-ide-explorer-collapsed';

let createTab;
let createView;
let closeTab;
let switchToFile;
let initializeQueryVersions;
let onQueryFileChanged;
let applySavedSearchToFile;
let updateTabLabel;

function getDashboardViewRelativePath(dashboard) {
    return getDashboardViewPath({
        instance: dashboard.instance,
        app: dashboard.app,
        owner: dashboard.owner,
        name: dashboard.name,
        ext: dashboard.ext || 'xml'
    });
}

function getDiskRelativePath(file) {
    if (file.dashboard) {
        return getDashboardViewRelativePath(file.dashboard);
    }
    return path.relative(state.currentProjectPath, file.path).split(path.sep).join('/');
}

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

function createFileWithUrl(name, url, parentFolder = '') {
    if (!state.currentProjectPath) {
        alert('Please create or open a project before creating files.');
        return;
    }

    const savedSearch = parseSavedSearchFromUrl(url);
    const normalizedFileName = normalizeRelativePath(name);
    const fileId = `splunk-view-${Date.now()}-${state.fileCounter}`;
    state.fileCounter++;

    const relativeFileName = parentFolder ? `${parentFolder}/${normalizedFileName}` : normalizedFileName;
    const filePath = getProjectFilePath(relativeFileName);

    ensureDirectoryExists(path.dirname(filePath));
    fs.writeFileSync(filePath, url, 'utf8');

    const file = { id: fileId, name: relativeFileName, path: filePath, url };
    if (savedSearch) {
        file.savedSearch = savedSearch;
    }
    state.files.push(file);
    state.fileMru.unshift(fileId);

    createTab(file);
    createView(file);
    updateExplorer();
    switchToFile(fileId);
    onQueryFileChanged(fileId);
}

function createNewFile(name, parentFolder = '') {
    if (!state.currentProjectPath) {
        alert('Please create or open a project before creating files.');
        return;
    }

    const defaultName = `Search ${state.fileCounter}`;
    const fileName = name ? name.trim() || defaultName : defaultName;
    const normalizedFileName = normalizeRelativePath(fileName);
    const fileId = `splunk-view-${Date.now()}-${state.fileCounter}`;
    state.fileCounter++;

    const relativeFileName = parentFolder ? `${parentFolder}/${normalizedFileName}` : normalizedFileName;
    const filePath = getProjectFilePath(relativeFileName);
    ensureDirectoryExists(path.dirname(filePath));
    fs.writeFileSync(filePath, state.SPLUNK_URL, 'utf8');

    const file = { id: fileId, name: relativeFileName, path: filePath, url: state.SPLUNK_URL };
    state.files.push(file);
    state.fileMru.unshift(fileId);

    createTab(file);
    createView(file);
    updateExplorer();
    switchToFile(fileId);
    onQueryFileChanged(fileId);
}

function createNewFolder(name) {
    if (!state.currentProjectPath) {
        alert('Please create or open a project before creating folders.');
        return;
    }

    const next = addIdeFolder(state.ideFolders, name);
    if (JSON.stringify(next) === JSON.stringify(state.ideFolders)) {
        return;
    }
    state.ideFolders = next;
    syncFolderList();
    void persistIdeFolders();
    updateExplorer();
}

function deleteFile(fileId) {
    if (!confirm('Delete this file? This will remove it from disk.')) {
        return;
    }

    closeTab(fileId);
    removeFile(fileId, true);
}

function deleteFolder(folderPath) {
    if (!confirm(`Remove folder "${folderPath}"? Searches stay in the list.`)) {
        return;
    }

    state.ideFolders = removeIdeFolder(state.ideFolders, folderPath);
    syncFolderList();
    state.collapsedExplorerFolders.delete(folderPath);
    persistCollapsedExplorerFolders();
    void persistIdeFolders();
    updateExplorer();
}

function removeFile(fileId, deleteFromDisk = false) {
    const wasActive = state.activeFileId === fileId;
    const file = state.files.find(f => f.id === fileId);
    state.files = state.files.filter(file => file.id !== fileId);
    state.fileMru = state.fileMru.filter(id => id !== fileId);

    if (file) {
        state.ideFolders = pruneIdeFolders(state.ideFolders, state.files.map(explorerIdForFile));
        syncFolderList();
        void persistIdeFolders();
    }

    if (deleteFromDisk && file?.path && fs.existsSync(file.path)) {
        fs.unlinkSync(file.path);
    }

    updateExplorer();

    if (wasActive) {
        const remainingTabs = Array.from(tabBar.querySelectorAll('.tab'));
        if (remainingTabs.length > 0) {
            switchToFile(remainingTabs[0].dataset.targetId);
        } else {
            state.activeFileId = null;
            if (state.files.length > 0) {
                openFile(state.files[0].id);
            }
        }
    }
}

function openFile(fileId) {
    const file = state.files.find(f => f.id === fileId);
    if (!file) {
        return;
    }

    const existingTab = tabBar.querySelector(`.tab[data-target-id="${fileId}"]`);
    if (!existingTab) {
        createTab(file);
        createView(file);
        updateExplorer();
    }

    switchToFile(fileId);
}

function getProjectFilePath(fileName) {
    return buildProjectFilePath(state.currentProjectPath, fileName, path);
}

function ensureDirectoryExists(directoryPath) {
    ensureProjectDirectoryExists(fs, directoryPath, path);
}

function scanProjectFiles(directory) {
    return scanProjectFilesOnDisk(fs, path, directory);
}

function scanProjectFolders(directory) {
    return scanProjectFoldersOnDisk(fs, path, directory, state.currentProjectPath);
}

function populateFolderSelect(selectedValue = '') {
    newFileFolderSelect.innerHTML = '';
    const rootOption = document.createElement('option');
    rootOption.value = '';
    rootOption.textContent = 'Root';
    newFileFolderSelect.appendChild(rootOption);

    const sortedFolders = [...state.folders].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    sortedFolders.forEach(folderPath => {
        const option = document.createElement('option');
        option.value = folderPath;
        option.textContent = folderPath;
        if (folderPath === selectedValue) {
            option.selected = true;
        }
        newFileFolderSelect.appendChild(option);
    });
}

function getSelectedFolder() {
    return newFileFolderSelect.value || '';
}

function openMoveFileModal(file) {
    state.modalMode = 'move';
    state.modalTargetFileId = file.id;
    newFileModalLabel.textContent = `Move "${file.name.split('/').pop()}" to folder`;
    newFileModalInput.value = file.name.split('/').pop();
    newFileModalInput.disabled = true;
    populateFolderSelect(folderForId(state.ideFolders, explorerIdForFile(file)));
    showNewFileModal();
}

async function moveFile(fileId, targetFolder) {
    const file = state.files.find(f => f.id === fileId);
    if (!file) {
        return;
    }

    state.ideFolders = setItemFolder(state.ideFolders, explorerIdForFile(file), targetFolder);
    syncFolderList();
    await persistIdeFolders();
    updateExplorer();
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

function hideNewItemMenu() {
    newItemMenu.classList.remove('visible');
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

function openNewFileModal() {
    state.modalMode = 'create';
    state.modalTargetFileId = null;
    newFileModalLabel.textContent = 'New Search';
    newFileModalInput.value = `Search ${state.fileCounter}`;
    showNewFileModal();
}

function openNewFolderModal() {
    state.modalMode = 'folder';
    state.modalTargetFileId = null;
    newFileModalLabel.textContent = 'New Folder Name';
    newFileModalInput.value = '';
    showNewFileModal();
}

function openRenameModal(file) {
    state.modalMode = 'rename';
    state.modalTargetFileId = file.id;
    newFileModalLabel.textContent = `Rename "${file.name.split('/').pop()}"`;
    newFileModalInput.value = file.name;
    showNewFileModal();
}

function showNewFileModal() {
    if (state.modalMode === 'rename') {
        newFileModalLabel.textContent = `Rename "${state.files.find(f => f.id === state.modalTargetFileId)?.name.split('/').pop() || ''}"`;
        newFileFolderRow.style.display = 'none';
        newFileModalInput.disabled = false;
    } else if (state.modalMode === 'folder') {
        newFileModalLabel.textContent = 'New Folder Name';
        newFileFolderRow.style.display = 'none';
        newFileModalInput.disabled = false;
    } else if (state.modalMode === 'move') {
        newFileModalLabel.textContent = `Move "${state.files.find(f => f.id === state.modalTargetFileId)?.name.split('/').pop() || ''}" to folder`;
        newFileFolderRow.style.display = 'block';
        newFileModalInput.disabled = true;
    } else {
        newFileModalLabel.textContent = 'New Search';
        newFileFolderRow.style.display = 'none';
        newFileModalInput.disabled = false;
    }

    if (state.modalMode === 'rename') {
        newFileCreateBtn.textContent = 'Rename';
    } else if (state.modalMode === 'move') {
        newFileCreateBtn.textContent = 'Move';
    } else if (state.modalMode === 'folder') {
        newFileCreateBtn.textContent = 'Create Folder';
    } else {
        newFileCreateBtn.textContent = 'Create';
    }
    newFileModalInput.placeholder = state.modalMode === 'folder' ? 'Folder name' : 'Enter file name or path';
    newFileModal.classList.add('visible');
    setTimeout(() => {
        newFileModalInput.select();
        newFileModalInput.focus();
    }, 0);
}

async function renameFile(fileId, newName) {
    const file = state.files.find(f => f.id === fileId);
    if (!file) {
        return;
    }

    const trimmed = newName ? newName.trim() : '';
    if (!trimmed) {
        return;
    }

    const folder = getFileFolder(file.name);
    const baseName = trimmed.includes('/') ? trimmed.split('/').pop() : trimmed;
    const newRelativeName = folder && !trimmed.includes('/')
        ? `${folder}/${baseName}`
        : trimmed.replaceAll('\\', '/');
    const newPath = getProjectFilePath(newRelativeName);
    const oldRelative = getDiskRelativePath(file);

    if (newPath === file.path) {
        return;
    }

    if (state.currentGit) {
        await renameQueryFile(
            state.currentGit,
            state.currentProjectPath,
            oldRelative,
            path.relative(state.currentProjectPath, newPath).split(path.sep).join('/')
        );
    } else {
        ensureDirectoryExists(path.dirname(newPath));
        fs.renameSync(file.path, newPath);
    }

    file.name = newRelativeName;
    file.path = newPath;
    updateTabLabel(file);
    updateExplorer();
    onQueryFileChanged(fileId, { refreshHistory: true });
}

function closeNewFileModal() {
    newFileModal.classList.remove('visible');
    state.modalMode = 'create';
    state.modalTargetFileId = null;
}

function confirmNewFileCreation() {
    const name = newFileModalInput.value;
    const selectedFolder = getSelectedFolder();
    if (state.modalMode === 'rename' && state.modalTargetFileId) {
        renameFile(state.modalTargetFileId, name);
    } else if (state.modalMode === 'folder') {
        createNewFolder(name);
    } else if (state.modalMode === 'move' && state.modalTargetFileId) {
        moveFile(state.modalTargetFileId, selectedFolder);
    } else {
        createNewFile(name);
    }
    closeNewFileModal();
}

function updateExplorer() {
    const { fileList, folderList } = toExplorerInput(state.files, state.ideFolders);
    const tree = buildFileTree(fileList, folderList);
    renderExplorer(explorer, tree, {
        activeFileId: state.activeFileId,
        isEmpty: state.files.length === 0 && folderList.length === 0,
        hideRootLabel: true,
    }, {
        onFileClick: openFile,
        onFileDblClick: openRenameModal,
        onFileMove: openMoveFileModal,
        onFileDelete: deleteFile,
        onFolderDelete: deleteFolder,
        onFileDrop: (fileId, folderPath) => { void moveFile(fileId, folderPath); },
        isFolderOpen: folderPath => !state.collapsedExplorerFolders.has(folderPath),
        onFolderToggle: (folderPath, open) => {
            if (open) {
                state.collapsedExplorerFolders.delete(folderPath);
            } else {
                state.collapsedExplorerFolders.add(folderPath);
            }
            persistCollapsedExplorerFolders();
        },
    });
}

function attachExplorer({
    createTab: createTabFn,
    createView: createViewFn,
    closeTab: closeTabFn,
    switchToFile: switchToFileFn,
    clearOpenTabs: _clearTabsFn,
    initializeQueryVersions: initializeQueryVersionsFn,
    refreshQueryHistory: _refreshQueryHistory,
    onQueryFileChanged: onQueryFileChangedFn,
    applySavedSearchToFile: applySavedSearchToFileFn,
    updateTabLabel: updateTabLabelFn,
}) {
    createTab = createTabFn;
    createView = createViewFn;
    closeTab = closeTabFn;
    switchToFile = switchToFileFn;
    initializeQueryVersions = initializeQueryVersionsFn;
    onQueryFileChanged = onQueryFileChangedFn;
    applySavedSearchToFile = applySavedSearchToFileFn;
    updateTabLabel = updateTabLabelFn;

    newProjectBtn.addEventListener('click', createNewProject);
    openProjectBtn.addEventListener('click', openProject);
    newFileBtn.addEventListener('click', event => {
        event.stopPropagation();
        if (newFileBtn.disabled) {
            return;
        }
        newItemMenu.classList.toggle('visible');
    });
    newSearchChoice.addEventListener('click', () => {
        hideNewItemMenu();
        openNewFileModal();
    });
    newFolderBtn.addEventListener('click', () => {
        hideNewItemMenu();
        openNewFolderModal();
    });
    newFileCreateBtn.addEventListener('click', confirmNewFileCreation);
    newFileCancelBtn.addEventListener('click', closeNewFileModal);
    newFileModalInput.addEventListener('keydown', event => {
        if (event.key === 'Enter') {
            event.preventDefault();
            confirmNewFileCreation();
        }
        if (event.key === 'Escape') {
            event.preventDefault();
            closeNewFileModal();
        }
    });
}

module.exports = {
    EXPLORER_COLLAPSED_KEY,
    attachExplorer,
    openStartupSearch,
    createFileWithUrl,
    createNewFile,
    createNewFolder,
    deleteFile,
    deleteFolder,
    removeFile,
    openFile,
    getProjectFilePath,
    ensureDirectoryExists,
    scanProjectFiles,
    scanProjectFolders,
    populateFolderSelect,
    getSelectedFolder,
    openMoveFileModal,
    moveFile,
    createNewProject,
    openProject,
    loadProject,
    clearOpenTabs,
    hideNewItemMenu,
    syncFolderList,
    collapsedFoldersStorageKey,
    loadCollapsedExplorerFolders,
    persistCollapsedExplorerFolders,
    persistIdeFolders,
    loadIdeFoldersFromProject,
    updateProjectDisplay,
    openNewFileModal,
    openNewFolderModal,
    openRenameModal,
    showNewFileModal,
    closeNewFileModal,
    confirmNewFileCreation,
    renameFile,
    updateExplorer,
};
