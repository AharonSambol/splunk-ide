let fileCounter = 1;
const SPLUNK_URL = 'http://localhost:8010/en-US/app/search/search';

const fs = require('node:fs');
const path = require('node:path');
const { ipcRenderer } = require('electron');

const newFileBtn = document.getElementById('new-file-btn');
const newFolderBtn = document.getElementById('new-folder-btn');
const newProjectBtn = document.getElementById('new-project-btn');
const openProjectBtn = document.getElementById('open-project-btn');
const projectNameLabel = document.getElementById('project-name');
const tabBar = document.getElementById('tab-bar');
const viewsContainer = document.getElementById('views-container');
const explorer = document.getElementById('explorer');
const quickSearchOverlay = document.getElementById('quick-search-overlay');
const quickSearchInput = document.getElementById('quick-search-input');
const quickSearchResults = document.getElementById('quick-search-results');
const newFileModal = document.getElementById('new-file-modal');
const newFileModalLabel = document.getElementById('new-file-modal-label');
const newFileModalInput = document.getElementById('new-file-modal-input');
const newFileFolderRow = document.getElementById('new-file-folder-row');
const newFileFolderSelect = document.getElementById('new-file-folder-select');
const newFileCreateBtn = document.getElementById('new-file-create');
const newFileCancelBtn = document.getElementById('new-file-cancel');

let files = [];
let folders = [];
let activeFileId = null;
let fileMru = [];
let currentProjectPath = null;
let currentProjectName = 'No project loaded';
let shiftTapCount = 0;
let shiftTimer = null;
let quickSearchSelectedIndex = 0;
let modalMode = 'create';
let modalTargetFileId = null;

newProjectBtn.addEventListener('click', createNewProject);
openProjectBtn.addEventListener('click', openProject);
newFileBtn.addEventListener('click', openNewFileModal);
newFolderBtn.addEventListener('click', openNewFolderModal);
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
document.addEventListener('keydown', handleGlobalKeydown);
quickSearchInput.addEventListener('input', updateQuickSearchResults);
quickSearchInput.addEventListener('keydown', handleQuickSearchKeydown);

window.onload = () => {
    updateProjectDisplay();
};

function handleWebviewShortcut(shortcut) {
    if (shortcut === 'ctrl-tab') {
        openMostRecentTab();
    } else if (shortcut === 'ctrl-left') {
        switchToPreviousTab();
    } else if (shortcut === 'ctrl-right') {
        switchToNextTab();
    } else if (shortcut === 'ctrl-n') {
        openNewFileModal();
    }
}

function createNewFile(name, parentFolder = '') {
    if (!currentProjectPath) {
        alert('Please create or open a project before creating files.');
        return;
    }

    const defaultName = `Search ${fileCounter}`;
    const fileName = name ? name.trim() || defaultName : defaultName;
    const normalizedFileName = fileName.replaceAll('\\', '/').trim();
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

    const normalizedFolder = folderNameRaw.replaceAll('\\', '/').trim();
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

function closeTab(fileId) {
    const file = files.find(f => f.id === fileId);
    if (!file) {
        return;
    }

    saveFileUrl(fileId);

    const tab = tabBar.querySelector(`.tab[data-target-id="${fileId}"]`);
    if (tab) {
        tab.remove();
    }

    const view = document.getElementById(fileId);
    if (view) {
        view.remove();
    }

    fileMru = fileMru.filter(id => id !== fileId);

    if (activeFileId === fileId) {
        const remainingTabs = Array.from(tabBar.querySelectorAll('.tab'));
        if (remainingTabs.length > 0) {
            switchToFile(remainingTabs[0].dataset.targetId);
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
    const normalizedRelative = path.normalize(fileName).split(path.sep).filter(segment => segment && segment !== '..').map(segment => segment.replace(/[<>:"|?*]/g, '_')).join(path.sep);
    let filePath = path.join(currentProjectPath, normalizedRelative);
    if (!path.extname(filePath)) {
        filePath += '.spl';
    }
    return filePath;
}

function ensureDirectoryExists(directoryPath) {
    if (!fs.existsSync(directoryPath)) {
        ensureDirectoryExists(path.dirname(directoryPath));
        fs.mkdirSync(directoryPath);
    }
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

function getFileFolder(fileName) {
    const lastSlash = fileName.lastIndexOf('/');
    return lastSlash === -1 ? '' : fileName.slice(0, lastSlash);
}

function moveFile(fileId, targetFolder) {
    const file = files.find(f => f.id === fileId);
    if (!file) {
        return;
    }

    const fileName = file.name.split('/').pop();
    const newRelativeName = targetFolder ? `${targetFolder}/${fileName}` : fileName;
    const newPath = getProjectFilePath(newRelativeName);
    const oldPath = file.path;

    if (newPath === oldPath) {
        return;
    }

    ensureDirectoryExists(path.dirname(newPath));
    fs.renameSync(oldPath, newPath);
    file.name = newRelativeName;
    file.path = newPath;
    const movedParent = getFileFolder(newRelativeName);
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

    loadProject(result.filePaths[0]);
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

    loadProject(result.filePaths[0]);
}

function loadProject(projectPath) {
    currentProjectPath = projectPath;
    currentProjectName = path.basename(projectPath);
    updateProjectDisplay();

    files = [];
    folders = [];
    fileMru = [];
    activeFileId = null;
    clearOpenTabs();

    folders = scanProjectFolders(projectPath);

    const filePaths = scanProjectFiles(projectPath);
    filePaths.forEach(filePath => {
        const url = fs.readFileSync(filePath, 'utf8').trim() || SPLUNK_URL;
        const name = path.relative(projectPath, filePath).replace(/\.spl$/i, '').split(path.sep).join('/');
        files.push({ id: `splunk-view-${Date.now()}-${Math.random()}`, name, path: filePath, url });
    });

    updateExplorer();
}

function scanProjectFiles(directory) {
    let results = [];
    fs.readdirSync(directory, { withFileTypes: true }).forEach(dirent => {
        const fullPath = path.join(directory, dirent.name);
        if (dirent.isDirectory()) {
            results = results.concat(scanProjectFiles(fullPath));
        } else if (dirent.isFile() && path.extname(dirent.name).toLowerCase() === '.spl') {
            results.push(fullPath);
        }
    });
    return results;
}

function scanProjectFolders(directory) {
    let results = [];
    fs.readdirSync(directory, { withFileTypes: true }).forEach(dirent => {
        const fullPath = path.join(directory, dirent.name);
        if (dirent.isDirectory()) {
            const relativePath = path.relative(currentProjectPath, fullPath).split(path.sep).join('/');
            results.push(relativePath);
            results = results.concat(scanProjectFolders(fullPath));
        }
    });
    return results;
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
    tabBar.appendChild(tab);
}

function createView(file) {
    const view = document.createElement('webview');
    view.src = file.url || SPLUNK_URL;
    view.id = file.id;
    view.setAttribute('allowpopups', '');
    // use a preload script so we can capture keys inside the guest page
    try {
        const preloadPath = path.join(__dirname, 'webview-preload.js');
        view.setAttribute('preload', preloadPath);
    } catch (err) {
        console.warn('Failed to set webview preload:', err);
    }
    viewsContainer.appendChild(view);

    // Listen for key events forwarded from the webview preload
    view.addEventListener('ipc-message', (event) => {
        if (event.channel === 'webview-keydown') {
            handleWebviewKeydown(event.args[0] || {});
        }
    });

    view.addEventListener('before-input-event', (event) => {
        const inputEvent = event.inputEvent;
        if (inputEvent.control && inputEvent.key.toLowerCase() === 'tab') {
            event.preventDefault();
            handleWebviewShortcut('ctrl-tab');
        }
        if (inputEvent.control && inputEvent.key.toLowerCase() === 'n') {
            event.preventDefault();
            handleWebviewShortcut('ctrl-n');
        }
        if (inputEvent.control && inputEvent.key === 'ArrowLeft') {
            event.preventDefault();
            handleWebviewShortcut('ctrl-left');
        }
        if (inputEvent.control && inputEvent.key === 'ArrowRight') {
            event.preventDefault();
            handleWebviewShortcut('ctrl-right');
        }
    });
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

function handleWebviewKeydown(d) {
    if (!d || typeof d.key !== 'string') {
        return;
    }

    const key = d.key.toLowerCase();
    const ctrlOrMeta = !!(d.ctrl || d.meta);

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

    if (!ctrlOrMeta) {
        return;
    }

    if (key === 'tab') {
        handleWebviewShortcut('ctrl-tab');
    } else if (key === 'n') {
        handleWebviewShortcut('ctrl-n');
    } else if (d.code === 'ArrowLeft' || key === 'arrowleft') {
        handleWebviewShortcut('ctrl-left');
    } else if (d.code === 'ArrowRight' || key === 'arrowright') {
        handleWebviewShortcut('ctrl-right');
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

function buildFileTree(fileList, folderList) {
    const root = { children: [], files: [] };
    const map = new Map();

    function ensureFolderNode(pathSegments) {
        let current = root;
        let accumulatedPath = '';

        for (let segment of pathSegments) {
            accumulatedPath = accumulatedPath ? `${accumulatedPath}/${segment}` : segment;
            let folder = map.get(accumulatedPath);
            if (!folder) {
                folder = { name: segment, path: accumulatedPath, children: [], files: [] };
                map.set(accumulatedPath, folder);
                if (current === root) {
                    root.children.push(folder);
                } else {
                    current.children.push(folder);
                }
            }
            current = folder;
        }

        return current;
    }

    folderList.forEach(folderPath => {
        const segments = folderPath.split('/').map(segment => segment.trim()).filter(Boolean);
        if (segments.length > 0) {
            ensureFolderNode(segments);
        }
    });

    fileList.forEach(file => {
        const segments = file.name.split('/').map(segment => segment.trim()).filter(Boolean);
        if (segments.length === 0) {
            root.files.push({ ...file, displayName: file.name });
            return;
        }

        if (segments.length === 1) {
            root.files.push({ ...file, displayName: segments[0] });
            return;
        }

        const parentFolder = ensureFolderNode(segments.slice(0, -1));
        parentFolder.files.push({ ...file, displayName: segments[segments.length - 1] });
    });

    return root;
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
    if (quickSearchOverlay.classList.contains('visible') || newFileModal.classList.contains('visible')) {
        return;
    }

    if (event.key === 'Shift') {
        shiftTapCount += 1;

        if (shiftTapCount === 1) {
            shiftTimer = globalThis.setTimeout(() => {
                shiftTapCount = 0;
            }, 400);
            return;
        }

        if (shiftTapCount === 2) {
            globalThis.clearTimeout(shiftTimer);
            shiftTapCount = 0;
            openQuickSearch();
        }
    }

    if (event.ctrlKey && event.key === 'Tab') {
        event.preventDefault();
        openMostRecentTab();
        return;
    }

    if (event.ctrlKey && event.key === 'ArrowLeft') {
        event.preventDefault();
        switchToPreviousTab();
        return;
    }

    if (event.ctrlKey && event.key === 'ArrowRight') {
        event.preventDefault();
        switchToNextTab();
        return;
    }

    if (event.ctrlKey && (event.key === 'n' || event.key === 'N')) {
        event.preventDefault();
        openNewFileModal();
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
    const tabs = Array.from(tabBar.querySelectorAll('.tab'));
    const activeIndex = tabs.findIndex(tab => tab.dataset.targetId === activeFileId);

    if (activeIndex > 0) {
        const previousTabId = tabs[activeIndex - 1].dataset.targetId;
        switchToFile(previousTabId);
    }
}

function switchToNextTab() {
    const tabs = Array.from(tabBar.querySelectorAll('.tab'));
    const activeIndex = tabs.findIndex(tab => tab.dataset.targetId === activeFileId);

    if (activeIndex < tabs.length - 1) {
        const nextTabId = tabs[activeIndex + 1].dataset.targetId;
        switchToFile(nextTabId);
    }
}

function openQuickSearch() {
    quickSearchOverlay.classList.add('visible');
    quickSearchInput.value = '';
    quickSearchSelectedIndex = 0;
    updateQuickSearchResults();
    quickSearchInput.focus();
}

function closeQuickSearch() {
    quickSearchOverlay.classList.remove('visible');
}

function updateQuickSearchResults() {
    const query = quickSearchInput.value.trim().toLowerCase();
    const results = files
        .map(file => ({
            ...file,
            searchLabel: file.name.split('/').pop()
        }))
        .filter(file => file.name.toLowerCase().includes(query) || file.searchLabel.toLowerCase().includes(query));

    quickSearchResults.innerHTML = '';

    if (results.length === 0) {
        const empty = document.createElement('div');
        empty.id = 'quick-search-empty';
        empty.textContent = 'No matching files.';
        quickSearchResults.appendChild(empty);
        return;
    }

    results.forEach((file, index) => {
        const item = document.createElement('div');
        item.className = 'quick-search-item';
        item.textContent = file.name;
        item.dataset.fileId = file.id;

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
