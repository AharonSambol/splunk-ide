let fileCounter = 1;
const SPLUNK_URL = 'http://localhost:8010/en-US/app/search/search';

const fs = require('node:fs');
const path = require('node:path');
const { ipcRenderer } = require('electron');

const newFileBtn = document.getElementById('new-file-btn');
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
const newFileCreateBtn = document.getElementById('new-file-create');
const newFileCancelBtn = document.getElementById('new-file-cancel');

let files = [];
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

function createNewFile(name) {
    if (!currentProjectPath) {
        alert('Please create or open a project before creating files.');
        return;
    }

    const defaultName = `Search ${fileCounter}`;
    const fileName = name ? name.trim() || defaultName : defaultName;
    const fileId = `splunk-view-${Date.now()}-${fileCounter}`;
    fileCounter++;

    const filePath = getProjectFilePath(fileName);
    ensureDirectoryExists(path.dirname(filePath));
    fs.writeFileSync(filePath, SPLUNK_URL, 'utf8');

    const file = { id: fileId, name: fileName, path: filePath, url: SPLUNK_URL };
    files.push(file);
    fileMru.unshift(fileId);

    createTab(file);
    createView(file);
    updateExplorer();
    switchToFile(fileId);
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
    if (!file || !file.path) {
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
    fileMru = [];
    activeFileId = null;
    clearOpenTabs();

    const filePaths = scanProjectFiles(projectPath);
    filePaths.forEach(filePath => {
        const url = fs.readFileSync(filePath, 'utf8').trim() || SPLUNK_URL;
        const name = path.relative(projectPath, filePath).replace(/\.spl$/i, '');
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

function clearOpenTabs() {
    while (tabBar.firstChild) {
        tabBar.firstChild.remove();
    }
    document.querySelectorAll('webview').forEach(view => view.remove());
}

function updateProjectDisplay() {
    projectNameLabel.textContent = currentProjectPath ? currentProjectName : 'No project loaded';
    projectNameLabel.title = currentProjectPath || '';
    newFileBtn.disabled = !currentProjectPath;
}

function openNewFileModal() {
    modalMode = 'create';
    modalTargetFileId = null;
    newFileModalLabel.textContent = 'New Search File Name';
    newFileModalInput.value = `Search ${fileCounter}`;
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
    newFileModalLabel.textContent = modalMode === 'rename'
        ? `Rename "${files.find(f => f.id === modalTargetFileId)?.name.split('/').pop() || ''}"`
        : 'New Search File Name';
    newFileCreateBtn.textContent = modalMode === 'rename' ? 'Rename' : 'Create';
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
    if (modalMode === 'rename' && modalTargetFileId) {
        renameFile(modalTargetFileId, name);
    } else {
        createNewFile(name);
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
    viewsContainer.appendChild(view);

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

function updateExplorer() {
    explorer.innerHTML = '';

    if (files.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'explorer-item';
        empty.textContent = 'No files yet. Create a new search file.';
        explorer.appendChild(empty);
        return;
    }

    const root = buildFileTree(files);
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

function buildFileTree(fileList) {
    const root = { children: [], files: [] };
    const map = new Map();

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

        let currentFolder = root;
        for (let i = 0; i < segments.length - 1; i++) {
            const segment = segments[i];
            const path = segments.slice(0, i + 1).join('/');
            let folder = map.get(path);
            if (!folder) {
                folder = { name: segment, path, children: [], files: [] };
                map.set(path, folder);
                if (i === 0) {
                    root.children.push(folder);
                } else {
                    const parentPath = segments.slice(0, i).join('/');
                    const parentFolder = map.get(parentPath);
                    parentFolder.children.push(folder);
                }
            }
            currentFolder = folder;
        }

        currentFolder.files.push({ ...file, displayName: segments[segments.length - 1] });
    });

    return root;
}

function renderFolderNode(folder) {
    const details = document.createElement('details');
    details.className = 'folder';
    details.open = true;

    const summary = document.createElement('summary');
    summary.textContent = folder.name;
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

    const deleteButton = document.createElement('button');
    deleteButton.className = 'file-action file-delete';
    deleteButton.type = 'button';
    deleteButton.textContent = 'Delete';
    deleteButton.addEventListener('click', event => {
        event.stopPropagation();
        deleteFile(file.id);
    });

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
    switchToFile(fileId);
}
