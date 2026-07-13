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
const { decodeSearchText, extractQueryFromUrl, getFileFolder, parseSavedSearchFromUrl } = require('./lib/url-utils');
const { getSavedSearchId, getSavedSearchPath } = require('./lib/saved-search-id');
const { openSavedSearchHistory } = require('./lib/saved-search-open');
const { ensureRemote, pushSharedHistory } = require('./lib/git-sync');
const {
    filterQuickSearchResults,
    getQuickSearchEmptyMessage,
    moveQuickSearchSelection,
} = require('./lib/quick-search');
const {
    getFileStatus,
    hasDraftChanges,
    getDraftStash,
    saveDraftStash,
    popDraftStash,
    listVersions,
    readCurrentQuery,
    saveVersion,
    restoreVersion,
    renameQueryFile,
    consumeAutoSave,
    setVersionTag,
    deleteVersionTag,
    listVersionTags,
    formatSplunkSaveTagName
} = require('./lib/query-versions');
const { renderExplorer } = require('./lib/render-explorer');
const { createTabElement, setActiveTab, updateTabTitle } = require('./lib/render-tabs');
const { renderQuickSearchResults } = require('./lib/render-quick-search');
const { attachWebviewSelectionDragHandlers } = require('./lib/webview-selection-drag-handlers');
const { attachParentSelectionCleanup } = require('./lib/parent-selection-cleanup');
const { diffLines, renderDiffHtml } = require('./lib/diff-lines');

attachParentSelectionCleanup(document);

const newFileBtn = document.getElementById('new-file-btn');
const newProjectBtn = document.getElementById('new-project-btn');
const openProjectBtn = document.getElementById('open-project-btn');
const copyUrlBtn = document.getElementById('copy-url-btn');
const prevPageBtn = document.getElementById('prev-page-btn');
const nextPageBtn = document.getElementById('next-page-btn');
const projectNameLabel = document.getElementById('project-name');
const tabBar = document.getElementById('tab-bar');
const viewsContainer = document.getElementById('views-container');
const explorer = document.getElementById('explorer');
const historyTabs = document.querySelectorAll('.history-tab');
const sidebar = document.getElementById('sidebar');
const sidebarCollapseBtn = document.getElementById('sidebar-collapse-btn');
const sidebarReopenBtn = document.getElementById('sidebar-reopen');
const sidebarResize = document.getElementById('sidebar-resize');
const querySidebarResize = document.getElementById('query-sidebar-resize');
const sidebarDragOverlay = document.getElementById('sidebar-drag-overlay');
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

// Query history elements
const querySidebar = document.getElementById('query-sidebar');
const queryHistoryTitle = document.getElementById('query-history-title');
const queryHistoryStatus = document.getElementById('query-history-status');
const queryHistoryClose = document.getElementById('query-history-close');
const queryVersionList = document.getElementById('query-version-list');
const tagPopup = document.getElementById('tag-popup');
const tagPopupInput = document.getElementById('tag-popup-input');
const tagPopupCancel = document.getElementById('tag-popup-cancel');
const tagPopupClear = document.getElementById('tag-popup-clear');
const tagPopupSave = document.getElementById('tag-popup-save');
const queryVersionPreviewText = document.getElementById('query-version-preview-text');
const queryPreviewModeBtns = document.querySelectorAll('.preview-mode-btn');
const querySaveMessage = document.getElementById('query-save-message');
const querySaveBtn = document.getElementById('query-save-btn');
const queryRestoreBtn = document.getElementById('query-restore-btn');
const confirmModal = document.getElementById('confirm-modal');
const confirmModalTitle = document.getElementById('confirm-modal-title');
const confirmModalBody = document.getElementById('confirm-modal-body');
const confirmCancelBtn = document.getElementById('confirm-cancel');
const confirmOkBtn = document.getElementById('confirm-ok');
const gitSyncSettingsBtn = document.getElementById('git-sync-settings-btn');
const gitSyncSettingsModal = document.getElementById('git-sync-settings-modal');
const gitSyncRemoteUrlInput = document.getElementById('git-sync-remote-url');
const gitSyncRemoteNameInput = document.getElementById('git-sync-remote-name');
const gitSyncSharedBranchInput = document.getElementById('git-sync-shared-branch');
const gitSyncUserNameInput = document.getElementById('git-sync-user-name');
const gitSyncUserEmailInput = document.getElementById('git-sync-user-email');
const gitSyncSettingsStatus = document.getElementById('git-sync-settings-status');
const gitSyncSettingsCancelBtn = document.getElementById('git-sync-settings-cancel');
const gitSyncSettingsSaveBtn = document.getElementById('git-sync-settings-save');
const statusFile = document.getElementById('status-file');
const statusSave = document.getElementById('status-save');
const statusVersions = document.getElementById('status-versions');

const QUERY_SIDEBAR_COLLAPSED_KEY = 'splunk-ide-query-sidebar-collapsed';
const QUERY_SIDEBAR_WIDTH_KEY = 'splunk-ide-query-sidebar-width';
const PROJECT_SIDEBAR_COLLAPSED_KEY = 'splunk-ide-project-sidebar-collapsed';
const PROJECT_SIDEBAR_WIDTH_KEY = 'splunk-ide-project-sidebar-width';
const QUERY_SIDEBAR_MIN_WIDTH = 220;
const QUERY_SIDEBAR_MAX_WIDTH = 560;
const QUERY_SIDEBAR_DEFAULT_WIDTH = 320;
const PROJECT_SIDEBAR_MIN_WIDTH = 180;
const PROJECT_SIDEBAR_MAX_WIDTH = 520;
const PROJECT_SIDEBAR_DEFAULT_WIDTH = 260;
const DRAFT_VERSION_HASH = '__draft__';

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
let gitSyncSettings = {
    remoteUrl: '',
    remoteName: 'origin',
    sharedBranch: 'main',
    gitUserName: '',
    gitUserEmail: ''
};
let queryVersions = [];
let queryHasUnsavedChanges = false;
let selectedVersionHashes = [];

function getPrimarySelectedHash() {
    return selectedVersionHashes.length ? selectedVersionHashes[selectedVersionHashes.length - 1] : null;
}

function isMultiVersionCompare() {
    return selectedVersionHashes.length === 2
        && !selectedVersionHashes.includes(DRAFT_VERSION_HASH);
}

function updateVersionSelectionUi() {
    const primary = getPrimarySelectedHash();
    queryRestoreBtn.disabled = !primary || primary === DRAFT_VERSION_HASH || isMultiVersionCompare();
    queryVersionList.querySelectorAll('.query-version-item').forEach(item => {
        applyVersionRowClasses(item, item.dataset.hash);
    });
    renderVersionPreview();
}

function handleVersionRowClick(event, hash) {
    if (hash === DRAFT_VERSION_HASH) {
        selectDraftVersion();
        return;
    }
    if (event.metaKey || event.ctrlKey) {
        toggleVersionMultiSelect(hash);
        return;
    }
    const version = queryVersions.find(v => v.hash === hash);
    if (version) {
        selectQueryVersion(version);
    }
}

function toggleVersionMultiSelect(hash) {
    if (hash === DRAFT_VERSION_HASH) {
        return;
    }
    let hashes = selectedVersionHashes.filter(h => h !== DRAFT_VERSION_HASH);
    const idx = hashes.indexOf(hash);
    if (idx >= 0) {
        hashes.splice(idx, 1);
    } else {
        hashes.push(hash);
        if (hashes.length > 2) {
            hashes.shift();
        }
    }
    selectedVersionHashes = hashes;
    updateVersionSelectionUi();
}
let queryRefreshGeneration = 0;
let currentQueryText = '';
let previewMode = 'preview';
let historySidebarMode = 'history';
let versionTags = [];
let tagPopupTargetHash = null;
let tagPopupClearMode = false;
let confirmResolve = null;
const restoreParentByFileId = new Map();
const forcedDraftByFileId = new Set();
const userDraftByFileId = new Set();

const SAVED_SEARCH_SYNC_STATUS = {
    REMOTE_CHANGED: 'Remote changed',
    LOCAL_NOT_PUSHED: 'Local version not pushed',
    PUSH_FAILED: 'Push failed'
};

function classifyPushSyncStatus(message) {
    const normalized = String(message || '').toLowerCase();
    if (/rejected|non-fast-forward|fetch first|failed to push some refs|would be overwritten/.test(normalized)) {
        return SAVED_SEARCH_SYNC_STATUS.LOCAL_NOT_PUSHED;
    }
    return SAVED_SEARCH_SYNC_STATUS.PUSH_FAILED;
}

async function getLatestFileCommit(git, ref, relativePath) {
    try {
        return (await git.raw(['rev-list', '-1', ref, '--', relativePath])).trim();
    } catch {
        return '';
    }
}

function formatQueryHistoryStatus(file, { hasUnsavedChanges, syncStatus } = {}) {
    if (!file?.savedSearch) {
        return hasUnsavedChanges ? 'Unsaved changes' : 'Up to date';
    }

    const parts = [];
    if (hasUnsavedChanges) {
        parts.push('Unsaved draft');
    } else if (!syncStatus) {
        parts.push('Up to date');
    }
    if (syncStatus) {
        parts.push(syncStatus);
    }
    return parts.join(' · ') || 'Up to date';
}

newProjectBtn.addEventListener('click', createNewProject);
openProjectBtn.addEventListener('click', openProject);
copyUrlBtn.addEventListener('click', copyActiveFileUrl);
newFileBtn.addEventListener('click', openNewFileModal);
newFileCreateBtn.addEventListener('click', confirmNewFileCreation);
newFileCancelBtn.addEventListener('click', closeNewFileModal);
gitSyncSettingsBtn.addEventListener('click', openGitSyncSettingsModal);
gitSyncSettingsCancelBtn.addEventListener('click', closeGitSyncSettingsModal);
gitSyncSettingsSaveBtn.addEventListener('click', saveGitSyncSettingsFromModal);

queryHistoryClose.addEventListener('click', () => setQueryHistoryPanelOpen(false));
sidebarCollapseBtn.addEventListener('click', () => setProjectSidebarCollapsed(true));
sidebarReopenBtn.addEventListener('click', () => setProjectSidebarCollapsed(false));
querySaveBtn.addEventListener('click', saveQueryVersion);
querySaveMessage.addEventListener('keydown', event => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        if (!querySaveBtn.disabled) {
            saveQueryVersion();
        }
    }
});
queryRestoreBtn.addEventListener('click', restoreSelectedVersion);
historyTabs.forEach(tab => {
    tab.addEventListener('click', () => setHistorySidebarMode(tab.dataset.mode));
});
tagPopupCancel.addEventListener('click', closeTagPopup);
tagPopupClear.addEventListener('click', () => clearTagFromPopup());
tagPopupSave.addEventListener('click', () => saveTagFromPopup());
tagPopupInput.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
        event.preventDefault();
        if (tagPopupClearMode) {
            clearTagFromPopup();
        } else {
            saveTagFromPopup();
        }
    }
    if (event.key === 'Escape') {
        event.preventDefault();
        closeTagPopup();
    }
});
document.addEventListener('mousedown', event => {
    if (tagPopup.classList.contains('visible') && !tagPopup.contains(event.target)) {
        closeTagPopup();
    }
});
queryPreviewModeBtns.forEach(btn => {
    btn.addEventListener('click', () => setPreviewMode(btn.dataset.mode));
});
confirmCancelBtn.addEventListener('click', () => closeConfirmModal(false));
confirmOkBtn.addEventListener('click', () => closeConfirmModal(true));
confirmModal.addEventListener('keydown', event => {
    if (!confirmModal.classList.contains('visible')) {
        return;
    }
    if (event.key === 'Escape') {
        event.preventDefault();
        closeConfirmModal(false);
    }
    if (event.key === 'Enter') {
        event.preventDefault();
        closeConfirmModal(true);
    }
});
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
gitSyncSettingsModal.addEventListener('keydown', event => {
    if (!gitSyncSettingsModal.classList.contains('visible')) {
        return;
    }
    if (event.key === 'Escape') {
        event.preventDefault();
        closeGitSyncSettingsModal();
    }
});
document.addEventListener('keydown', handleGlobalKeydown);
quickSearchInput.addEventListener('input', updateQuickSearchResults);
quickSearchInput.addEventListener('keydown', handleQuickSearchKeydown);

window.onload = async () => {
    initializeLayoutControls();
    await loadGitSyncSettings();
    const workspacePath = await ipcRenderer.invoke('get-default-workspace');
    await loadProject(workspacePath);
    if (files.length === 0) {
        createNewFile('Search 1');
    } else {
        openStartupSearch();
    }
};

async function loadGitSyncSettings() {
    gitSyncSettings = await ipcRenderer.invoke('get-git-sync-settings');
}

function populateGitSyncSettingsForm() {
    gitSyncRemoteUrlInput.value = gitSyncSettings.remoteUrl || '';
    gitSyncRemoteNameInput.value = gitSyncSettings.remoteName || 'origin';
    gitSyncSharedBranchInput.value = gitSyncSettings.sharedBranch || 'main';
    gitSyncUserNameInput.value = gitSyncSettings.gitUserName || '';
    gitSyncUserEmailInput.value = gitSyncSettings.gitUserEmail || '';
}

function setGitSyncSettingsStatus(message, type = '') {
    gitSyncSettingsStatus.textContent = message;
    gitSyncSettingsStatus.classList.remove('error', 'success');
    if (type) {
        gitSyncSettingsStatus.classList.add(type);
    }
}

function openGitSyncSettingsModal() {
    populateGitSyncSettingsForm();
    setGitSyncSettingsStatus('');
    gitSyncSettingsModal.classList.add('visible');
    setTimeout(() => gitSyncRemoteUrlInput.focus(), 0);
}

function closeGitSyncSettingsModal() {
    gitSyncSettingsModal.classList.remove('visible');
    setGitSyncSettingsStatus('');
}

async function saveGitSyncSettingsFromModal() {
    const settings = {
        remoteUrl: gitSyncRemoteUrlInput.value,
        remoteName: gitSyncRemoteNameInput.value,
        sharedBranch: gitSyncSharedBranchInput.value,
        gitUserName: gitSyncUserNameInput.value,
        gitUserEmail: gitSyncUserEmailInput.value
    };

    gitSyncSettingsSaveBtn.disabled = true;
    setGitSyncSettingsStatus('Saving...');

    try {
        const result = await ipcRenderer.invoke('set-git-sync-settings', settings);
        if (!result || !result.ok) {
            setGitSyncSettingsStatus(result?.message || 'Failed to save settings', 'error');
            return;
        }
        await loadGitSyncSettings();
        closeGitSyncSettingsModal();
    } catch (error) {
        setGitSyncSettingsStatus(error.message || 'Failed to save settings', 'error');
    } finally {
        gitSyncSettingsSaveBtn.disabled = false;
    }
}

function openStartupSearch() {
    let fileId = fileMru.find(id => files.some(file => file.id === id));
    if (!fileId) {
        const sorted = [...files].sort((a, b) => {
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

    const savedSearch = parseSavedSearchFromUrl(url);
    const normalizedFileName = normalizeRelativePath(name);
    const fileId = `splunk-view-${Date.now()}-${fileCounter}`;
    fileCounter++;

    let relativeFileName;
    let filePath;
    if (savedSearch) {
        const canonicalRelative = getSavedSearchPath(savedSearch);
        relativeFileName = canonicalRelative.replace(/\.spl$/i, '');
        filePath = path.join(currentProjectPath, ...canonicalRelative.split('/'));
    } else {
        relativeFileName = parentFolder ? `${parentFolder}/${normalizedFileName}` : normalizedFileName;
        filePath = getProjectFilePath(relativeFileName);
    }

    ensureDirectoryExists(path.dirname(filePath));
    fs.writeFileSync(filePath, url, 'utf8');

    const file = { id: fileId, name: relativeFileName, path: filePath, url };
    if (savedSearch) {
        file.savedSearch = savedSearch;
    }
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
    onQueryFileChanged(fileId);
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
    onQueryFileChanged(fileId);
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

function getViewUrl(fileId) {
    const view = document.getElementById(fileId);
    if (!view) {
        return '';
    }
    try {
        return view.getURL() || '';
    } catch {
        return '';
    }
}

function renderEmptySavedSearchHistory() {
    queryHistoryTitle.textContent = 'Query History';
    queryVersionList.innerHTML = '<div style="padding:12px;color:#888;">Open a saved search to see its history.</div>';
    currentQueryText = '';
    queryHasUnsavedChanges = false;
    queryVersions = [];
    versionTags = [];
    selectedVersionHashes = [];
    renderVersionPreview();
    queryHistoryStatus.textContent = '';
    queryHistoryStatus.classList.remove('dirty');
    queryRestoreBtn.disabled = true;
    querySaveBtn.disabled = true;
    updateStatusBar({ versionCount: 0, hasChanges: false });
}

function clearSavedSearchContext(file, url) {
    delete file.savedSearch;
    file.savedSearchSyncStatus = '';
    forcedDraftByFileId.delete(file.id);
    userDraftByFileId.delete(file.id);
    restoreParentByFileId.delete(file.id);
    if (url && url !== file.url) {
        file.url = url;
        if (fs.existsSync(file.path)) {
            fs.writeFileSync(file.path, url, 'utf8');
        }
        userDraftByFileId.add(file.id);
    }
    selectedVersionHashes = [];
    if (file.id === activeFileId) {
        renderEmptySavedSearchHistory();
    }
    onQueryFileChanged(file.id);
}

async function syncFileFromViewUrl(fileId) {
    const file = files.find(f => f.id === fileId);
    if (!file?.path) {
        return;
    }

    const url = getViewUrl(fileId);
    if (!url) {
        return;
    }

    const savedSearch = parseSavedSearchFromUrl(url);
    if (!savedSearch) {
        if (file.savedSearch) {
            clearSavedSearchContext(file, url);
        } else if (url !== file.url) {
            file.url = url;
            fs.writeFileSync(file.path, url, 'utf8');
            userDraftByFileId.add(fileId);
            onQueryFileChanged(fileId, { refreshHistory: true });
        }
        return;
    }

    const prevId = file.savedSearch ? getSavedSearchId(file.savedSearch) : '';
    const nextId = getSavedSearchId(savedSearch);
    const urlChanged = url !== file.url;
    const contextChanged = !file.savedSearch || prevId !== nextId;

    if (urlChanged) {
        file.url = url;
    }

    if (contextChanged || urlChanged) {
        await applySavedSearchToFile(file, savedSearch, url);
        return;
    }

    if (fileId === activeFileId) {
        await enterSavedSearchHistory(file, url);
        onQueryFileChanged(fileId, { refreshHistory: true });
    }
}

function saveFileUrl(fileId) {
    void syncFileFromViewUrl(fileId);
}

async function handleSplunkSave(fileId) {
    const file = files.find(f => f.id === fileId);
    if (!file?.savedSearch || !currentGit) {
        return;
    }

    await syncFileFromViewUrl(fileId);
    const relativePath = getRelativePath(file);
    const parentHash = restoreParentByFileId.get(file.id);
    const author = getGitAuthorFromSettings();
    const saveOptions = {
        author,
        savedSearch: {
            ...file.savedSearch,
            id: getSavedSearchId(file.savedSearch)
        }
    };

    try {
        const result = await saveVersion(currentGit, relativePath, 'Splunk save', parentHash, saveOptions);
        let hash = parentHash;
        if (result.saved && result.hash) {
            hash = result.hash;
            restoreParentByFileId.set(file.id, hash);
            forcedDraftByFileId.delete(file.id);
            userDraftByFileId.delete(file.id);
            await pushSavedSearchHistoryAfterSave(file);
        } else if (!hash) {
            const versions = await listVersions(currentGit, relativePath, 1);
            hash = versions[0]?.hash;
        }
        if (!hash) {
            return;
        }

        const tagName = formatSplunkSaveTagName(gitSyncSettings.gitUserName, hash);
        await setVersionTag(currentGit, relativePath, hash, tagName);
        if (fileId === activeFileId) {
            await refreshQueryHistory();
        }
    } catch (err) {
        console.error('Splunk save tag failed', err);
    }
}

async function applySavedSearchToFile(file, savedSearch, url) {
    file.savedSearch = savedSearch;

    const canonicalRelative = getSavedSearchPath(savedSearch);
    const canonicalPath = path.join(currentProjectPath, ...canonicalRelative.split('/'));

    if (file.path === canonicalPath) {
        await enterSavedSearchHistory(file, url);
        fs.writeFileSync(file.path, url, 'utf8');
        await syncSavedSearchTrackedBase(file);
        onQueryFileChanged(file.id, { refreshHistory: true });
        return;
    }

    ensureDirectoryExists(path.dirname(canonicalPath));

    if (fs.existsSync(file.path)) {
        fs.writeFileSync(file.path, url, 'utf8');
    }
    if (fs.existsSync(canonicalPath) && canonicalPath !== file.path) {
        if (fs.existsSync(file.path)) {
            fs.unlinkSync(file.path);
        }
        file.path = canonicalPath;
    } else if (fs.existsSync(file.path) && file.path !== canonicalPath) {
        fs.renameSync(file.path, canonicalPath);
        file.path = canonicalPath;
    } else if (!fs.existsSync(canonicalPath)) {
        fs.writeFileSync(canonicalPath, url, 'utf8');
        file.path = canonicalPath;
    }

    file.name = canonicalRelative.replace(/\.spl$/i, '');
    addFolderForPath(getFileFolder(file.name));
    updateTabLabel(file);
    updateExplorer();
    await enterSavedSearchHistory(file, url);
    await syncSavedSearchTrackedBase(file);
    onQueryFileChanged(file.id, { refreshHistory: true });
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

async function moveFile(fileId, targetFolder) {
    const file = files.find(f => f.id === fileId);
    if (!file) {
        return;
    }

    const newPath = getMoveTargetPath(currentProjectPath, file.name, targetFolder, path);
    const oldPath = file.path;
    const oldRelative = getRelativePath(file);

    if (newPath === oldPath) {
        return;
    }

    if (currentGit) {
        await renameQueryFile(currentGit, currentProjectPath, oldRelative, path.relative(currentProjectPath, newPath).split(path.sep).join('/'));
    } else {
        ensureDirectoryExists(path.dirname(newPath));
        fs.renameSync(oldPath, newPath);
    }

    file.name = path.relative(currentProjectPath, newPath).replace(/\.spl$/i, '').split(path.sep).join('/');
    file.path = newPath;
    const movedParent = getFileFolder(file.name);
    if (movedParent) addFolderForPath(movedParent);
    updateExplorer();
    onQueryFileChanged(fileId, { refreshHistory: true });
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
    await initializeQueryVersions();

    files = [];
    folders = [];
    fileMru = [];
    activeFileId = null;
    restoreParentByFileId.clear();
    forcedDraftByFileId.clear();
    userDraftByFileId.clear();
    clearOpenTabs();

    folders = scanProjectFolders(projectPath);

    const filePaths = scanProjectFiles(currentProjectPath);
    const sortedPaths = [...filePaths].sort((left, right) => {
        const leftCanonical = left.includes(`${path.sep}saved-searches${path.sep}`) ? 0 : 1;
        const rightCanonical = right.includes(`${path.sep}saved-searches${path.sep}`) ? 0 : 1;
        return leftCanonical - rightCanonical;
    });
    const seenSavedSearchIds = new Set();
    for (const filePath of sortedPaths) {
        const url = fs.readFileSync(filePath, 'utf8').trim() || SPLUNK_URL;
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
            files.push(fileRecord);
            await applySavedSearchToFile(fileRecord, savedSearch, url);
        } else {
            files.push(fileRecord);
        }
    }

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
    newFileBtn.disabled = !currentProjectPath;
}

function openNewFileModal() {
    modalMode = 'create';
    modalTargetFileId = null;
    newFileModalLabel.textContent = 'New Search';
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
        newFileModalLabel.textContent = 'New Search';
        newFileFolderRow.style.display = 'none';
        newFileModalInput.disabled = false;
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
        createNewFile(name);
    }
    closeNewFileModal();
}

async function renameFile(fileId, newName) {
    const file = files.find(f => f.id === fileId);
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
    const oldRelative = getRelativePath(file);

    if (newPath === file.path) {
        return;
    }

    if (currentGit) {
        await renameQueryFile(
            currentGit,
            currentProjectPath,
            oldRelative,
            path.relative(currentProjectPath, newPath).split(path.sep).join('/')
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

function updateTabLabel(file) {
    updateTabTitle(tabBar, file.id, file.name);
}

function createTab(file) {
    const tab = createTabElement(document, file, activeFileId, {
        onClose: closeTab,
        onSwitch: switchToFile,
    });

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
            saveFileUrl(file.id);
        } else if (event.channel === 'splunk-save') {
            void handleSplunkSave(file.id);
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

    const syncUrlFromView = () => {
        void syncFileFromViewUrl(file.id);
    };

    view.addEventListener('did-navigate', updateNavState);
    view.addEventListener('did-navigate-in-page', updateNavState);
    view.addEventListener('did-stop-loading', updateNavState);
    view.addEventListener('dom-ready', updateNavState);
    view.addEventListener('did-navigate-in-page', syncUrlFromView);
    view.addEventListener('did-navigate', syncUrlFromView);
    view.addEventListener('did-stop-loading', syncUrlFromView);
    const injectorCode = [
        fs.readFileSync(path.join(__dirname, 'injector.js'), 'utf8'),
        fs.readFileSync(path.join(__dirname, 'injector-selection-cleanup.js'), 'utf8'),
    ].join('\n');
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

    view.__endSelectionDrag = attachWebviewSelectionDragHandlers(view);
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
    const prevFileId = activeFileId;
    originalSwitchToFile(targetId);
    if (prevFileId !== targetId) {
        selectedVersionHashes = [];
    }
    try { setTimeout(updateNavButtons, 50); } catch (e) {}
    refreshQueryDirtyState(targetId);
    void (async () => {
        await syncFileFromViewUrl(targetId);
        if (!querySidebar.classList.contains('collapsed')) {
            await refreshQueryHistory();
        } else if (activeFileId && localStorage.getItem(QUERY_SIDEBAR_COLLAPSED_KEY) !== 'true') {
            setQueryHistoryPanelOpen(true);
        }
    })();
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
        const outgoingView = document.getElementById(activeFileId);
        try { outgoingView?.__endSelectionDrag?.(); } catch (e) {}
        saveFileUrl(activeFileId);
    }

    activeFileId = targetId;
    fileMru = fileMru.filter(id => id !== targetId);
    fileMru.unshift(targetId);

    setActiveTab(tabBar, targetId);

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
    if (quickSearchOverlay.classList.contains('visible')
        || newFileModal.classList.contains('visible')
        || confirmModal.classList.contains('visible')
        || tagPopup.classList.contains('visible')) {
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
        if (d.shift && key === 'h') {
            toggleQueryHistoryPanel();
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

function setHistorySidebarMode(mode) {
    if (mode !== 'history' && mode !== 'tree' && mode !== 'tags') {
        return;
    }
    historySidebarMode = mode;
    historyTabs.forEach(tab => {
        tab.classList.toggle('active', tab.dataset.mode === mode);
    });
    renderHistorySidebarList();
}

function updateExplorer() {
    explorer.innerHTML = '';

    if (files.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'explorer-item';
        empty.textContent = 'No searches yet. Click + to create one.';
        explorer.appendChild(empty);
        return;
    }

    const sorted = [...files].sort((a, b) => {
        const aName = a.name.split('/').pop();
        const bName = b.name.split('/').pop();
        return aName.localeCompare(bName, undefined, { sensitivity: 'base' });
    });

    sorted.forEach(file => {
        explorer.appendChild(renderFileNode({
            ...file,
            displayName: file.name.split('/').pop()
        }));
    });
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
    deleteButton.title = 'Delete';
    deleteButton.textContent = '×';
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
    if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'h') {
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
    const query = quickSearchInput.value;
    const { results, awaitingQuery } = filterQuickSearchResults(
        files,
        folders,
        query,
        quickSearchMode,
        file => {
            try {
                const rawText = fs.readFileSync(file.path, 'utf8');
                return extractQueryFromUrl(rawText);
            } catch {
                return '';
            }
        }
    );

    renderQuickSearchResults(quickSearchResults, {
        results,
        selectedIndex: quickSearchSelectedIndex,
        mode: quickSearchMode,
        emptyMessage: getQuickSearchEmptyMessage(quickSearchMode, awaitingQuery),
    }, {
        onSelect: activateFileFromQuickSearch,
    });
}

function handleQuickSearchKeydown(event) {
    const visibleItems = Array.from(document.querySelectorAll('.quick-search-item'));
    if (event.key === 'ArrowDown') {
        event.preventDefault();
        quickSearchSelectedIndex = moveQuickSearchSelection(
            quickSearchSelectedIndex,
            'down',
            visibleItems.length
        );
        updateQuickSearchResults();
    }

    if (event.key === 'ArrowUp') {
        event.preventDefault();
        quickSearchSelectedIndex = moveQuickSearchSelection(
            quickSearchSelectedIndex,
            'up',
            visibleItems.length
        );
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
// Query version history (per active .spl file)
function getActiveFile() {
    return files.find(f => f.id === activeFileId) || null;
}

function getLiveQueryText(file = getActiveFile()) {
    if (!file) {
        return '';
    }
    const view = document.getElementById(file.id);
    if (!view) {
        return '';
    }
    try {
        const url = view.getURL();
        return url ? extractQueryFromUrl(url) : '';
    } catch {
        return '';
    }
}

function getRelativePath(file) {
    if (file.savedSearch) {
        return getSavedSearchPath(file.savedSearch);
    }
    return path.relative(currentProjectPath, file.path).split(path.sep).join('/');
}

function resolveSavedSearchFromFile(file, currentUrl) {
    if (file?.savedSearch) {
        return file.savedSearch;
    }
    const rawUrl = currentUrl
        || file?.url
        || (file?.path && fs.existsSync(file.path) ? fs.readFileSync(file.path, 'utf8').trim() : '');
    const savedSearch = parseSavedSearchFromUrl(rawUrl);
    if (savedSearch && file) {
        file.savedSearch = savedSearch;
    }
    return savedSearch || null;
}

function getGitAuthorFromSettings() {
    const name = (gitSyncSettings.gitUserName || '').trim();
    const email = (gitSyncSettings.gitUserEmail || '').trim();
    if (name && email) {
        return { name, email };
    }
    if (name) {
        return { name, email: '' };
    }
    return undefined;
}

function getGitRemoteSettings() {
    return {
        remoteUrl: gitSyncSettings.remoteUrl || '',
        remoteName: gitSyncSettings.remoteName || 'origin',
        sharedBranch: gitSyncSettings.sharedBranch || 'main'
    };
}

async function preserveDraftBeforeRemoteSync(file) {
    const relativePath = getRelativePath(file);
    const trackedHash = restoreParentByFileId.get(file.id);
    const hasUserDraft = userDraftByFileId.has(file.id);
    if (!hasUserDraft || !trackedHash || !currentGit) {
        return { stashed: false, trackedHash, relativePath };
    }
    const hasChanges = await hasDraftChanges(currentGit, relativePath, trackedHash);
    if (!hasChanges) {
        return { stashed: false, trackedHash, relativePath };
    }
    await saveDraftStash(currentGit, relativePath, trackedHash);
    return { stashed: true, trackedHash, relativePath };
}

async function restoreDraftAfterRemoteSync(file, draftState) {
    if (!draftState?.stashed || !draftState.trackedHash || !currentGit) {
        return;
    }
    const relativePath = getRelativePath(file);
    const popped = await popDraftStash(currentGit, relativePath, draftState.trackedHash);
    if (popped) {
        fs.writeFileSync(file.path, popped, 'utf8');
        userDraftByFileId.add(file.id);
    }
}

function alignFileToCanonicalPath(file, relativePath) {
    const canonicalPath = path.join(currentProjectPath, ...relativePath.split('/'));
    if (file.path === canonicalPath) {
        return;
    }

    ensureDirectoryExists(path.dirname(canonicalPath));
    if (fs.existsSync(file.path) && !fs.existsSync(canonicalPath)) {
        fs.renameSync(file.path, canonicalPath);
    }
    file.path = canonicalPath;
    file.name = relativePath.replace(/\.spl$/i, '');
    addFolderForPath(getFileFolder(file.name));
    updateTabLabel(file);
    updateExplorer();
}

async function syncSavedSearchTrackedBase(file) {
    if (!file?.savedSearch || !currentGit) {
        return;
    }

    const relativePath = getRelativePath(file);
    const versions = await listVersions(currentGit, relativePath, 1);
    if (versions.length === 0) {
        return;
    }

    const latestHash = versions[0].hash;
    restoreParentByFileId.set(file.id, latestHash);
    const hasChanges = await hasDraftChanges(currentGit, relativePath, latestHash);
    if (!hasChanges) {
        userDraftByFileId.delete(file.id);
        forcedDraftByFileId.delete(file.id);
    }
}

async function pushSavedSearchHistoryAfterSave(file) {
    resolveSavedSearchFromFile(file);
    if (!file?.savedSearch || !currentGit) {
        return;
    }

    const { remoteUrl, remoteName, sharedBranch } = getGitRemoteSettings();
    if (!remoteUrl) {
        file.savedSearchSyncStatus = SAVED_SEARCH_SYNC_STATUS.LOCAL_NOT_PUSHED;
        return;
    }

    const remoteResult = await ensureRemote(currentGit, { remoteName, remoteUrl });
    if (!remoteResult.ok) {
        file.savedSearchSyncStatus = SAVED_SEARCH_SYNC_STATUS.PUSH_FAILED;
        return;
    }

    const pushResult = await pushSharedHistory(currentGit, { remoteName, sharedBranch });
    if (!pushResult.ok) {
        file.savedSearchSyncStatus = classifyPushSyncStatus(pushResult.message);
        return;
    }

    file.savedSearchSyncStatus = '';
}

async function enterSavedSearchHistory(file, currentUrl) {
    resolveSavedSearchFromFile(file, currentUrl);
    if (!file?.savedSearch || !currentGit || !currentProjectPath) {
        return;
    }

    const url = currentUrl
        || file.url
        || (fs.existsSync(file.path) ? fs.readFileSync(file.path, 'utf8').trim() : '');
    const relativePath = getRelativePath(file);
    const trackedHash = restoreParentByFileId.get(file.id);
    let hadLocalDraft = forcedDraftByFileId.has(file.id);
    if (!hadLocalDraft && trackedHash) {
        hadLocalDraft = await hasDraftChanges(currentGit, relativePath, trackedHash);
    }
    const localCommit = await getLatestFileCommit(currentGit, 'HEAD', relativePath);
    const draftState = await preserveDraftBeforeRemoteSync(file);
    hadLocalDraft = hadLocalDraft || draftState.stashed;

    let result;
    try {
        result = await openSavedSearchHistory({
            git: currentGit,
            workspaceRoot: currentProjectPath,
            metadata: file.savedSearch,
            currentUrl: url,
            remoteSettings: getGitRemoteSettings(),
            author: getGitAuthorFromSettings()
        });
    } catch (err) {
        file.savedSearchSyncStatus = err.message || SAVED_SEARCH_SYNC_STATUS.PUSH_FAILED;
        return;
    }

    if (result.warning) {
        file.savedSearchSyncStatus = result.warning;
    } else if (result.fetched && hadLocalDraft) {
        const { remoteName, sharedBranch } = getGitRemoteSettings();
        const remoteCommit = await getLatestFileCommit(
            currentGit,
            `refs/remotes/${remoteName}/${sharedBranch}`,
            relativePath
        );
        if (remoteCommit && localCommit && remoteCommit !== localCommit) {
            file.savedSearchSyncStatus = SAVED_SEARCH_SYNC_STATUS.REMOTE_CHANGED;
        } else if (file.savedSearchSyncStatus === SAVED_SEARCH_SYNC_STATUS.REMOTE_CHANGED) {
            file.savedSearchSyncStatus = '';
        }
    } else if (file.savedSearchSyncStatus === SAVED_SEARCH_SYNC_STATUS.REMOTE_CHANGED) {
        file.savedSearchSyncStatus = '';
    }
    alignFileToCanonicalPath(file, result.relativePath);
    await restoreDraftAfterRemoteSync(file, draftState);
    await syncSavedSearchTrackedBase(file);
}

function getTagsForHash(hash) {
    return versionTags.filter(tag => tag.hash === hash);
}

function appendTagPills(labelEl, hash) {
    for (const tag of getTagsForHash(hash)) {
        const pill = document.createElement('span');
        pill.className = 'version-tag-pill';
        pill.textContent = tag.name;
        labelEl.appendChild(pill);
    }
}

function attachVersionRowContextMenu(item, hash, tagName) {
    item.addEventListener('contextmenu', event => {
        if (hash === DRAFT_VERSION_HASH) {
            return;
        }
        if (historySidebarMode !== 'history' && historySidebarMode !== 'tree' && historySidebarMode !== 'tags') {
            return;
        }
        if ((historySidebarMode === 'history' || historySidebarMode === 'tree') && getTagsForHash(hash).length > 0) {
            return;
        }
        event.preventDefault();
        openTagPopup(hash, event.clientX, event.clientY, tagName);
    });
}

function positionTagPopup(x, y) {
    const pad = 8;
    const wasVisible = tagPopup.classList.contains('visible');
    tagPopup.classList.add('visible');
    tagPopup.style.visibility = 'hidden';
    const { width, height } = tagPopup.getBoundingClientRect();
    let left = x;
    let top = y;
    if (top + height > window.innerHeight - pad) {
        top = y - height;
    }
    left = Math.max(pad, Math.min(left, window.innerWidth - width - pad));
    top = Math.max(pad, Math.min(top, window.innerHeight - height - pad));
    tagPopup.style.left = `${left}px`;
    tagPopup.style.top = `${top}px`;
    tagPopup.style.visibility = '';
    if (!wasVisible) {
        tagPopup.classList.remove('visible');
    }
}

function openTagPopup(hash, x, y, tagName) {
    if (!hash || hash === DRAFT_VERSION_HASH) {
        return;
    }
    const clearMode = historySidebarMode === 'tags' || Boolean(tagName);
    tagPopupClearMode = clearMode;
    tagPopupTargetHash = hash;
    tagPopupInput.readOnly = clearMode;
    tagPopupInput.value = tagName || getTagsForHash(hash)[0]?.name || '';
    tagPopupSave.hidden = clearMode;
    tagPopupClear.hidden = !clearMode;
    positionTagPopup(x, y);
    tagPopup.classList.add('visible');
    if (!clearMode) {
        tagPopupInput.focus();
        tagPopupInput.select();
    }
}

function closeTagPopup() {
    tagPopup.classList.remove('visible');
    tagPopupTargetHash = null;
    tagPopupClearMode = false;
    tagPopupInput.readOnly = false;
    tagPopupInput.value = '';
    tagPopupSave.hidden = false;
    tagPopupClear.hidden = true;
}

async function saveTagFromPopup() {
    const name = tagPopupInput.value.trim();
    const hash = tagPopupTargetHash;
    if (!name || !hash) {
        return;
    }
    const file = getActiveFile();
    if (!file || !currentGit) {
        return;
    }
    if (typeof setVersionTag !== 'function') {
        queryHistoryStatus.textContent = 'Tag helpers not available yet';
        queryHistoryStatus.classList.add('dirty');
        return;
    }
    const relativePath = getRelativePath(file);
    const preservedHashes = [...selectedVersionHashes];
    try {
        await setVersionTag(currentGit, relativePath, hash, name);
        versionTags = await listVersionTags(currentGit, relativePath);
        closeTagPopup();
        renderHistorySidebarList();
        selectedVersionHashes = preservedHashes;
        queryVersionList.querySelectorAll('.query-version-item').forEach(item => {
            applyVersionRowClasses(item, item.dataset.hash);
        });
    } catch (err) {
        queryHistoryStatus.textContent = `Tag failed: ${err.message}`;
        queryHistoryStatus.classList.add('dirty');
    }
}

async function clearTagFromPopup() {
    const name = tagPopupInput.value.trim();
    const hash = tagPopupTargetHash;
    if (!name || !hash) {
        return;
    }
    const file = getActiveFile();
    if (!file || !currentGit) {
        return;
    }
    if (typeof deleteVersionTag !== 'function') {
        queryHistoryStatus.textContent = 'Tag helpers not available yet';
        queryHistoryStatus.classList.add('dirty');
        return;
    }
    const relativePath = getRelativePath(file);
    const preservedHashes = [...selectedVersionHashes];
    try {
        await deleteVersionTag(currentGit, relativePath, name);
        versionTags = await listVersionTags(currentGit, relativePath);
        closeTagPopup();
        renderHistorySidebarList();
        selectedVersionHashes = preservedHashes;
        queryVersionList.querySelectorAll('.query-version-item').forEach(item => {
            applyVersionRowClasses(item, item.dataset.hash);
        });
    } catch (err) {
        queryHistoryStatus.textContent = `Clear tag failed: ${err.message}`;
        queryHistoryStatus.classList.add('dirty');
    }
}

function selectVersionByHash(hash) {
    if (hash === DRAFT_VERSION_HASH) {
        selectDraftVersion();
    } else {
        const version = queryVersions.find(v => v.hash === hash);
        if (version) {
            selectQueryVersion(version);
        }
    }
    const row = queryVersionList.querySelector(`.query-version-item[data-hash="${hash}"]`);
    if (row) {
        row.scrollIntoView({ block: 'nearest' });
    }
}

function buildVersionTreeRows(versions) {
    const byHash = new Map(versions.map(v => [v.hash, v]));
    const children = new Map();
    for (const version of versions) {
        const parent = version.parentHash && byHash.has(version.parentHash) ? version.parentHash : null;
        if (!children.has(parent)) {
            children.set(parent, []);
        }
        children.get(parent).push(version);
    }
    const rows = [];
    function walk(parentHash, prefix, depth) {
        const kids = children.get(parentHash) || [];
        kids.forEach((version, index) => {
            const last = index === kids.length - 1;
            const connector = depth === 0 ? '' : (last ? '└─ ' : '├─ ');
            const continuation = depth === 0 ? '' : (last ? '   ' : '│  ');
            rows.push({ version, glyph: prefix + connector });
            walk(version.hash, prefix + continuation, depth + 1);
        });
    }
    walk(null, '', 0);
    return rows;
}

function renderHistorySidebarList() {
    if (historySidebarMode === 'tree') {
        renderVersionTreeList();
        return;
    }
    if (historySidebarMode === 'tags') {
        renderTagsList();
        return;
    }
    renderQueryVersionList();
}

function renderVersionTreeList() {
    queryVersionList.innerHTML = '';

    if (!getActiveFile()) {
        queryVersionList.innerHTML = '<div style="padding:12px;color:#888;">Open a query to see its version tree.</div>';
        return;
    }
    if (queryVersions.length === 0) {
        queryVersionList.innerHTML = '<div style="padding:12px;color:#888;">No saved versions yet.</div>';
        return;
    }

    for (const { version, glyph } of buildVersionTreeRows(queryVersions)) {
        const item = document.createElement('div');
        item.className = 'query-version-item';
        item.dataset.hash = version.hash;
        applyVersionRowClasses(item, version.hash);

        const label = document.createElement('div');
        label.className = 'version-label';
        label.style.fontFamily = "'Consolas', 'Courier New', monospace";
        label.textContent = `${glyph}${version.message || 'Saved version'}`;
        appendTagPills(label, version.hash);

        const meta = document.createElement('div');
        meta.className = 'version-meta';
        const when = new Date(version.date).toLocaleString();
        const shortHash = version.hash.substring(0, 7);
        meta.textContent = `${shortHash} · ${when}`;

        item.appendChild(label);
        item.appendChild(meta);
        item.addEventListener('click', event => handleVersionRowClick(event, version.hash));
        attachVersionRowContextMenu(item, version.hash);
        queryVersionList.appendChild(item);
    }
}

function renderTagsList() {
    queryVersionList.innerHTML = '';

    if (!getActiveFile()) {
        queryVersionList.innerHTML = '<div style="padding:12px;color:#888;">Open a query to see tagged versions.</div>';
        return;
    }
    if (versionTags.length === 0) {
        queryVersionList.innerHTML = '<div style="padding:12px;color:#888;">No tagged versions. Right-click a commit to tag.</div>';
        return;
    }

    const sorted = [...versionTags].sort((a, b) => new Date(b.date) - new Date(a.date));
    for (const entry of sorted) {
        const version = queryVersions.find(v => v.hash === entry.hash);
        const item = document.createElement('div');
        item.className = 'query-version-item';
        item.dataset.hash = entry.hash;
        applyVersionRowClasses(item, entry.hash);

        const label = document.createElement('div');
        label.className = 'version-label';
        label.textContent = entry.name;

        const meta = document.createElement('div');
        meta.className = 'version-meta';
        const shortHash = entry.hash.substring(0, 7);
        const taggedWhen = new Date(entry.date).toLocaleString();
        const commitWhen = version ? new Date(version.date).toLocaleString() : 'unknown';
        meta.textContent = `${shortHash} · commit ${commitWhen} · tagged ${taggedWhen}`;

        item.appendChild(label);
        item.appendChild(meta);
        item.addEventListener('click', event => handleVersionRowClick(event, entry.hash));
        item.addEventListener('dblclick', () => restoreQueryVersion(entry.hash, { confirm: false }));
        attachVersionRowContextMenu(item, entry.hash, entry.name);
        queryVersionList.appendChild(item);
    }
}

function onQueryFileChanged(fileId, { refreshHistory = false } = {}) {
    refreshQueryDirtyState(fileId);
    if (fileId === activeFileId) {
        renderVersionPreview();
    }
    if (refreshHistory && fileId === activeFileId && !querySidebar.classList.contains('collapsed')) {
        refreshQueryHistory();
    }
}

function showConfirmModal({ title, body }) {
    return new Promise(resolve => {
        confirmResolve = resolve;
        confirmModalTitle.textContent = title;
        confirmModalBody.textContent = body;
        confirmModal.classList.add('visible');
        confirmOkBtn.focus();
    });
}

function closeConfirmModal(confirmed) {
    confirmModal.classList.remove('visible');
    if (confirmResolve) {
        confirmResolve(confirmed);
        confirmResolve = null;
    }
}

function setPreviewMode(mode) {
    previewMode = mode;
    queryPreviewModeBtns.forEach(btn => {
        btn.classList.toggle('active', btn.dataset.mode === mode);
    });
    renderVersionPreview();
}

function renderVersionPreview() {
    const primary = getPrimarySelectedHash();
    const isDraftSelected = primary === DRAFT_VERSION_HASH;

    if (previewMode === 'diff') {
        if (isMultiVersionCompare()) {
            const [fromHash, toHash] = selectedVersionHashes;
            const fromVersion = queryVersions.find(v => v.hash === fromHash);
            const toVersion = queryVersions.find(v => v.hash === toHash);
            if (fromVersion && toVersion) {
                const diff = diffLines(fromVersion.query || '', toVersion.query || '');
                queryVersionPreviewText.innerHTML = renderDiffHtml(diff);
            } else {
                queryVersionPreviewText.textContent = 'Could not load selected versions.';
            }
            return;
        }
        if (isDraftSelected) {
            const baseHash = getTrackedBaseHash();
            const baseVersion = baseHash ? queryVersions.find(v => v.hash === baseHash) : null;
            const draftQuery = getLiveQueryText() || currentQueryText || '';
            if (baseVersion) {
                const diff = diffLines(baseVersion.query || '', draftQuery);
                queryVersionPreviewText.innerHTML = renderDiffHtml(diff);
            } else {
                queryVersionPreviewText.textContent = 'No saved base version to compare against.';
            }
            return;
        }
        if (!primary) {
            queryVersionPreviewText.textContent = 'Select a version to diff.';
            return;
        }
        const version = queryVersions.find(v => v.hash === primary);
        if (version) {
            const diff = diffLines(version.query || '', currentQueryText || '');
            queryVersionPreviewText.innerHTML = renderDiffHtml(diff);
            return;
        }
    }

    if (isDraftSelected || !primary) {
        const draftQuery = isDraftSelected ? (getLiveQueryText() || currentQueryText) : currentQueryText;
        queryVersionPreviewText.textContent = draftQuery || '(empty query)';
        return;
    }

    const version = queryVersions.find(v => v.hash === primary);
    queryVersionPreviewText.textContent = version?.query || '(empty query)';
}

function clampQuerySidebarWidth(width) {
    return Math.min(QUERY_SIDEBAR_MAX_WIDTH, Math.max(QUERY_SIDEBAR_MIN_WIDTH, width));
}

function applyQuerySidebarWidth(width, { persist = true } = {}) {
    const clamped = clampQuerySidebarWidth(width);
    querySidebar.style.width = `${clamped}px`;
    if (persist) {
        localStorage.setItem(QUERY_SIDEBAR_WIDTH_KEY, String(clamped));
    }
    return clamped;
}

function clampProjectSidebarWidth(width) {
    return Math.min(PROJECT_SIDEBAR_MAX_WIDTH, Math.max(PROJECT_SIDEBAR_MIN_WIDTH, width));
}

function applyProjectSidebarWidth(width, { persist = true } = {}) {
    const clamped = clampProjectSidebarWidth(width);
    sidebar.style.width = `${clamped}px`;
    if (persist) {
        localStorage.setItem(PROJECT_SIDEBAR_WIDTH_KEY, String(clamped));
    }
    return clamped;
}

function setupSidebarResizeDrag({ handle, getStartWidth, computeWidth, onWidth, isDisabled }) {
    handle.addEventListener('mousedown', event => {
        if (isDisabled()) {
            return;
        }
        event.preventDefault();
        const startX = event.clientX;
        const startWidth = getStartWidth();

        const preventSelect = e => e.preventDefault();
        const onMouseMove = moveEvent => {
            moveEvent.preventDefault();
            onWidth(computeWidth(startWidth, startX, moveEvent.clientX));
        };
        const cleanup = () => {
            handle.classList.remove('dragging');
            document.body.classList.remove('sidebar-resizing');
            sidebarDragOverlay.classList.remove('active');
            sidebarDragOverlay.removeEventListener('mousemove', onMouseMove);
            sidebarDragOverlay.removeEventListener('mouseup', cleanup);
            window.removeEventListener('blur', cleanup);
            document.removeEventListener('selectstart', preventSelect);
        };

        handle.classList.add('dragging');
        document.body.classList.add('sidebar-resizing');
        sidebarDragOverlay.classList.add('active');
        sidebarDragOverlay.addEventListener('mousemove', onMouseMove);
        sidebarDragOverlay.addEventListener('mouseup', cleanup);
        window.addEventListener('blur', cleanup);
        document.addEventListener('selectstart', preventSelect);
    });
}

function initializeProjectSidebarResize() {
    const saved = Number.parseInt(localStorage.getItem(PROJECT_SIDEBAR_WIDTH_KEY), 10);
    applyProjectSidebarWidth(Number.isFinite(saved) ? saved : PROJECT_SIDEBAR_DEFAULT_WIDTH, { persist: false });

    setupSidebarResizeDrag({
        handle: sidebarResize,
        getStartWidth: () => sidebar.offsetWidth,
        computeWidth: (startWidth, startX, clientX) => startWidth + (clientX - startX),
        onWidth: applyProjectSidebarWidth,
        isDisabled: () => sidebar.classList.contains('collapsed'),
    });
}

function initializeQuerySidebarResize() {
    const saved = Number.parseInt(localStorage.getItem(QUERY_SIDEBAR_WIDTH_KEY), 10);
    applyQuerySidebarWidth(Number.isFinite(saved) ? saved : QUERY_SIDEBAR_DEFAULT_WIDTH, { persist: false });

    setupSidebarResizeDrag({
        handle: querySidebarResize,
        getStartWidth: () => querySidebar.offsetWidth,
        computeWidth: (startWidth, startX, clientX) => startWidth + (startX - clientX),
        onWidth: applyQuerySidebarWidth,
        isDisabled: () => querySidebar.classList.contains('collapsed'),
    });
}

function setProjectSidebarCollapsed(collapsed, { persist = true } = {}) {
    sidebar.classList.toggle('collapsed', collapsed);
    sidebarReopenBtn.classList.toggle('visible', collapsed);
    if (persist) {
        localStorage.setItem(PROJECT_SIDEBAR_COLLAPSED_KEY, String(collapsed));
    }
}

function initializeLayoutControls() {
    initializeProjectSidebarResize();
    initializeQuerySidebarResize();
    setProjectSidebarCollapsed(localStorage.getItem(PROJECT_SIDEBAR_COLLAPSED_KEY) === 'true', { persist: false });
}

function setQueryHistoryPanelOpen(open, { persist = true } = {}) {
    querySidebar.classList.toggle('collapsed', !open);
    if (persist) {
        localStorage.setItem(QUERY_SIDEBAR_COLLAPSED_KEY, String(!open));
    }
    if (open) {
        void (async () => {
            const file = getActiveFile();
            if (file) {
                await syncFileFromViewUrl(file.id);
            }
            await refreshQueryHistory();
        })();
    } else {
        updateStatusBar();
    }
}

function toggleQueryHistoryPanel() {
    if (!activeFileId) {
        return;
    }
    const isOpen = !querySidebar.classList.contains('collapsed');
    setQueryHistoryPanelOpen(!isOpen);
}

function updateStatusBar({ hasChanges, status, versionCount, syncStatus } = {}) {
    const file = getActiveFile();
    if (!file) {
        statusFile.textContent = 'No query open';
        statusSave.textContent = '';
        statusSave.classList.remove('dirty');
        statusVersions.textContent = '';
        return;
    }

    statusFile.textContent = file.name.split('/').pop();
    const effectiveSyncStatus = syncStatus ?? file.savedSearchSyncStatus ?? '';
    if (hasChanges !== undefined) {
        statusSave.textContent = hasChanges ? 'Unsaved changes' : 'Saved';
        statusSave.classList.toggle('dirty', hasChanges);
    }
    if (versionCount !== undefined) {
        const label = versionCount === 1 ? 'version' : 'versions';
        statusVersions.textContent = effectiveSyncStatus
            ? `${versionCount} ${label} · ${effectiveSyncStatus}`
            : `${versionCount} ${label}`;
    } else if (effectiveSyncStatus) {
        statusVersions.textContent = effectiveSyncStatus;
    }
}

async function initializeQueryVersions() {
    if (!currentProjectPath) {
        currentGit = null;
        return;
    }

    currentGit = simpleGit(currentProjectPath);
}

async function refreshQueryDirtyState(fileId = activeFileId) {
    const generation = queryRefreshGeneration;
    const file = files.find(f => f.id === fileId);
    const tab = tabBar.querySelector(`.tab[data-target-id="${fileId}"]`);
    if (!file || !tab || !currentGit) {
        if (tab) {
            tab.classList.remove('dirty');
        }
        return;
    }

    try {
        const relativePath = getRelativePath(file);
        const { hasChanges } = await getFileStatus(currentGit, relativePath);
        const trackedHash = restoreParentByFileId.get(fileId);
        const logicalHasChanges = trackedHash
            ? await hasDraftChanges(currentGit, relativePath, trackedHash)
            : hasChanges;
        const effectiveHasChanges = logicalHasChanges || forcedDraftByFileId.has(fileId);
        if (generation !== queryRefreshGeneration && fileId !== activeFileId) {
            return;
        }
        tab.classList.toggle('dirty', effectiveHasChanges);
        if (fileId === activeFileId && !querySidebar.classList.contains('collapsed')) {
            if (!file.savedSearch) {
                renderEmptySavedSearchHistory();
            } else {
                queryHistoryStatus.textContent = formatQueryHistoryStatus(file, {
                    hasUnsavedChanges: effectiveHasChanges,
                    syncStatus: file.savedSearchSyncStatus || ''
                });
                queryHistoryStatus.classList.toggle('dirty', effectiveHasChanges);
                querySaveBtn.disabled = !effectiveHasChanges;
            }
        }
        if (fileId === activeFileId) {
            updateStatusBar({ hasChanges: effectiveHasChanges });
        }
    } catch {
        tab.classList.remove('dirty');
    }
}

async function refreshQueryHistory() {
    const generation = ++queryRefreshGeneration;
    const file = getActiveFile();
    if (!file || !currentGit || !currentProjectPath) {
        renderEmptySavedSearchHistory();
        return;
    }

    if (!file.savedSearch) {
        renderEmptySavedSearchHistory();
        return;
    }

    const relativePath = getRelativePath(file);
    const displayName = file.name.split('/').pop();
    queryHistoryTitle.textContent = `History: ${displayName}`;
    queryVersionList.innerHTML = '<div style="padding:12px;color:#888;">Loading...</div>';

    try {
        const [fileStatus, versions, current, tags] = await Promise.all([
            getFileStatus(currentGit, relativePath),
            listVersions(currentGit, relativePath),
            Promise.resolve(readCurrentQuery(file.path)),
            (typeof listVersionTags === 'function'
                ? listVersionTags(currentGit, relativePath).catch(() => [])
                : Promise.resolve([]))
        ]);

        if (generation !== queryRefreshGeneration) {
            return;
        }

        const preservedHashes = [...selectedVersionHashes];
        queryVersions = versions;
        versionTags = tags;
        let trackedHash = restoreParentByFileId.get(file.id);
        if (!trackedHash && versions.length > 0) {
            trackedHash = versions[0].hash;
            restoreParentByFileId.set(file.id, trackedHash);
        }
        const logicalHasChanges = trackedHash
            ? await hasDraftChanges(currentGit, relativePath, trackedHash)
            : fileStatus.hasChanges;
        queryHasUnsavedChanges = logicalHasChanges || forcedDraftByFileId.has(file.id);
        selectedVersionHashes = preservedHashes.filter(hash => (
            hash === DRAFT_VERSION_HASH
                ? queryHasUnsavedChanges
                : versions.some(v => v.hash === hash)
        )).slice(-2);
        const primary = getPrimarySelectedHash();
        queryRestoreBtn.disabled = !primary || primary === DRAFT_VERSION_HASH || isMultiVersionCompare();
        querySaveBtn.disabled = !queryHasUnsavedChanges;
        queryHistoryStatus.textContent = formatQueryHistoryStatus(file, {
            hasUnsavedChanges: queryHasUnsavedChanges,
            syncStatus: file.savedSearchSyncStatus || ''
        });
        queryHistoryStatus.classList.toggle('dirty', queryHasUnsavedChanges);
        currentQueryText = current.query || '';
        renderVersionPreview();

        renderHistorySidebarList();
        await refreshQueryDirtyState(file.id);
        updateStatusBar({
            hasChanges: queryHasUnsavedChanges,
            status: trackedHash ? 'draft' : fileStatus.status,
            versionCount: versions.length
        });
    } catch (err) {
        if (generation !== queryRefreshGeneration) {
            return;
        }
        queryVersionList.innerHTML = `<div style="padding:12px;color:#f48771;">Error: ${err.message}</div>`;
    }
}

function getTrackedBaseHash() {
    const file = getActiveFile();
    return file ? restoreParentByFileId.get(file.id) : null;
}

function applyVersionRowClasses(item, hash) {
    const trackedHash = getTrackedBaseHash();
    const isDraft = hash === DRAFT_VERSION_HASH;
    const selIdx = selectedVersionHashes.indexOf(hash);
    const isMulti = isMultiVersionCompare();
    item.classList.toggle('selected', !isMulti && selIdx >= 0);
    item.classList.toggle('selected-compare-from', isMulti && selIdx === 0);
    item.classList.toggle('selected-compare-to', isMulti && selIdx === 1);
    item.classList.toggle('tracked-base', !isDraft && !!trackedHash && hash === trackedHash);
    item.classList.toggle('draft', isDraft);
}

function appendDraftVersionRow() {
    const item = document.createElement('div');
    item.className = 'query-version-item draft';
    item.dataset.hash = DRAFT_VERSION_HASH;
    applyVersionRowClasses(item, DRAFT_VERSION_HASH);

    const label = document.createElement('div');
    label.className = 'version-label';
    label.textContent = 'Draft changes';

    const meta = document.createElement('div');
    meta.className = 'version-meta';
    meta.textContent = 'Uncommitted changes';

    item.appendChild(label);
    item.appendChild(meta);
    item.addEventListener('click', selectDraftVersion);
    queryVersionList.appendChild(item);
}

function renderQueryVersionList() {
    queryVersionList.innerHTML = '';

    if (queryHasUnsavedChanges) {
        appendDraftVersionRow();
    }

    if (queryVersions.length === 0) {
        if (!queryHasUnsavedChanges) {
            const empty = document.createElement('div');
            empty.style.padding = '12px';
            empty.style.color = '#888';
            empty.textContent = 'No saved versions yet.';
            queryVersionList.appendChild(empty);
        }
        return;
    }

    queryVersions.forEach(version => {
        const item = document.createElement('div');
        item.className = 'query-version-item';
        item.dataset.hash = version.hash;
        applyVersionRowClasses(item, version.hash);

        const label = document.createElement('div');
        label.className = 'version-label';
        label.textContent = version.message || 'Saved version';
        label.title = version.message;
        appendTagPills(label, version.hash);

        const meta = document.createElement('div');
        meta.className = 'version-meta';
        const when = new Date(version.date).toLocaleString();
        const shortHash = version.hash.substring(0, 7);
        meta.textContent = version.parentHash
            ? `${shortHash} · parent ${version.parentHash.substring(0, 7)} · ${when}`
            : `${shortHash} · ${when}`;

        item.appendChild(label);
        item.appendChild(meta);
        item.addEventListener('click', event => handleVersionRowClick(event, version.hash));
        item.addEventListener('dblclick', () => restoreQueryVersion(version.hash, { confirm: false }));
        attachVersionRowContextMenu(item, version.hash);
        queryVersionList.appendChild(item);
    });
}

function selectDraftVersion() {
    selectedVersionHashes = [DRAFT_VERSION_HASH];
    updateVersionSelectionUi();
}

function selectQueryVersion(version) {
    selectedVersionHashes = [version.hash];
    updateVersionSelectionUi();
}

async function saveQueryVersion() {
    const file = getActiveFile();
    if (!file || !currentGit) {
        return;
    }

    saveFileUrl(file.id);
    const fileUrl = file.url
        || (fs.existsSync(file.path) ? fs.readFileSync(file.path, 'utf8').trim() : '');
    const savedSearch = resolveSavedSearchFromFile(file, fileUrl);
    if (savedSearch) {
        await applySavedSearchToFile(file, savedSearch, fileUrl);
    }
    const relativePath = getRelativePath(file);
    const note = querySaveMessage.value.trim();
    const label = note || `Update ${file.name.split('/').pop()}`;

    try {
        querySaveBtn.disabled = true;
        const parentHash = restoreParentByFileId.get(file.id);
        const saveOptions = {};
        const author = getGitAuthorFromSettings();
        if (author) {
            saveOptions.author = author;
        }
        if (file.savedSearch) {
            saveOptions.savedSearch = {
                ...file.savedSearch,
                id: getSavedSearchId(file.savedSearch)
            };
        }
        const result = await saveVersion(currentGit, relativePath, label, parentHash, saveOptions);
        if (!result.saved) {
            queryHistoryStatus.textContent = 'No changes to save';
            queryHistoryStatus.classList.remove('dirty');
            return;
        }
        forcedDraftByFileId.delete(file.id);
        userDraftByFileId.delete(file.id);
        if (result.hash) {
            restoreParentByFileId.set(file.id, result.hash);
        }
        querySaveMessage.value = '';
        if (file.savedSearch) {
            await pushSavedSearchHistoryAfterSave(file);
        }
        await refreshQueryHistory();
        if (queryVersions.length > 0) {
            restoreParentByFileId.set(file.id, queryVersions[0].hash);
        } else {
            restoreParentByFileId.delete(file.id);
        }
    } catch (err) {
        queryHistoryStatus.textContent = `Save failed: ${err.message}`;
        queryHistoryStatus.classList.add('dirty');
    } finally {
        querySaveBtn.disabled = false;
    }
}

async function restoreQueryVersion(hash, { confirm = true } = {}) {
    const file = getActiveFile();
    if (!file || !currentGit || !hash || hash === DRAFT_VERSION_HASH) {
        return;
    }

    const version = queryVersions.find(v => v.hash === hash);
    if (!version) {
        return;
    }

    if (confirm) {
        const confirmed = await showConfirmModal({
            title: 'Restore version',
            body: `Restore "${file.name.split('/').pop()}" to version from ${new Date(version.date).toLocaleString()}?\n\nThis replaces the current query.`
        });
        if (!confirmed) {
            return;
        }
    }

    selectedVersionHashes = [hash];

    try {
        queryRestoreBtn.disabled = true;
        const relativePath = getRelativePath(file);
        const trackedHash = restoreParentByFileId.get(file.id);
        const hasUserDraft = userDraftByFileId.has(file.id);

        if (hasUserDraft && trackedHash && await hasDraftChanges(currentGit, relativePath, trackedHash)) {
            await saveDraftStash(currentGit, relativePath, trackedHash);
            userDraftByFileId.delete(file.id);
        }

        const draftStash = await getDraftStash(currentGit, relativePath, hash);
        const headHash = version.isAutoSave ? (await currentGit.revparse(['HEAD'])).trim() : '';
        const restored = await restoreVersion(
            currentGit,
            relativePath,
            hash,
            trackedHash,
            { skipAutoSave: true }
        );

        let finalContent = restored;
        if (draftStash) {
            const popped = await popDraftStash(currentGit, relativePath, hash);
            if (popped) {
                finalContent = popped;
            }
        }

        file.url = finalContent.url;
        fs.writeFileSync(file.path, finalContent.url, 'utf8');

        const view = document.getElementById(file.id);
        if (view) {
            view.src = finalContent.url;
        }

        if (draftStash) {
            restoreParentByFileId.set(file.id, hash);
            forcedDraftByFileId.add(file.id);
            userDraftByFileId.add(file.id);
            selectedVersionHashes = [DRAFT_VERSION_HASH];
        } else if (version.isAutoSave) {
            await consumeAutoSave(currentGit, hash);
            if (hash === headHash) {
                await currentGit.raw(['reset', '--mixed', `${hash}^`]);
            }
            restoreParentByFileId.set(file.id, version.parentHash || trackedHash || hash);
            forcedDraftByFileId.add(file.id);
            selectedVersionHashes = [DRAFT_VERSION_HASH];
        } else {
            forcedDraftByFileId.delete(file.id);
            userDraftByFileId.delete(file.id);
            restoreParentByFileId.set(file.id, hash);
        }
        onQueryFileChanged(file.id, { refreshHistory: true });
        await refreshQueryHistory();
    } catch (err) {
        queryHistoryStatus.textContent = `Restore failed: ${err.message}`;
        queryHistoryStatus.classList.add('dirty');
    } finally {
        const primary = getPrimarySelectedHash();
        queryRestoreBtn.disabled = !primary || primary === DRAFT_VERSION_HASH || isMultiVersionCompare();
    }
}

async function restoreSelectedVersion() {
    await restoreQueryVersion(getPrimarySelectedHash(), { confirm: true });
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
