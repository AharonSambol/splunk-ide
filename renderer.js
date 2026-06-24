let fileCounter = 1;
let splunk_url;
try {
    splunk_url = fs.readFileSync(String.raw`%userprofile%\.splunk`, 'utf8');
} catch {
    splunk_url = 'http://localhost:8010/en-US/app/search/search';
}
const SPLUNK_URL = splunk_url;

const fs = require('node:fs');
const path = require('node:path');
const { ipcRenderer } = require('electron');
const { simpleGit } = require('simple-git');
const { buildFileTree } = require('./lib/file-tree');
const {
    normalizeRelativePath,
    getProjectFilePath: buildProjectFilePath,
    ensureDirectoryExists: ensureProjectDirectoryExists,
    scanProjectFiles: scanProjectFilesOnDisk,
    scanProjectFolders: scanProjectFoldersOnDisk,
    getMoveTargetPath,
} = require('./lib/project-files');
const {
    closeFileState,
    reorderTabs: computeTabOrder,
    getPreviousTab,
    getNextTab,
    createDuplicateFileName,
} = require('./lib/tabs');
const { decodeSearchText, extractQueryFromUrl, getFileFolder } = require('./lib/url-utils');

const newFileBtn = document.getElementById('new-file-btn');
const newFolderBtn = document.getElementById('new-folder-btn');
const newProjectBtn = document.getElementById('new-project-btn');
const openProjectBtn = document.getElementById('open-project-btn');
const copyUrlBtn = document.getElementById('copy-url-btn');
const prevPageBtn = document.getElementById('prev-page-btn');
const nextPageBtn = document.getElementById('next-page-btn');
const projectNameLabel = document.getElementById('project-name');
const tabBar = document.getElementById('tab-bar');
const viewsContainer = document.getElementById('views-container');
const explorer = document.getElementById('explorer');
const quickSearchOverlay = document.getElementById('quick-search-overlay');
const quickSearchHint = document.getElementById('quick-search-hint');
const quickSearchInput = document.getElementById('quick-search-input');
const quickSearchResults = document.getElementById('quick-search-results');
const newFileModal = document.getElementById('new-file-modal');
const newFileModalLabel = document.getElementById('new-file-modal-label');
const newFileModalInput = document.getElementById('new-file-modal-input');
const newFileFolderRow = document.getElementById('new-file-folder-row');
const newFileFolderSelect = document.getElementById('new-file-folder-select');
const newFileCreateBtn = document.getElementById('new-file-create');
const newFileCancelBtn = document.getElementById('new-file-cancel');

// Git elements
const sidebarTabs = document.querySelectorAll('.sidebar-tab');
const gitView = document.getElementById('git-view');
const gitStatus = document.getElementById('git-status');
const gitBranch = document.getElementById('git-branch');
const gitMessage = document.getElementById('git-message');
const gitCommitBtn = document.getElementById('git-commit');
const gitPushBtn = document.getElementById('git-push');
const gitPullBtn = document.getElementById('git-pull');
const gitHistory = document.getElementById('git-history');
const gitTabs = document.querySelectorAll('.git-tab-btn');

let files = [];
let folders = [];
let activeFileId = null;
let fileMru = [];
let currentProjectPath = null;
let currentProjectName = 'No project loaded';
let shiftTapCount = 0;
let shiftTimer = null;
let quickSearchSelectedIndex = 0;
let quickSearchMode = 'file';
let modalMode = 'create';
let modalTargetFileId = null;
let currentGit = null;
let gitChanges = {};
let gitCommits = [];

newProjectBtn.addEventListener('click', createNewProject);
openProjectBtn.addEventListener('click', openProject);
copyUrlBtn.addEventListener('click', copyActiveFileUrl);
newFileBtn.addEventListener('click', openNewFileModal);
newFolderBtn.addEventListener('click', openNewFolderModal);
newFileCreateBtn.addEventListener('click', confirmNewFileCreation);
newFileCancelBtn.addEventListener('click', closeNewFileModal);

// Sidebar tabs
sidebarTabs.forEach(tab => {
    tab.addEventListener('click', () => switchSidebarView(tab.dataset.view));
});

// Git tabs (Changes/History)
gitTabs.forEach(tab => {
    tab.addEventListener('click', () => switchGitTab(tab.dataset.tab));
});

// Git buttons
gitCommitBtn.addEventListener('click', commitChanges);
gitPushBtn.addEventListener('click', pushChanges);
gitPullBtn.addEventListener('click', pullChanges);
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
document.addEventListener('keydown', handleGlobalKeydown);
quickSearchInput.addEventListener('input', updateQuickSearchResults);
quickSearchInput.addEventListener('keydown', handleQuickSearchKeydown);

window.onload = () => {
    updateProjectDisplay();
};

function copyActiveFileUrl() {
    if (!activeFileId) {
        alert('No file open');
        return;
    }

    const file = files.find(f => f.id === activeFileId);
    
    saveFileUrl(file.id);
    
    if (!file?.url) {
        alert('No URL available');
        return;
    }

    navigator.clipboard.writeText(file.url).then(() => {
        copyUrlBtn.textContent = 'Copied!';
        setTimeout(() => {
            copyUrlBtn.textContent = 'Copy URL';
        }, 2000);
    }).catch(err => {
        alert('Failed to copy: ' + err);
    });
}

function duplicateCurrentTab() {
    if (!activeFileId) {
        alert('No file open to duplicate');
        return;
    }

    const activeFile = files.find(f => f.id === activeFileId);
    if (!activeFile) {
        return;
    }

    const baseName = activeFile.name.split('/').pop();
    const folder = getFileFolder(activeFile.name);
    const newName = createDuplicateFileName(files, baseName);
    createFileWithUrl(newName, activeFile.url, folder);
}

function createFileWithUrl(name, url, parentFolder = '') {
    if (!currentProjectPath) {
        alert('Please create or open a project before creating files.');
        return;
    }

    const normalizedFileName = normalizeRelativePath(name);
    const fileId = `splunk-view-${Date.now()}-${fileCounter}`;
    fileCounter++;

    const relativeFileName = parentFolder ? `${parentFolder}/${normalizedFileName}` : normalizedFileName;
    const filePath = getProjectFilePath(relativeFileName);
    ensureDirectoryExists(path.dirname(filePath));
    fs.writeFileSync(filePath, url, 'utf8');

    const file = { id: fileId, name: relativeFileName, path: filePath, url };
    files.push(file);
    fileMru.unshift(fileId);

    const fileParentFolder = getFileFolder(relativeFileName);
    if (fileParentFolder) {
        addFolderForPath(fileParentFolder);
    }
    createTab(file);
    createView(file);
    updateExplorer();
    switchToFile(fileId);
}

function createNewFile(name, parentFolder = '') {
    if (!currentProjectPath) {
        alert('Please create or open a project before creating files.');
        return;
    }

    const defaultName = `Search ${fileCounter}`;
    const fileName = name ? name.trim() || defaultName : defaultName;
    const normalizedFileName = normalizeRelativePath(fileName);
    const fileId = `splunk-view-${Date.now()}-${fileCounter}`;
    fileCounter++;

    const relativeFileName = parentFolder ? `${parentFolder}/${normalizedFileName}` : normalizedFileName;
    const filePath = getProjectFilePath(relativeFileName);
    ensureDirectoryExists(path.dirname(filePath));
    fs.writeFileSync(filePath, SPLUNK_URL, 'utf8');

    const file = { id: fileId, name: relativeFileName, path: filePath, url: SPLUNK_URL };
    files.push(file);
    fileMru.unshift(fileId);

    const fileParentFolder = getFileFolder(relativeFileName);
    if (fileParentFolder) {
        addFolderForPath(fileParentFolder);
    }
    createTab(file);
    createView(file);
    updateExplorer();
    switchToFile(fileId);
}

function createNewFolder(name, parentFolder = '') {
    if (!currentProjectPath) {
        alert('Please create or open a project before creating folders.');
        return;
    }

    const folderNameRaw = name ? name.trim() : '';
    if (!folderNameRaw) {
        return;
    }

    const normalizedFolder = normalizeRelativePath(folderNameRaw);
    const relativeFolder = parentFolder ? `${parentFolder}/${normalizedFolder}` : normalizedFolder;
    const folderPath = path.join(currentProjectPath, ...relativeFolder.split('/'));
    ensureDirectoryExists(folderPath);

    addFolderForPath(relativeFolder);
    updateExplorer();
}

function addFolderForPath(folderPath) {
    const segments = folderPath.split('/').map(segment => segment.trim()).filter(Boolean);
    let accumulated = '';
    segments.forEach(segment => {
        accumulated = accumulated ? `${accumulated}/${segment}` : segment;
        if (!folders.includes(accumulated)) {
            folders.push(accumulated);
        }
    });
}

function getOpenTabIds() {
    return Array.from(tabBar.querySelectorAll('.tab')).map(tab => tab.dataset.targetId);
}

function closeTab(fileId) {
    const file = files.find(f => f.id === fileId);
    if (!file) {
        return;
    }

    saveFileUrl(fileId);

    const openTabsBeforeClose = getOpenTabIds();
    const wasActive = activeFileId === fileId;

    const tab = tabBar.querySelector(`.tab[data-target-id="${fileId}"]`);
    if (tab) {
        tab.remove();
    }

    const view = document.getElementById(fileId);
    if (view) {
        view.remove();
    }

    const tabState = closeFileState(files, openTabsBeforeClose, activeFileId, fileId, fileMru);
    fileMru = tabState.fileMru;

    if (wasActive) {
        if (tabState.activeFileId) {
            switchToFile(tabState.activeFileId);
        } else {
            activeFileId = null;
            document.querySelectorAll('webview').forEach(view => view.classList.remove('active'));
            document.querySelectorAll('.explorer-item').forEach(item => item.classList.remove('active'));
        }
    }
}

function deleteFile(fileId) {
    if (!confirm('Delete this file? This will remove it from disk.')) {
        return;
    }

    closeTab(fileId);
    removeFile(fileId, true);
}

function deleteFolder(folderPath) {
    if (!confirm(`Delete folder "${folderPath}" and all of its contents?`)) {
        return;
    }

    const fullPath = path.join(currentProjectPath, ...folderPath.split('/'));
    removeFolderRecursive(fullPath);

    const removedFileIds = files
        .filter(file => file.name === folderPath || file.name.startsWith(`${folderPath}/`))
        .map(file => file.id);

    removedFileIds.forEach(id => {
        closeTab(id);
        removeFile(id, false);
    });

    folders = folders.filter(folder => folder !== folderPath && !folder.startsWith(`${folderPath}/`));
    updateExplorer();
}

function removeFolderRecursive(folderPath) {
    if (!fs.existsSync(folderPath)) {
        return;
    }

    fs.readdirSync(folderPath, { withFileTypes: true }).forEach(dirent => {
        const fullPath = path.join(folderPath, dirent.name);
        if (dirent.isDirectory()) {
            removeFolderRecursive(fullPath);
        } else {
            fs.unlinkSync(fullPath);
        }
    });

    fs.rmdirSync(folderPath);
}

function removeFile(fileId, deleteFromDisk = false) {
    const wasActive = activeFileId === fileId;
    const file = files.find(f => f.id === fileId);
    files = files.filter(file => file.id !== fileId);
    fileMru = fileMru.filter(id => id !== fileId);

    if (deleteFromDisk && file?.path && fs.existsSync(file.path)) {
        fs.unlinkSync(file.path);
    }

    updateExplorer();

    if (wasActive) {
        const remainingTabs = Array.from(tabBar.querySelectorAll('.tab'));
        if (remainingTabs.length > 0) {
            switchToFile(remainingTabs[0].dataset.targetId);
        } else {
            activeFileId = null;
            if (files.length > 0) {
                openFile(files[0].id);
            }
        }
    }
}

function openFile(fileId) {
    const file = files.find(f => f.id === fileId);
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
    return buildProjectFilePath(currentProjectPath, fileName, path);
}

function ensureDirectoryExists(directoryPath) {
    ensureProjectDirectoryExists(fs, directoryPath, path);
}

function scanProjectFiles(directory) {
    return scanProjectFilesOnDisk(fs, path, directory);
}

function scanProjectFolders(directory) {
    return scanProjectFoldersOnDisk(fs, path, directory, currentProjectPath);
}

function saveFileUrl(fileId) {
    const file = files.find(f => f.id === fileId);
    if (!file?.path) {
        return;
    }

    const view = document.getElementById(fileId);
    if (view) {
        const url = view.getURL();
        if (url && url !== file.url) {
            file.url = url;
            fs.writeFileSync(file.path, url, 'utf8');
        }
    }
}

function populateFolderSelect(selectedValue = '') {
    newFileFolderSelect.innerHTML = '';
    const rootOption = document.createElement('option');
    rootOption.value = '';
    rootOption.textContent = 'Root';
    newFileFolderSelect.appendChild(rootOption);

    const sortedFolders = [...folders].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
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
    modalMode = 'move';
    modalTargetFileId = file.id;
    newFileModalLabel.textContent = `Move "${file.name.split('/').pop()}" to folder`;
    newFileModalInput.value = file.name.split('/').pop();
    newFileModalInput.disabled = true;
    populateFolderSelect(getFileFolder(file.name));
    showNewFileModal();
}

function moveFile(fileId, targetFolder) {
    const file = files.find(f => f.id === fileId);
    if (!file) {
        return;
    }

    const newPath = getMoveTargetPath(currentProjectPath, file.name, targetFolder, path);
    const oldPath = file.path;

    if (newPath === oldPath) {
        return;
    }

    ensureDirectoryExists(path.dirname(newPath));
    fs.renameSync(oldPath, newPath);
    file.name = path.relative(currentProjectPath, newPath).replace(/\.spl$/i, '').split(path.sep).join('/');
    file.path = newPath;
    const movedParent = getFileFolder(file.name);
    if (movedParent) addFolderForPath(movedParent);
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
    currentProjectPath = projectPath;
    currentProjectName = path.basename(projectPath);
    updateProjectDisplay();
    await initializeGit();

    files = [];
    folders = [];
    fileMru = [];
    activeFileId = null;
    clearOpenTabs();

    folders = scanProjectFolders(projectPath);

    const filePaths = scanProjectFiles(currentProjectPath);
    filePaths.forEach(filePath => {
        const url = fs.readFileSync(filePath, 'utf8').trim() || SPLUNK_URL;
        const name = path.relative(projectPath, filePath).replace(/\.spl$/i, '').split(path.sep).join('/');
        files.push({ id: `splunk-view-${Date.now()}-${Math.random()}`, name, path: filePath, url });
    });

    updateExplorer();
}

function clearOpenTabs() {
    while (tabBar.firstChild) {
        tabBar.firstChild.remove();
    }
    document.querySelectorAll('webview').forEach(view => view.remove());
}

function updateProjectDisplay() {
    projectNameLabel.textContent = currentProjectPath ? currentProjectName : 'No project loaded';
    projectNameLabel.title = currentProjectPath || '';
    const disabled = !currentProjectPath;
    newFileBtn.disabled = disabled;
    newFolderBtn.disabled = disabled;
}

function openNewFileModal() {
    modalMode = 'create';
    modalTargetFileId = null;
    newFileModalLabel.textContent = 'New Search File Name';
    newFileModalInput.value = `Search ${fileCounter}`;
    showNewFileModal();
}

function openNewFolderModal() {
    modalMode = 'folder';
    modalTargetFileId = null;
    newFileModalLabel.textContent = 'New Folder Name';
    newFileModalInput.value = '';
    showNewFileModal();
}

function openRenameModal(file) {
    modalMode = 'rename';
    modalTargetFileId = file.id;
    newFileModalLabel.textContent = `Rename "${file.name.split('/').pop()}"`;
    newFileModalInput.value = file.name;
    showNewFileModal();
}

function showNewFileModal() {
    if (modalMode === 'rename') {
        newFileModalLabel.textContent = `Rename "${files.find(f => f.id === modalTargetFileId)?.name.split('/').pop() || ''}"`;
        newFileFolderRow.style.display = 'none';
        newFileModalInput.disabled = false;
    } else if (modalMode === 'folder') {
        newFileModalLabel.textContent = 'New Folder Name';
        newFileFolderRow.style.display = 'block';
        newFileModalInput.disabled = false;
        populateFolderSelect('');
    } else if (modalMode === 'move') {
        newFileModalLabel.textContent = `Move "${files.find(f => f.id === modalTargetFileId)?.name.split('/').pop() || ''}" to folder`;
        newFileFolderRow.style.display = 'block';
        newFileModalInput.disabled = true;
    } else {
        newFileModalLabel.textContent = 'New Search File Name';
        newFileFolderRow.style.display = 'block';
        newFileModalInput.disabled = false;
        populateFolderSelect('');
    }

    if (modalMode === 'rename') {
        newFileCreateBtn.textContent = 'Rename';
    } else if (modalMode === 'move') {
        newFileCreateBtn.textContent = 'Move';
    } else if (modalMode === 'folder') {
        newFileCreateBtn.textContent = 'Create Folder';
    } else {
        newFileCreateBtn.textContent = 'Create';
    }
    newFileModalInput.placeholder = modalMode === 'folder' ? 'Folder name or path' : 'Enter file name or path';
    newFileModal.classList.add('visible');
    setTimeout(() => {
        newFileModalInput.select();
        newFileModalInput.focus();
    }, 0);
}

function closeNewFileModal() {
    newFileModal.classList.remove('visible');
    modalMode = 'create';
    modalTargetFileId = null;
}

function confirmNewFileCreation() {
    const name = newFileModalInput.value;
    const selectedFolder = getSelectedFolder();
    if (modalMode === 'rename' && modalTargetFileId) {
        renameFile(modalTargetFileId, name);
    } else if (modalMode === 'folder') {
        createNewFolder(name, selectedFolder);
    } else if (modalMode === 'move' && modalTargetFileId) {
        moveFile(modalTargetFileId, selectedFolder);
    } else {
        createNewFile(name, selectedFolder);
    }
    closeNewFileModal();
}

function renameFile(fileId, newName) {
    const file = files.find(f => f.id === fileId);
    if (!file) {
        return;
    }

    const trimmed = newName ? newName.trim() : '';
    if (!trimmed) {
        return;
    }

    file.name = trimmed;
    updateTabLabel(file);
    updateExplorer();
}

function updateTabLabel(file) {
    const tab = tabBar.querySelector(`.tab[data-target-id="${file.id}"]`);
    if (tab) {
        const title = tab.querySelector('.tab-title');
        if (title) {
            title.textContent = file.name.split('/').pop();
        }
    }
}

function createTab(file) {
    const tab = document.createElement('div');
    tab.className = 'tab';
    tab.dataset.targetId = file.id;
    tab.draggable = true;

    const title = document.createElement('span');
    title.className = 'tab-title';
    title.textContent = file.name.split('/').pop();

    const closeButton = document.createElement('button');
    closeButton.className = 'tab-close';
    closeButton.type = 'button';
    closeButton.innerText = '×';
    closeButton.addEventListener('click', event => {
        event.stopPropagation();
        closeTab(file.id);
    });

    tab.appendChild(title);
    tab.appendChild(closeButton);
    tab.addEventListener('click', () => switchToFile(file.id));

    // Drag and drop handlers
    tab.addEventListener('dragstart', (e) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', file.id);
        tab.classList.add('dragging');
    });

    tab.addEventListener('dragend', () => {
        tab.classList.remove('dragging');
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('drag-over'));
    });

    tab.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const draggedTab = tabBar.querySelector('.tab.dragging');
        if (draggedTab && draggedTab !== tab) {
            const rect = tab.getBoundingClientRect();
            const midpoint = rect.left + rect.width / 2;
            if (e.clientX < midpoint) {
                tab.classList.add('drag-over');
            } else {
                tab.classList.remove('drag-over');
            }
        }
    });

    tab.addEventListener('dragleave', () => {
        tab.classList.remove('drag-over');
    });

    tab.addEventListener('drop', (dropEvent) => {
        dropEvent.preventDefault();
        const draggedFileId = dropEvent.dataTransfer.getData('text/plain');
        if (draggedFileId && draggedFileId !== file.id) {
            reorderTabs(draggedFileId, file.id, dropEvent);
        }
    });

    tabBar.appendChild(tab);
}

function createView(file) {
    const view = document.createElement('webview');
    view.id = file.id;
    view.setAttribute('allowpopups', '');

    // use a preload script so we can capture keys inside the guest page
    try {
        const preloadPath = path.join(__dirname, 'webview-preload.js');
        // Preload must be an absolute file:// URL and set before src
        view.setAttribute('preload', `file://${preloadPath}`);
    } catch (err) { 
        
    }
    // set src after preload so the preload script is injected
    view.src = file.url || SPLUNK_URL;
    viewsContainer.appendChild(view);

    // Listen for key events forwarded from the webview preload
    view.addEventListener('ipc-message', async (event) => {
        if (event.channel === 'webview-keydown') {
            handleKeyboardShortcut(event.args[0] || {});
        } else if (event.channel === 'save-file') {
            // Save file when Enter is pressed in search interface
            saveFileUrl(file.id);
            // Update git status
            if (currentGit) {
                refreshGitStatus();
            }
        } else if (event.channel === 'webview-contextmenu') {
            // Forward to main process to show native menu
            try {
                const info = event.args[0] || {};
                // include webContentsId so main can target the webview's webContents
                try { info.webContentsId = view.getWebContentsId(); } catch (e) {}
                // try and get the selection from the .ace_editor
                let selection = await view.executeJavaScript(`
                (() => {
                    const el = document.querySelector('.ace_editor');
                    return el?.env?.editor?.getSelectedText() ?? '';
                })()
                `);
                if(selection) {
                    info.selection = selection;
                }
                ipcRenderer.invoke('show-context-menu', info);
            } catch (err) {
                console.error('Failed to invoke show-context-menu', err);
            }
        }
    });
    // Update navigation button state on navigation events
    const updateNavState = () => {
        try {
            const active = document.querySelector('webview.active');
            if (!active) {
                prevPageBtn.disabled = true;
                nextPageBtn.disabled = true;
                return;
            }
            try {
                prevPageBtn.disabled = !(typeof active.canGoBack === 'function' ? active.canGoBack() : false);
            } catch (e) { prevPageBtn.disabled = true; }
            try {
                nextPageBtn.disabled = !(typeof active.canGoForward === 'function' ? active.canGoForward() : false);
            } catch (e) { nextPageBtn.disabled = true; }
        } catch (e) {
            prevPageBtn.disabled = true;
            nextPageBtn.disabled = true;
        }
    };

    view.addEventListener('did-navigate', updateNavState);
    view.addEventListener('did-navigate-in-page', updateNavState);
    view.addEventListener('did-stop-loading', updateNavState);
    view.addEventListener('dom-ready', updateNavState);
    const injectorCode = fs.readFileSync(path.join(__dirname, 'injector.js'), 'utf8');
    view.addEventListener('dom-ready', () => {
        view.executeJavaScript(injectorCode)
            .then(() => {
                console.log('injector.js injected into webview', file.id);
            })
            .catch(err => {
                console.error('Failed to inject injector.js into webview', file.id, err);
            });
    });

    // Ensure nav state is updated when this view becomes active
    view.addEventListener('focus', () => {
        try { updateNavState(); } catch (e) {}
    });
}

// Navigation controls
function navigateBack() {
    const view = document.querySelector('webview.active');
    if (!view) return;
    try {
        if (typeof view.canGoBack === 'function') {
            if (view.canGoBack()) return view.goBack();
        }
        // fallback: execute history.back in webview
        view.executeJavaScript('history.back()').catch(() => {});
    } catch (e) {
        // ignore
    }
}

function navigateForward() {
    const view = document.querySelector('webview.active');
    if (!view) return;
    try {
        if (typeof view.canGoForward === 'function') {
            if (view.canGoForward()) return view.goForward();
        }
        view.executeJavaScript('history.forward()').catch(() => {});
    } catch (e) {
        // ignore
    }
}

prevPageBtn.addEventListener('click', navigateBack);
nextPageBtn.addEventListener('click', navigateForward);

function updateNavButtons() {
    try {
        const view = document.querySelector('webview.active');
        if (!view) {
            prevPageBtn.disabled = true;
            nextPageBtn.disabled = true;
            return;
        }
        try { prevPageBtn.disabled = !(typeof view.canGoBack === 'function' ? view.canGoBack() : false); } catch (e) { prevPageBtn.disabled = true; }
        try { nextPageBtn.disabled = !(typeof view.canGoForward === 'function' ? view.canGoForward() : false); } catch (e) { nextPageBtn.disabled = true; }
    } catch (e) {
        prevPageBtn.disabled = true;
        nextPageBtn.disabled = true;
    }
}

// Update nav buttons whenever active tab changes
const originalSwitchToFile = switchToFile;
switchToFile = function(targetId) {
    originalSwitchToFile(targetId);
    try { setTimeout(updateNavButtons, 50); } catch (e) {}
};

function applyTabOrder(tabIds) {
    tabIds.forEach(tabId => {
        const tab = tabBar.querySelector(`.tab[data-target-id="${tabId}"]`);
        if (tab) {
            tabBar.appendChild(tab);
        }
    });
}

function reorderTabs(draggedFileId, targetFileId, dropEvent) {
    const targetTab = tabBar.querySelector(`.tab[data-target-id="${targetFileId}"]`);
    if (!targetTab || !tabBar.querySelector(`.tab[data-target-id="${draggedFileId}"]`)) {
        return;
    }

    const rect = targetTab.getBoundingClientRect();
    const midpoint = rect.left + rect.width / 2;
    const position = dropEvent.clientX < midpoint ? 'before' : 'after';
    const newOrder = computeTabOrder(getOpenTabIds(), draggedFileId, targetFileId, position);
    applyTabOrder(newOrder);
}

function switchToFile(targetId) {
    if (!files.some(file => file.id === targetId)) {
        return;
    }

    if (activeFileId && activeFileId !== targetId) {
        saveFileUrl(activeFileId);
    }

    activeFileId = targetId;
    fileMru = fileMru.filter(id => id !== targetId);
    fileMru.unshift(targetId);

    document.querySelectorAll('.tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.targetId === targetId);
    });

    document.querySelectorAll('webview').forEach(view => {
        view.classList.toggle('active', view.id === targetId);
    });

    document.querySelectorAll('.explorer-item').forEach(item => {
        item.classList.toggle('active', item.dataset.fileId === targetId);
    });
}

function handleKeyboardShortcut(d) {
    if (!d || typeof d.key !== 'string') {
        return;
    }

    // Skip if modal or quick search is open
    if (quickSearchOverlay.classList.contains('visible') || newFileModal.classList.contains('visible')) {
        return;
    }

    // Close find overlay on Escape (also handles key events forwarded from webview)
    try {
        if (d && typeof d.key === 'string' && d.key.toLowerCase() === 'escape') {
            try { hideFindOverlay(); } catch (e) { /* ignore */ }
            try {
                const view = document.querySelector('webview.active');
                if (view) {
                    const id = view.getWebContentsId();
                    ipcRenderer.invoke('stop-find-in-page', { webContentsId: id, action: 'clearSelection' });
                }
            } catch (e) { /* ignore */ }
            return;
        }
    } catch (e) { /* ignore */ }

    const key = d.key.toLowerCase();
    const ctrlOrMeta = !!(d.ctrl || d.meta);

    // Handle Shift-Shift for quick search
    if (key === 'shift') {
        shiftTapCount += 1;

        if (shiftTapCount === 1) {
            shiftTimer = globalThis.setTimeout(() => {
                shiftTapCount = 0;
            }, 400);
        } else if (shiftTapCount === 2) {
            globalThis.clearTimeout(shiftTimer);
            shiftTapCount = 0;
            openQuickSearch();
        }
        return;
    }

    // Handle modifed shortcuts
    if (ctrlOrMeta) {
        if (d.shift && key === 'f') {
            openQuickSearch('content');
            return;
        }
        if (d.shift && key === 'n') {
            duplicateCurrentTab();
            return;
        }
        if (key === 'tab') {
            openMostRecentTab();
        } else if (key === 'n') {
            openNewFileModal();
        }


        // Ctrl+F / Cmd+F -> use Electron findInPage for active webview
        try {
            if (key === 'f') {
                const view = document.querySelector('webview.active');
                if (!view) return;
                showFindOverlay(view);
                return;
            }

            // Escape -> clear find highlights (also handled by overlay)
            if (keyName === 'escape') {
                const view = document.querySelector('webview.active');
                if (view) {
                    try {
                        const id = view.getWebContentsId();
                        ipcRenderer.invoke('stop-find-in-page', { webContentsId: id, action: 'clearSelection' });
                    } catch (err) {
                        // ignore
                    }
                }
            }
        } catch (err) {
            // ignore
        }

    }

    // Handle Alt+Left/Right for tab navigation
    if (d.alt) {
        if (d.code === 'ArrowLeft' || key === 'arrowleft') {
            switchToPreviousTab();
        } else if (d.code === 'ArrowRight' || key === 'arrowright') {
            switchToNextTab();
        }
    }
}

function updateExplorer() {
    explorer.innerHTML = '';

    if (files.length === 0 && folders.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'explorer-item';
        empty.textContent = 'No files yet. Create a new search file or folder.';
        explorer.appendChild(empty);
        return;
    }

    const root = buildFileTree(files, folders);
    const rootLabel = document.createElement('div');
    rootLabel.className = 'folder-root';
    rootLabel.textContent = 'Search Files';
    explorer.appendChild(rootLabel);

    root.files.forEach(file => {
        explorer.appendChild(renderFileNode(file));
    });

    root.children.forEach(folder => {
        explorer.appendChild(renderFolderNode(folder));
    });
}

function renderFolderNode(folder) {
    const details = document.createElement('details');
    details.className = 'folder';
    details.open = true;

    const summary = document.createElement('summary');

    const title = document.createElement('span');
    title.textContent = folder.name;
    summary.appendChild(title);

    const folderActions = document.createElement('span');
    folderActions.className = 'folder-actions';

    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.textContent = 'Delete';
    deleteButton.addEventListener('click', event => {
        event.stopPropagation();
        deleteFolder(folder.path);
    });

    folderActions.appendChild(deleteButton);
    summary.appendChild(folderActions);
    details.appendChild(summary);

    const folderContents = document.createElement('div');
    folderContents.className = 'folder-contents';

    folder.files.forEach(file => {
        folderContents.appendChild(renderFileNode(file));
    });

    folder.children.forEach(child => {
        folderContents.appendChild(renderFolderNode(child));
    });

    details.appendChild(folderContents);
    return details;
}

function renderFileNode(file) {
    const item = document.createElement('div');
    item.className = 'explorer-item';
    item.dataset.fileId = file.id;

    const label = document.createElement('span');
    label.className = 'file-name';
    label.textContent = file.displayName || file.name;

    const actions = document.createElement('span');
    actions.className = 'file-actions';

    const moveButton = document.createElement('button');
    moveButton.className = 'file-action file-move';
    moveButton.type = 'button';
    moveButton.textContent = 'Move';
    moveButton.addEventListener('click', event => {
        event.stopPropagation();
        openMoveFileModal(file);
    });

    const deleteButton = document.createElement('button');
    deleteButton.className = 'file-action file-delete';
    deleteButton.type = 'button';
    deleteButton.textContent = 'Delete';
    deleteButton.addEventListener('click', event => {
        event.stopPropagation();
        deleteFile(file.id);
    });

    actions.appendChild(moveButton);
    actions.appendChild(deleteButton);

    item.appendChild(label);
    item.appendChild(actions);
    item.addEventListener('click', () => openFile(file.id));
    item.addEventListener('dblclick', () => openRenameModal(file));
    if (file.id === activeFileId) {
        item.classList.add('active');
    }
    return item;
}

function handleGlobalKeydown(event) {
    handleKeyboardShortcut({
        key: event.key,
        code: event.code,
        ctrl: event.ctrlKey,
        meta: event.metaKey,
        alt: event.altKey,
        shift: event.shiftKey
    });

    // Prevent default for known shortcuts
    const key = event.key.toLowerCase();
    if (event.shiftKey && key === 'shift') {
        // Shift-Shift handled above
        if (shiftTapCount === 2) {
            event.preventDefault();
        }
    }
    if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'f') {
        event.preventDefault();
    }
    if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'n') {
        event.preventDefault();
    }
    if (event.ctrlKey && event.key === 'Tab') {
        event.preventDefault();
    }
    if (event.altKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
        event.preventDefault();
    }
    if (event.ctrlKey && (event.key === 'n' || event.key === 'N')) {
        event.preventDefault();
    }
}

function openMostRecentTab() {
    if (fileMru.length < 2) {
        return;
    }

    const targetId = fileMru[1];
    switchToFile(targetId);
}

function switchToPreviousTab() {
    const previousTabId = getPreviousTab(getOpenTabIds(), activeFileId);
    if (previousTabId) {
        switchToFile(previousTabId);
    }
}

function switchToNextTab() {
    const nextTabId = getNextTab(getOpenTabIds(), activeFileId);
    if (nextTabId) {
        switchToFile(nextTabId);
    }
}

function openQuickSearch(mode = 'file') {
    quickSearchMode = mode;
    quickSearchOverlay.classList.add('visible');
    quickSearchInput.value = '';
    quickSearchSelectedIndex = 0;
    quickSearchInput.placeholder = mode === 'content' ? 'Search file contents...' : 'Search files...';
    quickSearchHint.textContent = mode === 'content'
        ? 'Type to search all file contents. Use arrow keys and Enter to open.'
        : 'Type to search open files. Use arrow keys and Enter to open.';
    updateQuickSearchResults();
    quickSearchInput.focus();
}

// Inline find overlay for Ctrl+F (behaves like Chrome's find)
let _findOverlay = null;
let _lastFindQuery = '';
let _findWasActive = false;
function createFindOverlay() {
    if (_findOverlay) return _findOverlay;
    const overlay = document.createElement('div');
    overlay.id = 'find-overlay';
    overlay.style.position = 'fixed';
    overlay.style.top = '8px';
    overlay.style.right = '8px';
    overlay.style.zIndex = 9999;
    overlay.style.background = 'rgba(40,40,40,0.95)';
    overlay.style.color = '#fff';
    overlay.style.padding = '6px';
    overlay.style.borderRadius = '6px';
    overlay.style.display = 'flex';
    overlay.style.alignItems = 'center';
    overlay.style.boxShadow = '0 2px 10px rgba(0,0,0,0.4)';

    const input = document.createElement('input');
    input.type = 'search';
    input.placeholder = 'Find in page';
    input.style.padding = '6px';
    input.style.border = 'none';
    input.style.outline = 'none';
    input.style.background = 'transparent';
    input.style.color = '#fff';
    input.style.width = '260px';

    const prevBtn = document.createElement('button');
    prevBtn.textContent = '◀';
    prevBtn.title = 'Previous';
    prevBtn.style.marginLeft = '6px';
    prevBtn.className = "project-action";

    const nextBtn = document.createElement('button');
    nextBtn.textContent = '▶';
    nextBtn.title = 'Next';
    nextBtn.style.marginLeft = '4px';
    nextBtn.className = "project-action";

    const closeBtn = document.createElement('button');
    closeBtn.textContent = '✕';
    closeBtn.title = 'Close';
    closeBtn.style.marginLeft = '8px';
    closeBtn.className = "project-action";

    overlay.appendChild(input);
    overlay.appendChild(prevBtn);
    overlay.appendChild(nextBtn);
    overlay.appendChild(closeBtn);
    document.body.appendChild(overlay);

    // Events
    input.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') {
            ev.preventDefault();
            // Enter should move to next result
            doFind(input.value, true, true);
        } else if (ev.key === 'Escape') {
            ev.preventDefault();
            hideFindOverlay();
        }
    });

    // Live search on each character change
    input.addEventListener('input', (ev) => {
        try {
            doFind(input.value, true, true);
        } catch (e) {
            // ignore
        }
    });

    nextBtn.addEventListener('click', () => {
        doFind(input.value, true, true);
    });
    prevBtn.addEventListener('click', () => {
        doFind(input.value, false, true);
    });
    closeBtn.addEventListener('click', hideFindOverlay);

    _findOverlay = { overlay, input, prevBtn, nextBtn, closeBtn };
    return _findOverlay;
}

function showFindOverlay(view) {
    const f = createFindOverlay();
    f.input.value = _lastFindQuery || '';
    f.input.focus();
    f.input.select();
    _findWasActive = true;
}

function hideFindOverlay() {
    if (!_findOverlay) return;
    try {
        // remove overlay from DOM
        _findOverlay.overlay.remove();
    } catch (e) {
        // ignore
    }
    _findOverlay = null;
    _lastFindQuery = '';
    _findWasActive = false;
    try {
        const view = document.querySelector('webview.active');
        if (view) {
            const id = view.getWebContentsId();
            ipcRenderer.invoke('stop-find-in-page', { webContentsId: id, action: 'clearSelection' });
        }
    } catch (err) {
        // ignore
    }
}

function doFind(text, forward = true, findNext = false) {
    if (!text) return;
    _lastFindQuery = text;
    try {
        const view = document.querySelector('webview.active');
        if (!view) return;
        const id = view.getWebContentsId();
        ipcRenderer.invoke('find-in-page', { webContentsId: id, text, options: { forward, findNext } });
    } catch (err) {
        // ignore
    }
}

function closeQuickSearch() {
    quickSearchOverlay.classList.remove('visible');
}

function updateQuickSearchResults() {
    const query = quickSearchInput.value.trim().toLowerCase();
    let results = [];

    if (quickSearchMode === 'content') {
        if (!query) {
            quickSearchResults.innerHTML = '';
            const empty = document.createElement('div');
            empty.id = 'quick-search-empty';
            empty.textContent = 'Start typing to search file contents.';
            quickSearchResults.appendChild(empty);
            return;
        }

        results = files.map(file => {
            try {
                const rawText = fs.readFileSync(file.path, 'utf8');
                const queryText = extractQueryFromUrl(rawText);
                const lowerQueryText = queryText.toLowerCase();
                const index = lowerQueryText.indexOf(query);
                if (index === -1) {
                    return null;
                }

                const snippet = queryText.replace(/\s+/g, ' ');
                return { ...file, snippet };
            } catch {
                return null;
            }
        }).filter(Boolean);
    } else {
        results = files
            .map(file => ({
                ...file,
                searchLabel: file.name.split('/').pop()
            }))
            .filter(file => file.name.toLowerCase().includes(query) || file.searchLabel.toLowerCase().includes(query));
    }

    quickSearchResults.innerHTML = '';

    if (results.length === 0) {
        const empty = document.createElement('div');
        empty.id = 'quick-search-empty';
        empty.textContent = quickSearchMode === 'content'
            ? 'No matching text found.'
            : 'No matching files.';
        quickSearchResults.appendChild(empty);
        return;
    }

    results.forEach((file, index) => {
        const item = document.createElement('div');
        item.className = 'quick-search-item';
        item.dataset.fileId = file.id;

        const title = document.createElement('div');
        title.textContent = file.name;
        item.appendChild(title);

        if (quickSearchMode === 'content' && file.snippet) {
            const snippet = document.createElement('div');
            snippet.className = 'quick-search-snippet';
            snippet.textContent = file.snippet;
            item.appendChild(snippet);
        }

        if (index === quickSearchSelectedIndex) {
            item.classList.add('selected');
        }

        item.addEventListener('click', () => {
            activateFileFromQuickSearch(file.id);
        });

        quickSearchResults.appendChild(item);
    });
}

function handleQuickSearchKeydown(event) {
    const visibleItems = Array.from(document.querySelectorAll('.quick-search-item'));
    if (event.key === 'ArrowDown') {
        event.preventDefault();
        quickSearchSelectedIndex = Math.min(quickSearchSelectedIndex + 1, visibleItems.length - 1);
        updateQuickSearchResults();
    }

    if (event.key === 'ArrowUp') {
        event.preventDefault();
        quickSearchSelectedIndex = Math.max(quickSearchSelectedIndex - 1, 0);
        updateQuickSearchResults();
    }

    if (event.key === 'Enter') {
        event.preventDefault();
        const selectedItem = visibleItems[quickSearchSelectedIndex];
        if (selectedItem) {
            activateFileFromQuickSearch(selectedItem.dataset.fileId);
        }
    }

    if (event.key === 'Escape') {
        event.preventDefault();
        closeQuickSearch();
    }
}

function activateFileFromQuickSearch(fileId) {
    closeQuickSearch();
    openFile(fileId);
}
// Git functions
function switchSidebarView(view) {
    // Update tabs
    sidebarTabs.forEach(tab => {
        tab.classList.toggle('active', tab.dataset.view === view);
    });

    // Update views
    const showExplorer = view === 'explorer';
    document.getElementById('sidebar-header').style.display = showExplorer ? 'flex' : 'none';
    explorer.classList.toggle('hidden', !showExplorer);
    document.getElementById('explorer-footer').style.display = showExplorer ? 'block' : 'none';
    gitView.classList.toggle('active', !showExplorer);

    if (view === 'git') {
        refreshGitStatus();
    }
}

async function initializeGit() {
    if (!currentProjectPath) {
        return;
    }

    currentGit = simpleGit(currentProjectPath);
    const isRepo = await currentGit.checkIsRepo();
    if (!isRepo) {
        await currentGit.init();
    }
}

async function refreshGitStatus() {
    if (!currentGit) {
        gitStatus.innerHTML = '<div style="padding: 12px; color: #888;">No project loaded or not a git repo</div>';
        return;
    }

    try {
        // Get current branch
        const branch = await currentGit.branch();
        gitBranch.textContent = `Branch: ${branch.current}`;

        // Get status
        const status = await currentGit.status();
        gitChanges = {};

        // Collect changed files
        status.not_added.forEach(file => {
            gitChanges[file] = 'untracked';
        });
        status.modified.forEach(file => {
            gitChanges[file] = 'modified';
        });
        status.created.forEach(file => {
            gitChanges[file] = 'added';
        });
        status.deleted.forEach(file => {
            gitChanges[file] = 'deleted';
        });
        status.staged.forEach(file => {
            if (gitChanges[file]) {
                gitChanges[file] = 'staged';
            }
        });

        renderGitStatus();
    } catch (err) {
        gitStatus.innerHTML = `<div style="padding: 12px; color: #f48771;">Error: ${err.message}</div>`;
    }
}

function renderGitStatus() {
    gitStatus.innerHTML = '';

    if (Object.keys(gitChanges).length === 0) {
        const empty = document.createElement('div');
        empty.style.padding = '12px';
        empty.style.color = '#888';
        empty.textContent = 'No changes';
        gitStatus.appendChild(empty);
        return;
    }

    Object.entries(gitChanges).forEach(([file, status]) => {
        const item = document.createElement('div');
        item.className = 'git-file-item';

        const statusBadge = document.createElement('div');
        statusBadge.className = `git-file-status ${status}`;
        statusBadge.textContent = status.charAt(0).toUpperCase();

        const fileName = document.createElement('div');
        fileName.className = 'git-file-name';
        fileName.textContent = file;
        fileName.title = file;

        const actions = document.createElement('div');
        actions.className = 'git-actions';

        const stageBtn = document.createElement('button');
        stageBtn.className = 'git-button-small';
        stageBtn.textContent = status === 'staged' ? 'Unstage' : 'Stage';
        stageBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleStageFile(file, status === 'staged');
        });

        actions.appendChild(stageBtn);
        item.appendChild(statusBadge);
        item.appendChild(fileName);
        item.appendChild(actions);
        gitStatus.appendChild(item);
    });
}

async function toggleStageFile(file, isStaged) {
    if (!currentGit) {
        return;
    }

    try {
        if (isStaged) {
            await currentGit.reset(['HEAD', file]);
        } else {
            await currentGit.add(file);
        }
        refreshGitStatus();
    } catch (err) {
        console.error('Stage/unstage error:', err);
    }
}

async function commitChanges() {
    if (!currentGit || !gitMessage.value.trim()) {
        alert('Please enter a commit message');
        return;
    }

    try {
        await currentGit.commit(gitMessage.value);
        gitMessage.value = '';
        refreshGitStatus();
        alert('Committed successfully');
    } catch (err) {
        alert(`Commit error: ${err.message}`);
    }
}

async function pushChanges() {
    if (!currentGit) {
        alert('No git repository');
        return;
    }

    try {
        await currentGit.push();
        alert('Pushed successfully');
        refreshGitStatus();
    } catch (err) {
        alert(`Push error: ${err.message}`);
    }
}

async function pullChanges() {
    if (!currentGit) {
        alert('No git repository');
        return;
    }

    try {
        await currentGit.pull();
        alert('Pulled successfully');
        refreshGitStatus();
    } catch (err) {
        alert(`Pull error: ${err.message}`);
    }
}

function switchGitTab(tab) {
    // Update tab buttons
    gitTabs.forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tab);
    });

    // Update tab content
    document.querySelectorAll('.git-tab-content').forEach(content => {
        content.classList.toggle('active', content.id === `git-${tab}-tab`);
    });

    if (tab === 'history') {
        refreshGitHistory();
    }
}

async function refreshGitHistory() {
    if (!currentGit) {
        gitHistory.innerHTML = '<div style="padding: 12px; color: #888;">No project loaded or not a git repo</div>';
        return;
    }

    try {
        // Get commit log
        const log = await currentGit.log(['-20']);
        gitCommits = log.all;
        renderGitHistory();
    } catch (err) {
        gitHistory.innerHTML = `<div style="padding: 12px; color: #f48771;">Error: ${err.message}</div>`;
    }
}

function renderGitHistory() {
    gitHistory.innerHTML = '';

    if (gitCommits.length === 0) {
        const empty = document.createElement('div');
        empty.style.padding = '12px';
        empty.style.color = '#888';
        empty.textContent = 'No commits found';
        gitHistory.appendChild(empty);
        return;
    }

    gitCommits.forEach((commit, index) => {
        const item = document.createElement('div');
        item.className = 'git-commit-item';

        const hash = document.createElement('div');
        hash.className = 'git-commit-hash';
        hash.textContent = commit.hash.substring(0, 7);

        const message = document.createElement('div');
        message.className = 'git-commit-message';
        message.textContent = commit.message;

        const meta = document.createElement('div');
        meta.className = 'git-commit-meta';
        const authorDate = new Date(commit.date).toLocaleString();
        meta.textContent = `${commit.author_name} on ${authorDate}`;

        const actions = document.createElement('div');
        actions.className = 'git-commit-actions';

        const resetBtn = document.createElement('button');
        resetBtn.className = 'git-commit-btn danger';
        resetBtn.textContent = 'Reset to this commit';
        resetBtn.addEventListener('click', () => {
            if (confirm(`Reset to commit ${commit.hash.substring(0, 7)}: "${commit.message}"?\n\nThis will discard all changes after this commit.`)) {
                resetToCommit(commit.hash);
            }
        });

        actions.appendChild(resetBtn);
        item.appendChild(hash);
        item.appendChild(message);
        item.appendChild(meta);
        item.appendChild(actions);
        gitHistory.appendChild(item);
    });
}

async function resetToCommit(hash) {
    if (!currentGit) {
        alert('No git repository');
        return;
    }

    const activeFilePath = files.find(f => f.id === activeFileId)?.path;

    try {
        await currentGit.reset(['--hard', hash]);
        alert(`Reset to commit ${hash.substring(0, 7)} successfully`);
        
        // Reload files from disk after reset
        files = [];
        const filePaths = scanProjectFiles(currentProjectPath);
        filePaths.forEach(filePath => {
            const url = fs.readFileSync(filePath, 'utf8').trim() || SPLUNK_URL;
            const name = path.relative(currentProjectPath, filePath).replace(/\.spl$/i, '').split(path.sep).join('/');
            files.push({ id: `splunk-view-${Date.now()}-${Math.random()}`, name, path: filePath, url });
        });

        // Refresh UI and restore active file if available
        clearOpenTabs();
        updateExplorer();
        refreshGitStatus();
        refreshGitHistory();

        if (activeFilePath) {
            const reopened = files.find(f => f.path === activeFilePath);
            if (reopened) {
                openFile(reopened.id);
            }
        }
    } catch (err) {
        alert(`Reset error: ${err.message}`);
    }
}

// Handle commands from main process context menu (Select All, etc.)
ipcRenderer.on('context-menu-command', (event, arg) => {
    try {
        const cmd = arg && arg.command;
        const view = document.querySelector('webview.active');
        if (!view) return;

        if (cmd === 'selectAll') {
            try {
                view.executeJavaScript('document.execCommand("selectAll");').catch(() => {});
            } catch (err) {
                // ignore
            }
        }
        if (cmd === 'paste') {
            const text = arg && arg.text ? arg.text : '';
            if (!text) return;
            try {
                // Insert text at the current selection/caret inside the webview
                const safeText = JSON.stringify(text);
                const js = `(function(){ try{ if(window.getSelection && window.getSelection().rangeCount>0){ const sel=window.getSelection(); const range=sel.getRangeAt(0); range.deleteContents(); const node=document.createTextNode(${safeText}); range.insertNode(node); // move caret after inserted node
                    range.setStartAfter(node); range.collapse(true); sel.removeAllRanges(); sel.addRange(range);
                } else { document.execCommand('insertText', false, ${safeText}); } } catch(e){} })();`;
                view.executeJavaScript(js).catch(() => {});
            } catch (err) {
                // ignore
            }
        }
    } catch (err) {
        console.error('context-menu-command handler error', err);
    }
});