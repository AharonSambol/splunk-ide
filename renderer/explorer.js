'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { buildFileTree } = require('../lib/explorer/file-tree');
const {
    normalizeRelativePath,
    getProjectFilePath: buildProjectFilePath,
    ensureDirectoryExists: ensureProjectDirectoryExists,
    scanProjectFiles: scanProjectFilesOnDisk,
    scanProjectFolders: scanProjectFoldersOnDisk,
} = require('../lib/explorer/project-files');
const { parseSavedSearchFromUrl, getFileFolder } = require('../lib/splunk-url');
const { getDashboardViewPath } = require('../lib/objects/object-paths');
const { renameQueryFile } = require('../lib/git/query-versions');
const { renderExplorer } = require('../lib/explorer/render-explorer');
const {
    explorerIdForFile,
    createFolder: addIdeFolder,
    deleteFolder: removeIdeFolder,
    setItemFolder,
    pruneIdeFolders,
    toExplorerInput,
} = require('../lib/explorer/ide-folders');
const state = require('./state');
const {
    newFileBtn,
    newItemMenu,
    newSearchChoice,
    newFolderBtn,
    newProjectBtn,
    openProjectBtn,
    tabBar,
    explorer,
    newFileModalInput,
    newFileCreateBtn,
    newFileCancelBtn,
} = require('./dom');
const {
    attachExplorerModals,
    populateFolderSelect,
    getSelectedFolder,
    openMoveFileModal,
    hideNewItemMenu,
    openNewFileModal,
    openNewFolderModal,
    openRenameModal,
    showNewFileModal,
    closeNewFileModal,
    confirmNewFileCreation,
} = require('./explorer/modals');
const {
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
} = require('./explorer/project');

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

    // phase 2: deps that only exist after attachExplorer assigns the lets above
    attachExplorerProject({ initializeQueryVersions, applySavedSearchToFile });

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

attachExplorerProject({ openFile, updateExplorer, scanProjectFiles });
attachExplorerModals({
    createNewFile,
    createNewFolder,
    renameFile,
    moveFile,
});
