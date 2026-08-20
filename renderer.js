const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { ipcRenderer } = require('electron');
const { simpleGit } = require('simple-git');
const {
    closeFileState,
    reorderTabs: computeTabOrder,
    getPreviousTab,
    getNextTab,
    createDuplicateFileName,
} = require('./lib/tabs');
const { decodeSearchText, extractQueryFromUrl, getFileFolder, getSearchText, parseSavedSearchFromUrl, parseDashboardFromUrl, shouldClearTabObjectOnNavigate, splunkUiUrlToRestBase, DEFAULT_SPLUNK_URL, withSplunkOrigin } = require('./lib/url-utils');
const { getSavedSearchId } = require('./lib/saved-search-id');
const { getSavedSearchConfPath, getDashboardViewPath } = require('./lib/object-paths');
const { getStanzaDraftStatus, saveStanzaDraft, recomposeWorktree, listStanzaDraftsForConf } = require('./lib/stanza-drafts');
const { openSavedSearchHistory } = require('./lib/saved-search-open');
const {
    formatQueryHistoryStatus,
    getQueryHistoryEmptyMessage,
    isStaleSplunkImportSyncStatus
} = require('./lib/query-history-ui');
const { openDashboardHistory } = require('./lib/dashboard-open');
const { ensureRemote, pushSharedHistoryWithReconcile } = require('./lib/git-sync');
const {
    getFileStatus,
    hasDraftChanges,
    saveDraftStash,
    popDraftStash,
    listVersions,
    readCurrentQuery,
    readVersionStanza,
    saveVersion,
    saveStanzaVersion,
    autoSaveStanzaBeforeRestore,
    restoreVersion,
    restoreStanzaVersion,
    restoreStanzaAutoSaveVersion,
    discardStanzaDraft,
    consumeAutoSave,
    shouldSkipAutoSaveOnRestore,
    setVersionTag,
    deleteVersionTag,
    listVersionTags,
    formatSplunkSaveTagName,
    extractSearchFromStanza
} = require('./lib/query-versions');
const { restorePlainQueryVersion } = require('./lib/plain-query-restore');
const { resolveSavedSearchDraftPreviewText } = require('./lib/saved-search-preview');
const {
    resolveSavedSearchDirtyOnNavigate,
    shouldScheduleLiveDraftRefresh
} = require('./lib/saved-search-dirty');
const {
    explorerIdForFile,
    replaceItemId,
} = require('./lib/ide-folders');
const { createTabElement, setActiveTab, updateTabTitle } = require('./lib/render-tabs');
const { attachWebviewSelectionDragHandlers } = require('./lib/webview-selection-drag-handlers');
const { buildSplunkSaveInjectorSource } = require('./lib/webview-splunk-save-hooks');
const { attachParentSelectionCleanup } = require('./lib/parent-selection-cleanup');
const { diffLines, renderDiffHtml } = require('./lib/diff-lines');
const state = require('./renderer/state');
const { showConfirmModal, closeConfirmModal, attachConfirmModal } = require('./renderer/confirm-modal');
const { showFindOverlay, hideFindOverlay } = require('./renderer/find-overlay');
const {
    loadGitSyncSettings,
    closeGitSyncSettingsModal,
    getGitAuthorFromSettings,
    getGitRemoteSettings,
    attachGitSettings,
} = require('./renderer/git-settings');
const {
    openQuickSearch,
    closeQuickSearch,
    attachQuickSearch,
} = require('./renderer/quick-search');
const {
    QUERY_SIDEBAR_COLLAPSED_KEY,
    attachLayout,
    initializeLayoutControls,
    setQueryHistoryPanelOpen,
    toggleQueryHistoryPanel,
} = require('./renderer/layout');
const {
    attachExplorer,
    openFile,
    loadProject,
    createNewFile,
    openStartupSearch,
    hideNewItemMenu,
    closeNewFileModal,
    updateExplorer,
    ensureDirectoryExists,
    syncFolderList,
    persistIdeFolders,
    createFileWithUrl,
    openNewFileModal,
    clearOpenTabs,
} = require('./renderer/explorer');

attachParentSelectionCleanup(document);
attachConfirmModal();
attachGitSettings();

const {
    newFileBtn,
    newItemMenu,
    newSearchChoice,
    newFolderBtn,
    newProjectBtn,
    openProjectBtn,
    copyUrlBtn,
    prevPageBtn,
    nextPageBtn,
    projectNameLabel,
    tabBar,
    viewsContainer,
    explorer,
    historyTabs,
    sidebar,
    sidebarCollapseBtn,
    sidebarReopenBtn,
    sidebarResize,
    querySidebarResize,
    sidebarDragOverlay,
    quickSearchOverlay,
    quickSearchModal,
    newFileModal,
    newFileModalBox,
    newFileModalLabel,
    newFileModalInput,
    newFileFolderRow,
    newFileFolderSelect,
    newFileCreateBtn,
    newFileCancelBtn,
    querySidebar,
    querySidebarReopenBtn,
    queryHistoryTitle,
    queryHistoryStatus,
    queryHistoryClose,
    queryVersionList,
    tagPopup,
    tagPopupInput,
    tagPopupCancel,
    tagPopupClear,
    tagPopupSave,
    queryVersionPreviewText,
    queryPreviewModeBtns,
    querySaveMessage,
    querySaveBtn,
    queryRestoreBtn,
    confirmModal,
    confirmModalBox,
    confirmModalTitle,
    confirmModalBody,
    confirmCancelBtn,
    confirmOkBtn,
    gitSyncSettingsModal,
    gitSyncSettingsModalBox,
    statusFile,
    statusSave,
    statusVersions,
} = require('./renderer/dom');

const DRAFT_VERSION_HASH = '__draft__';

function getPrimarySelectedHash() {
    return state.selectedVersionHashes.length ? state.selectedVersionHashes[state.selectedVersionHashes.length - 1] : null;
}

function isMultiVersionCompare() {
    return state.selectedVersionHashes.length === 2
        && !state.selectedVersionHashes.includes(DRAFT_VERSION_HASH);
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
    const version = state.queryVersions.find(v => v.hash === hash);
    if (version) {
        selectQueryVersion(version);
    }
}

function toggleVersionMultiSelect(hash) {
    if (hash === DRAFT_VERSION_HASH) {
        return;
    }
    let hashes = state.selectedVersionHashes.filter(h => h !== DRAFT_VERSION_HASH);
    const idx = hashes.indexOf(hash);
    if (idx >= 0) {
        hashes.splice(idx, 1);
    } else {
        hashes.push(hash);
        if (hashes.length > 2) {
            hashes.shift();
        }
    }
    state.selectedVersionHashes = hashes;
    updateVersionSelectionUi();
}

const SAVED_SEARCH_SYNC_STATUS = {
    REMOTE_CHANGED: 'Remote changed',
    LOCAL_NOT_PUSHED: 'Local version not pushed',
    PUSH_FAILED: 'Push failed',
    STANZA_CONFLICT: 'Stanza conflict'
};

function getSplunkRestSettings(url) {
    const baseUrl = splunkUiUrlToRestBase(url || state.SPLUNK_URL);
    return baseUrl ? { baseUrl } : {};
}

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

function isSavedSearchFile(file) {
    return Boolean(file?.savedSearch);
}

function isDashboardFile(file) {
    return Boolean(file?.dashboard);
}

function isVersionedObjectFile(file) {
    return isSavedSearchFile(file) || isDashboardFile(file);
}

function getDashboardViewRelativePath(dashboard) {
    return getDashboardViewPath({
        instance: dashboard.instance,
        app: dashboard.app,
        owner: dashboard.owner,
        name: dashboard.name,
        ext: dashboard.ext || 'xml'
    });
}

function getSavedSearchStanzaName(file) {
    return String(file?.savedSearch?.name ?? '').trim();
}

function getVersionTagStanzaName(file) {
    return isSavedSearchFile(file) ? getSavedSearchStanzaName(file) : undefined;
}

function getListVersionsOptions(file) {
    const stanza = getSavedSearchStanzaName(file);
    return stanza ? { stanza } : {};
}

function versionPreviewText(version) {
    if (!version) {
        return '';
    }
    if (version.stanzaText) {
        return extractSearchFromStanza(version.stanzaText) || version.stanzaText;
    }
    const raw = String(version.url || '').trim();
    if (raw.startsWith('<') || raw.startsWith('{') || raw.startsWith('[')) {
        return raw;
    }
    return version.query || raw;
}

async function getSavedSearchDraftStatus(file) {
    if (!isSavedSearchFile(file) || !state.currentGit) {
        return { stale: false, hasDraft: false };
    }
    return getStanzaDraftStatus(
        state.currentGit,
        getRelativePath(file),
        getSavedSearchStanzaName(file)
    );
}

async function resolveEffectiveUnsavedChanges(file, trackedHash, fileStatus) {
    if (!isSavedSearchFile(file)) {
        if (trackedHash) {
            return hasDraftChanges(state.currentGit, getRelativePath(file), trackedHash);
        }
        return fileStatus.hasChanges;
    }
    const draftStatus = await getSavedSearchDraftStatus(file);
    return draftStatus.hasDraft
        || state.forcedDraftByFileId.has(file.id)
        || state.userDraftByFileId.has(file.id);
}

attachExplorer({
    createTab,
    createView,
    closeTab,
    switchToFile: (fileId) => switchToFile(fileId),
    clearOpenTabs,
    initializeQueryVersions,
    refreshQueryHistory,
    onQueryFileChanged,
    applySavedSearchToFile,
    updateTabLabel,
});
copyUrlBtn.addEventListener('click', copyActiveFileUrl);

attachLayout({
    syncActiveFile: syncFileFromViewUrl,
    refreshHistory: refreshQueryHistory,
    updateStatusBar,
});
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
        if (state.tagPopupClearMode) {
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
    const target = event.target;
    if (!(target instanceof Node)) {
        return;
    }
    if (tagPopup.classList.contains('visible') && !tagPopup.contains(target)) {
        closeTagPopup();
    }
    if (quickSearchOverlay.classList.contains('visible') && !quickSearchModal.contains(target)) {
        closeQuickSearch();
    }
    if (newFileModal.classList.contains('visible') && !newFileModalBox.contains(target)) {
        closeNewFileModal();
    }
    if (confirmModal.classList.contains('visible') && !confirmModalBox.contains(target)) {
        closeConfirmModal(false);
    }
    if (gitSyncSettingsModal.classList.contains('visible') && !gitSyncSettingsModalBox.contains(target)) {
        closeGitSyncSettingsModal();
    }
    if (newItemMenu.classList.contains('visible') && !newItemMenu.contains(target) && target !== newFileBtn) {
        hideNewItemMenu();
    }
    if (state._findOverlay && !state._findOverlay.overlay.contains(target)) {
        hideFindOverlay();
    }
});
queryPreviewModeBtns.forEach(btn => {
    btn.addEventListener('click', () => setPreviewMode(btn.dataset.mode));
});
ipcRenderer.on('app-keydown', (_event, keyInfo) => {
    handleKeyboardShortcut(keyInfo);
});
attachQuickSearch({ openFile });

window.onload = async () => {
    initializeLayoutControls();
    await loadGitSyncSettings();
    const workspacePath = await ipcRenderer.invoke('get-default-workspace');
    await loadProject(workspacePath);
    if (state.files.length === 0) {
        createNewFile('Search 1');
    } else {
        openStartupSearch();
    }
};

function copyActiveFileUrl() {
    if (!state.activeFileId) {
        alert('No file open');
        return;
    }

    const file = state.files.find(f => f.id === state.activeFileId);
    
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
    if (!state.activeFileId) {
        alert('No file open to duplicate');
        return;
    }

    const activeFile = state.files.find(f => f.id === state.activeFileId);
    if (!activeFile) {
        return;
    }

    const baseName = activeFile.name.split('/').pop();
    const folder = getFileFolder(activeFile.name);
    const newName = createDuplicateFileName(state.files, baseName);
    createFileWithUrl(newName, activeFile.url, folder);
}

function getOpenTabIds() {
    return Array.from(tabBar.querySelectorAll('.tab')).map(tab => tab.dataset.targetId);
}

function closeTab(fileId) {
    const file = state.files.find(f => f.id === fileId);
    if (!file) {
        return;
    }

    saveFileUrl(fileId);

    const openTabsBeforeClose = getOpenTabIds();
    const wasActive = state.activeFileId === fileId;

    const tab = tabBar.querySelector(`.tab[data-target-id="${fileId}"]`);
    if (tab) {
        tab.remove();
    }

    const view = document.getElementById(fileId);
    if (view) {
        view.remove();
    }

    const tabState = closeFileState(state.files, openTabsBeforeClose, state.activeFileId, fileId, state.fileMru);
    state.fileMru = tabState.fileMru;

    if (wasActive) {
        if (tabState.activeFileId) {
            switchToFile(tabState.activeFileId);
        } else {
            state.activeFileId = null;
            document.querySelectorAll('webview').forEach(view => view.classList.remove('active'));
            document.querySelectorAll('.explorer-item').forEach(item => item.classList.remove('active'));
        }
    }
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
    queryVersionList.innerHTML = '<div style="padding:12px;color:#888;">Open a query to see its history.</div>';
    state.currentQueryText = '';
    state.queryHasUnsavedChanges = false;
    state.queryVersions = [];
    state.versionTags = [];
    state.selectedVersionHashes = [];
    renderVersionPreview();
    queryHistoryStatus.textContent = '';
    queryHistoryStatus.classList.remove('dirty');
    queryRestoreBtn.disabled = true;
    querySaveBtn.disabled = true;
    updateStatusBar({ versionCount: 0, hasChanges: false });
}

function clearDashboardContext(file, url) {
    delete file.dashboard;
    state.forcedDraftByFileId.delete(file.id);
    state.userDraftByFileId.delete(file.id);
    state.restoreParentByFileId.delete(file.id);
    if (url && url !== file.url) {
        file.url = url;
        if (fs.existsSync(file.path)) {
            fs.writeFileSync(file.path, url, 'utf8');
        }
        state.userDraftByFileId.add(file.id);
    }
    state.selectedVersionHashes = [];
    if (file.id === state.activeFileId) {
        renderEmptySavedSearchHistory();
    }
    onQueryFileChanged(file.id);
}

function clearSavedSearchContext(file, url) {
    delete file.savedSearch;
    delete file.savedSearchStanzaSource;
    file.savedSearchSyncStatus = '';
    state.forcedDraftByFileId.delete(file.id);
    state.userDraftByFileId.delete(file.id);
    state.restoreParentByFileId.delete(file.id);
    if (url && url !== file.url) {
        file.url = url;
        if (fs.existsSync(file.path)) {
            fs.writeFileSync(file.path, url, 'utf8');
        }
        state.userDraftByFileId.add(file.id);
    }
    state.selectedVersionHashes = [];
    if (file.id === state.activeFileId) {
        renderEmptySavedSearchHistory();
    }
    onQueryFileChanged(file.id);
}

async function syncFileFromViewUrl(fileId) {
    const file = state.files.find(f => f.id === fileId);
    if (!file?.path) {
        return;
    }

    const url = getViewUrl(fileId);
    if (!url) {
        return;
    }

    const savedSearch = parseSavedSearchFromUrl(url);
    if (!savedSearch) {
        const dashboard = parseDashboardFromUrl(url);
        if (dashboard) {
            if (file.dashboard) {
                const prevName = file.dashboard.name;
                const nextName = dashboard.name;
                const urlChanged = url !== file.url;
                const contextChanged = prevName !== nextName
                    || file.dashboard.app !== dashboard.app
                    || file.dashboard.owner !== dashboard.owner
                    || file.dashboard.instance !== dashboard.instance;
                if (urlChanged) {
                    file.url = url;
                }
                if (contextChanged) {
                    await applyDashboardToFile(file, dashboard, url);
                    return;
                }
                if (urlChanged) {
                    file.url = url;
                    fs.writeFileSync(file.path, url, 'utf8');
                    onQueryFileChanged(fileId);
                }
                return;
            } else {
                if (file.savedSearch) {
                    clearSavedSearchContext(file, url);
                } else if (url !== file.url) {
                    file.url = url;
                    fs.writeFileSync(file.path, url, 'utf8');
                    state.userDraftByFileId.add(fileId);
                    onQueryFileChanged(fileId, { refreshHistory: true });
                }
                await applyDashboardToFile(file, dashboard, url);
            }
            return;
        }
        if (!shouldClearTabObjectOnNavigate(url)) {
            return;
        }
        if (file.savedSearch) {
            clearSavedSearchContext(file, url);
        } else if (file.dashboard) {
            clearDashboardContext(file, url);
        } else if (url !== file.url) {
            file.url = url;
            fs.writeFileSync(file.path, url, 'utf8');
            state.userDraftByFileId.add(fileId);
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

    if (contextChanged) {
        await applySavedSearchToFile(file, savedSearch, url);
        return;
    }

    if (urlChanged) {
        ensureDirectoryExists(path.dirname(file.path));
        fs.writeFileSync(file.path, url, 'utf8');
        await syncSavedSearchDraftOnNavigate(file);
        onQueryFileChanged(fileId, { refreshHistory: true });
    }
}

async function syncSavedSearchDraftOnNavigate(file) {
    if (!isSavedSearchFile(file) || !state.currentGit) {
        return;
    }

    const live = (await getLiveAceOrUrlQuery(file)).trim();
    if (!live) {
        return;
    }

    const relativePath = getRelativePath(file);
    const stanzaName = getSavedSearchStanzaName(file);
    let headHash = '';
    try {
        headHash = (await state.currentGit.revparse(['HEAD'])).trim();
    } catch {
        return;
    }

    const headStanza = await readVersionStanza(state.currentGit, relativePath, headHash, stanzaName) || '';
    const headSearch = extractSearchFromStanza(headStanza);
    const draftStatus = await getSavedSearchDraftStatus(file);
    const action = resolveSavedSearchDirtyOnNavigate({
        liveQuery: live,
        headSearchQuery: headSearch,
        hasForcedDraft: state.forcedDraftByFileId.has(file.id),
        hasDurableDraft: draftStatus.hasDraft
    });

    if (action === 'keep') {
        return;
    }

    if (action === 'clear') {
        state.userDraftByFileId.delete(file.id);
        return;
    }

    state.userDraftByFileId.add(file.id);
    const drafts = await listStanzaDraftsForConf(state.currentGit, relativePath);
    const existing = drafts.find((draft) => draft.name === stanzaName);
    const baseStanza = existing?.text || headStanza;
    if (extractSearchFromStanza(baseStanza) !== live) {
        const stanzaText = setStanzaSearch(baseStanza, stanzaName, live);
        await saveStanzaDraft(state.currentGit, relativePath, stanzaName, headHash, stanzaText);
        await recomposeWorktree(state.currentGit, relativePath, headHash);
    }
}

function saveFileUrl(fileId) {
    void syncFileFromViewUrl(fileId);
}

async function handleSplunkSave(fileId) {
    const file = state.files.find(f => f.id === fileId);
    if (!file?.savedSearch || !state.currentGit) {
        return;
    }

    await syncFileFromViewUrl(fileId);
    const relativePath = getRelativePath(file);
    const stanzaName = getSavedSearchStanzaName(file);
    const author = getGitAuthorFromSettings();
    const fileUrl = file.url
        || (fs.existsSync(file.path) ? fs.readFileSync(file.path, 'utf8').trim() : '');
    let aceQuery = await getAceQueryText(file);
    if (!aceQuery) {
        await new Promise((resolve) => setTimeout(resolve, 300));
        aceQuery = await getAceQueryText(file);
    }
    const saveOptions = {
        author,
        savedSearch: {
            ...file.savedSearch,
            id: getSavedSearchId(file.savedSearch)
        },
        seedSearchText: aceQuery
            || getLiveQueryText(file)
            || seedQueryFromSources(file, fileUrl)
    };

    try {
        const result = await saveStanzaVersion(
            state.currentGit,
            relativePath,
            stanzaName,
            'Splunk save',
            saveOptions
        );
        let hash = '';
        if (result.saved && result.hash) {
            hash = result.hash;
            state.restoreParentByFileId.set(file.id, hash);
            state.forcedDraftByFileId.delete(file.id);
            state.userDraftByFileId.delete(file.id);
            state.liveAceQueryByFileId.delete(file.id);
            file.savedSearchStanzaSource = 'head';
            await pushSavedSearchHistoryAfterSave(file);
        } else {
            hash = state.restoreParentByFileId.get(file.id) || '';
            if (!hash) {
                const versions = await listVersions(
                    state.currentGit,
                    relativePath,
                    1,
                    getListVersionsOptions(file)
                );
                hash = versions[0]?.hash || '';
            }
            if (!hash) {
                return;
            }
        }

        const tagName = formatSplunkSaveTagName(state.gitSyncSettings.gitUserName, hash);
        await setVersionTag(
            state.currentGit,
            relativePath,
            hash,
            tagName,
            getVersionTagStanzaName(file)
        );
        if (isStaleSplunkImportSyncStatus(file.savedSearchSyncStatus)) {
            file.savedSearchSyncStatus = '';
        }
        if (fileId === state.activeFileId) {
            await refreshQueryHistory();
        }
    } catch (err) {
        console.error('Splunk save tag failed', err);
    }
}

async function applySavedSearchToFile(file, savedSearch, url) {
    const previousId = explorerIdForFile(file);
    file.savedSearch = savedSearch;
    delete file.dashboard;
    file.url = url;

    ensureDirectoryExists(path.dirname(file.path));
    fs.writeFileSync(file.path, url, 'utf8');

    const nextId = explorerIdForFile(file);
    if (previousId !== nextId) {
        state.ideFolders = replaceItemId(state.ideFolders, previousId, nextId);
        syncFolderList();
        void persistIdeFolders();
        updateExplorer();
    }

    await enterSavedSearchHistory(file, url);
    await syncSavedSearchTrackedBase(file);
    onQueryFileChanged(file.id, { refreshHistory: true });
}

function resolveDashboardFromFile(file, currentUrl) {
    if (file?.dashboard) {
        return file.dashboard;
    }
    const rawUrl = currentUrl
        || file?.url
        || (file?.path && fs.existsSync(file.path) ? fs.readFileSync(file.path, 'utf8').trim() : '');
    const dashboard = parseDashboardFromUrl(rawUrl);
    if (dashboard && file) {
        file.dashboard = dashboard;
    }
    return dashboard || null;
}

async function syncDashboardTrackedBase(file) {
    if (!file?.dashboard || !state.currentGit) {
        return;
    }

    const relativePath = getRelativePath(file);
    const versions = await listVersions(state.currentGit, relativePath, 1);
    if (versions.length === 0) {
        return;
    }

    const latestHash = versions[0].hash;
    state.restoreParentByFileId.set(file.id, latestHash);
    if (!state.userDraftByFileId.has(file.id) && !state.forcedDraftByFileId.has(file.id)) {
        state.userDraftByFileId.delete(file.id);
        state.forcedDraftByFileId.delete(file.id);
    }
}

async function enterDashboardHistory(file, currentUrl) {
    resolveDashboardFromFile(file, currentUrl);
    if (!file?.dashboard || !state.currentGit || !state.currentProjectPath) {
        return;
    }

    const url = currentUrl
        || file.url
        || (fs.existsSync(file.path) ? fs.readFileSync(file.path, 'utf8').trim() : '');

    try {
        const result = await openDashboardHistory({
            git: state.currentGit,
            workspaceRoot: state.currentProjectPath,
            metadata: file.dashboard,
            restSettings: getSplunkRestSettings(url),
            remoteSettings: getGitRemoteSettings(),
            author: getGitAuthorFromSettings()
        });
        if (result.dashboard) {
            file.dashboard = result.dashboard;
        }
        if (result.warning) {
            file.dashboardSyncStatus = result.warning;
        } else {
            file.dashboardSyncStatus = '';
        }
    } catch (err) {
        file.dashboardSyncStatus = err.message || 'dashboard open failed';
        return;
    }

    await syncDashboardTrackedBase(file);
}

async function applyDashboardToFile(file, dashboard, url) {
    if (!state.currentGit || !state.currentProjectPath) {
        file.dashboard = dashboard;
        file.url = url;
        return;
    }

    file.dashboard = dashboard;
    delete file.savedSearch;
    file.savedSearchSyncStatus = '';

    const result = await openDashboardHistory({
        git: state.currentGit,
        workspaceRoot: state.currentProjectPath,
        metadata: dashboard,
        restSettings: getSplunkRestSettings(url),
        remoteSettings: getGitRemoteSettings(),
        author: getGitAuthorFromSettings()
    });
    if (result.dashboard) {
        file.dashboard = result.dashboard;
    }
    if (result.warning) {
        file.dashboardSyncStatus = result.warning;
    }

    const viewPath = result.viewPath || getDashboardViewRelativePath(file.dashboard);
    const absoluteViewPath = path.join(state.currentProjectPath, viewPath);

    if (file.path !== absoluteViewPath) {
        ensureDirectoryExists(path.dirname(absoluteViewPath));
        if (fs.existsSync(file.path) && file.path !== absoluteViewPath) {
            try {
                fs.unlinkSync(file.path);
            } catch {
                // Best-effort cleanup of old URL pointer file.
            }
        }
        if (!fs.existsSync(absoluteViewPath) && result.viewSource === 'missing') {
            fs.writeFileSync(absoluteViewPath, '', 'utf8');
        }
        file.path = absoluteViewPath;
    }

    file.name = viewPath;
    file.url = url;
    updateTabLabel(file);
    updateExplorer();
    await syncDashboardTrackedBase(file);
    onQueryFileChanged(file.id, { refreshHistory: true });
}

function updateTabLabel(file) {
    updateTabTitle(tabBar, file.id, file.name);
}

function createTab(file) {
    const tab = createTabElement(document, file, state.activeFileId, {
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
        view.setAttribute('preload', pathToFileURL(preloadPath).href);
        view.setAttribute('webpreferences', 'contextIsolation=yes,sandbox=yes');
    } catch (err) { 
        
    }
    // set src after preload so the preload script is injected
    view.src = file.url || state.SPLUNK_URL;
    viewsContainer.appendChild(view);

    // Listen for key events forwarded from the webview preload
    view.addEventListener('ipc-message', async (event) => {
        if (event.channel === 'webview-keydown') {
            const keyInfo = event.args[0] || {};
            if (shouldRefreshLiveDraftOnKey(keyInfo)) {
                scheduleRefreshLiveDraftState(file.id);
            }
        } else if (event.channel === 'webview-beforeinput') {
            scheduleRefreshLiveDraftState(file.id);
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
    const saveHookCode = buildSplunkSaveInjectorSource();
    const injectGuestScripts = () => {
        view.executeJavaScript(injectorCode).catch((err) => {
            console.error('Failed to inject guest helpers into webview', file.id, err);
        });
        view.executeJavaScript(saveHookCode)
            .then(() => {
                console.log('save hooks injected into webview', file.id);
            })
            .catch((err) => {
                console.error('Failed to inject save hooks into webview', file.id, err);
            });
    };
    view.addEventListener('dom-ready', injectGuestScripts);
    view.addEventListener('did-navigate-in-page', injectGuestScripts);
    view.addEventListener('did-stop-loading', injectGuestScripts);

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
    const prevFileId = state.activeFileId;
    originalSwitchToFile(targetId);
    if (prevFileId !== targetId) {
        state.selectedVersionHashes = [];
    }
    try { setTimeout(updateNavButtons, 50); } catch (e) {}
    refreshQueryDirtyState(targetId);
    void (async () => {
        await syncFileFromViewUrl(targetId);
        if (!querySidebar.classList.contains('collapsed')) {
            await refreshQueryHistory();
        } else if (state.activeFileId && localStorage.getItem(QUERY_SIDEBAR_COLLAPSED_KEY) !== 'true') {
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
    if (!state.files.some(file => file.id === targetId)) {
        return;
    }

    if (state.activeFileId && state.activeFileId !== targetId) {
        const outgoingView = document.getElementById(state.activeFileId);
        try { outgoingView?.__endSelectionDrag?.(); } catch (e) {}
        saveFileUrl(state.activeFileId);
    }

    state.activeFileId = targetId;
    state.fileMru = state.fileMru.filter(id => id !== targetId);
    state.fileMru.unshift(targetId);

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
        state.shiftTapCount += 1;

        if (state.shiftTapCount === 1) {
            state.shiftTimer = globalThis.setTimeout(() => {
                state.shiftTapCount = 0;
            }, 400);
        } else if (state.shiftTapCount === 2) {
            globalThis.clearTimeout(state.shiftTimer);
            state.shiftTapCount = 0;
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
    state.historySidebarMode = mode;
    historyTabs.forEach(tab => {
        tab.classList.toggle('active', tab.dataset.mode === mode);
    });
    renderHistorySidebarList();
}

function openMostRecentTab() {
    if (state.fileMru.length < 2) {
        return;
    }

    const targetId = state.fileMru[1];
    switchToFile(targetId);
}

function switchToPreviousTab() {
    const previousTabId = getPreviousTab(getOpenTabIds(), state.activeFileId);
    if (previousTabId) {
        switchToFile(previousTabId);
    }
}

function switchToNextTab() {
    const nextTabId = getNextTab(getOpenTabIds(), state.activeFileId);
    if (nextTabId) {
        switchToFile(nextTabId);
    }
}

// Query version history (per active .spl file)
function getActiveFile() {
    return state.files.find(f => f.id === state.activeFileId) || null;
}

function getLiveQueryText(file = getActiveFile()) {
    if (!file) {
        return '';
    }
    const cached = state.liveAceQueryByFileId.get(file.id);
    if (cached) {
        return cached;
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

async function getAceQueryText(file = getActiveFile()) {
    if (!file) {
        return '';
    }
    const view = document.getElementById(file.id);
    if (!view?.executeJavaScript) {
        return '';
    }
    try {
        const text = await view.executeJavaScript(`(() => {
            const editor = document.querySelector('.ace_editor')?.env?.editor;
            if (!editor) {
                return '';
            }
            return editor.getValue?.()
                || editor.session?.getValue?.()
                || '';
        })()`) || '';
        if (text) {
            state.liveAceQueryByFileId.set(file.id, text);
        }
        return text;
    } catch {
        return '';
    }
}

async function setAceQueryText(file, searchText, { retries = 8, delayMs = 250 } = {}) {
    if (!file || !isSavedSearchFile(file)) {
        return false;
    }
    const view = document.getElementById(file.id);
    if (!view?.executeJavaScript) {
        return false;
    }
    const payload = JSON.stringify(String(searchText ?? ''));
    for (let attempt = 0; attempt < retries; attempt++) {
        try {
            const applied = await view.executeJavaScript(`(() => {
                const el = document.querySelector('.ace_editor');
                const editor = el?.env?.editor;
                if (!editor?.setValue) {
                    return false;
                }
                editor.setValue(${payload}, -1);
                return true;
            })()`);
            if (applied) {
                state.liveAceQueryByFileId.set(file.id, String(searchText ?? ''));
                return true;
            }
        } catch {
            // Ace may not be mounted yet.
        }
        if (attempt < retries - 1) {
            await new Promise(resolve => setTimeout(resolve, delayMs));
        }
    }
    return false;
}

async function applySavedSearchAceFromStanza(file, stanzaText) {
    if (!isSavedSearchFile(file) || !stanzaText) {
        return false;
    }
    return setAceQueryText(file, extractSearchFromStanza(stanzaText));
}

async function syncSavedSearchAceEditor(file) {
    if (!isSavedSearchFile(file) || !state.currentGit) {
        return;
    }
    const relativePath = getRelativePath(file);
    const stanzaName = getSavedSearchStanzaName(file);
    const drafts = await listStanzaDraftsForConf(state.currentGit, relativePath);
    const draft = drafts.find((entry) => entry.name === stanzaName);
    if (draft?.text) {
        await applySavedSearchAceFromStanza(file, draft.text);
        return;
    }
    const trackedHash = state.restoreParentByFileId.get(file.id) || state.queryVersions[0]?.hash;
    if (!trackedHash) {
        return;
    }
    const stanza = await readVersionStanza(state.currentGit, relativePath, trackedHash, stanzaName);
    if (stanza) {
        await applySavedSearchAceFromStanza(file, stanza);
    }
}

function getDraftPreviewQuery() {
    const file = getActiveFile();
    if (file && isSavedSearchFile(file)) {
        return state.currentQueryText || '';
    }
    return getLiveQueryText() || state.currentQueryText || '';
}

function setStanzaSearch(stanzaText, stanzaName, search) {
    if (!stanzaText) {
        return `[${stanzaName}]\nsearch = ${search}\n\n`;
    }
    if (/^search\s*=/m.test(stanzaText)) {
        return stanzaText.replace(/^search\s*=.*$/m, `search = ${search}`);
    }
    const lines = stanzaText.split('\n');
    if (lines[0]?.startsWith('[')) {
        lines.splice(1, 0, `search = ${search}`);
        const block = lines.join('\n');
        return block.endsWith('\n') ? block : `${block}\n`;
    }
    return `[${stanzaName}]\nsearch = ${search}\n\n`;
}

async function getLiveAceOrUrlQuery(file) {
    const ace = await getAceQueryText(file);
    if (ace) {
        return ace;
    }
    return getLiveQueryText(file);
}

async function getQueryBaseline(file) {
    if (!isSavedSearchFile(file) || !state.currentGit) {
        const fileUrl = file.url
            || (file.path && fs.existsSync(file.path) ? fs.readFileSync(file.path, 'utf8').trim() : '');
        return extractQueryFromUrl(fileUrl);
    }

    const relativePath = getRelativePath(file);
    const stanzaName = getSavedSearchStanzaName(file);
    const trackedHash = state.restoreParentByFileId.get(file.id);
    const versionHash = state.queryVersions[0]?.hash;
    const hash = trackedHash || versionHash;
    if (hash) {
        const stanza = await readVersionStanza(state.currentGit, relativePath, hash, stanzaName);
        if (stanza) {
            return extractSearchFromStanza(stanza);
        }
    }

    const fileUrl = file.url
        || (file.path && fs.existsSync(file.path) ? fs.readFileSync(file.path, 'utf8').trim() : '');
    return extractQueryFromUrl(fileUrl);
}

function shouldRefreshLiveDraftOnKey({ key, ctrl, meta, alt }) {
    if (ctrl || meta || alt) {
        return false;
    }
    return key === 'Enter' || key === 'Backspace' || key === 'Delete' || key?.length === 1;
}

function scheduleRefreshLiveDraftState(fileId) {
    const file = state.files.find(f => f.id === fileId);
    if (!shouldScheduleLiveDraftRefresh(file)) {
        return;
    }
    const prev = state.liveDraftDebounceByFileId.get(fileId);
    if (prev) {
        clearTimeout(prev);
    }
    state.liveDraftDebounceByFileId.set(fileId, setTimeout(() => {
        state.liveDraftDebounceByFileId.delete(fileId);
        void refreshLiveDraftState(fileId);
    }, 200));
}

async function refreshLiveDraftState(fileId) {
    const file = state.files.find(f => f.id === fileId);
    if (!file) {
        return;
    }

    if (isSavedSearchFile(file)) {
        return;
    }

    const live = (await getLiveAceOrUrlQuery(file)).trim();
    const baseline = (await getQueryBaseline(file)).trim();

    if (!isVersionedObjectFile(file)) {
        return;
    }

    if (live !== baseline) {
        state.userDraftByFileId.add(fileId);
        onQueryFileChanged(fileId);
        return;
    }

    if (state.forcedDraftByFileId.has(fileId)) {
        return;
    }

    state.userDraftByFileId.delete(fileId);
    onQueryFileChanged(fileId);
}

function seedQueryFromSources(file, fileUrl) {
    const fromUrl = extractQueryFromUrl(fileUrl);
    if (/^https?:\/\//i.test(fromUrl.trim())) {
        return '';
    }
    return fromUrl;
}

function getRelativePath(file) {
    if (file.savedSearch) {
        return getSavedSearchConfPath(file.savedSearch);
    }
    if (file.dashboard) {
        return getDashboardViewRelativePath(file.dashboard);
    }
    return path.relative(state.currentProjectPath, file.path).split(path.sep).join('/');
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

async function preserveDraftBeforeRemoteSync(file) {
    const relativePath = getRelativePath(file);
    const trackedHash = state.restoreParentByFileId.get(file.id);
    const hasUserDraft = state.userDraftByFileId.has(file.id);
    if (!hasUserDraft || !trackedHash || !state.currentGit) {
        return { stashed: false, trackedHash, relativePath };
    }
    const hasChanges = await hasDraftChanges(state.currentGit, relativePath, trackedHash);
    if (!hasChanges) {
        return { stashed: false, trackedHash, relativePath };
    }
    await saveDraftStash(state.currentGit, relativePath, trackedHash);
    return { stashed: true, trackedHash, relativePath };
}

async function restoreDraftAfterRemoteSync(file, draftState) {
    if (!draftState?.stashed || !draftState.trackedHash || !state.currentGit) {
        return;
    }
    const relativePath = getRelativePath(file);
    const popped = await popDraftStash(state.currentGit, relativePath, draftState.trackedHash);
    if (popped) {
        fs.writeFileSync(file.path, popped, 'utf8');
        state.userDraftByFileId.add(file.id);
    }
}

async function syncSavedSearchTrackedBase(file) {
    if (!file?.savedSearch || !state.currentGit) {
        return;
    }

    const relativePath = getRelativePath(file);
    const versions = await listVersions(
        state.currentGit,
        relativePath,
        1,
        getListVersionsOptions(file)
    );
    if (versions.length === 0) {
        return;
    }

    const latestHash = versions[0].hash;
    state.restoreParentByFileId.set(file.id, latestHash);
    const draftStatus = await getSavedSearchDraftStatus(file);
    if (!draftStatus.hasDraft) {
        state.userDraftByFileId.delete(file.id);
        state.forcedDraftByFileId.delete(file.id);
    }
}

async function pushSavedSearchHistoryAfterSave(file) {
    resolveSavedSearchFromFile(file);
    if (!file?.savedSearch || !state.currentGit) {
        return;
    }

    const { remoteUrl, remoteName, sharedBranch } = getGitRemoteSettings();
    if (!remoteUrl) {
        file.savedSearchSyncStatus = SAVED_SEARCH_SYNC_STATUS.LOCAL_NOT_PUSHED;
        return;
    }

    const remoteResult = await ensureRemote(state.currentGit, { remoteName, remoteUrl });
    if (!remoteResult.ok) {
        file.savedSearchSyncStatus = SAVED_SEARCH_SYNC_STATUS.PUSH_FAILED;
        return;
    }

    const pushResult = await pushSharedHistoryWithReconcile(state.currentGit, {
        remoteName,
        sharedBranch,
        reconcile: {
            confPath: getSavedSearchConfPath(file.savedSearch),
            metadata: file.savedSearch,
            stanzas: [file.savedSearch.name],
            restSettings: { baseUrl: splunkUiUrlToRestBase(state.SPLUNK_URL) },
            author: getGitAuthorFromSettings(),
            remoteSettings: { remoteName, sharedBranch }
        }
    });
    if (!pushResult.ok) {
        file.savedSearchSyncStatus = classifyPushSyncStatus(pushResult.message);
        return;
    }

    const stanzaConflict = (pushResult.conflicts || []).find(
        (entry) => entry.name === file.savedSearch.name && entry.status === SAVED_SEARCH_SYNC_STATUS.STANZA_CONFLICT
    );
    if (stanzaConflict) {
        file.savedSearchSyncStatus = SAVED_SEARCH_SYNC_STATUS.STANZA_CONFLICT;
        return;
    }

    file.savedSearchSyncStatus = '';
}

async function enterSavedSearchHistory(file, currentUrl) {
    resolveSavedSearchFromFile(file, currentUrl);
    if (!file?.savedSearch || !state.currentGit || !state.currentProjectPath) {
        return;
    }

    const url = currentUrl
        || file.url
        || (fs.existsSync(file.path) ? fs.readFileSync(file.path, 'utf8').trim() : '');
    const relativePath = getRelativePath(file);
    const trackedHash = state.restoreParentByFileId.get(file.id);
    let hadLocalDraft = state.forcedDraftByFileId.has(file.id);
    if (!hadLocalDraft) {
        const draftStatus = await getSavedSearchDraftStatus(file);
        hadLocalDraft = draftStatus.hasDraft;
    }
    const localCommit = await getLatestFileCommit(state.currentGit, 'HEAD', relativePath);
    const draftState = { stashed: false };

    let result;
    try {
        result = await openSavedSearchHistory({
            git: state.currentGit,
            workspaceRoot: state.currentProjectPath,
            metadata: file.savedSearch,
            currentUrl: url,
            restSettings: getSplunkRestSettings(url),
            remoteSettings: getGitRemoteSettings(),
            author: getGitAuthorFromSettings()
        });
    } catch (err) {
        file.savedSearchSyncStatus = err.message || SAVED_SEARCH_SYNC_STATUS.PUSH_FAILED;
        return;
    }

    file.savedSearchStanzaSource = result.stanzaSource;

    if (result.warning) {
        file.savedSearchSyncStatus = result.warning;
    } else if (result.fetched && hadLocalDraft) {
        const { remoteName, sharedBranch } = getGitRemoteSettings();
        const remoteCommit = await getLatestFileCommit(
            state.currentGit,
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
    } else if (isStaleSplunkImportSyncStatus(file.savedSearchSyncStatus)) {
        file.savedSearchSyncStatus = '';
    }
    await syncSavedSearchTrackedBase(file);
    await syncSavedSearchAceEditor(file);
}

function getTagsForHash(hash) {
    return state.versionTags.filter(tag => tag.hash === hash);
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
        if (state.historySidebarMode !== 'history' && state.historySidebarMode !== 'tree' && state.historySidebarMode !== 'tags') {
            return;
        }
        if ((state.historySidebarMode === 'history' || state.historySidebarMode === 'tree') && getTagsForHash(hash).length > 0) {
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
    const clearMode = state.historySidebarMode === 'tags' || Boolean(tagName);
    state.tagPopupClearMode = clearMode;
    state.tagPopupTargetHash = hash;
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
    state.tagPopupTargetHash = null;
    state.tagPopupClearMode = false;
    tagPopupInput.readOnly = false;
    tagPopupInput.value = '';
    tagPopupSave.hidden = false;
    tagPopupClear.hidden = true;
}

async function saveTagFromPopup() {
    const name = tagPopupInput.value.trim();
    const hash = state.tagPopupTargetHash;
    if (!name || !hash) {
        return;
    }
    const file = getActiveFile();
    if (!file || !state.currentGit) {
        return;
    }
    if (typeof setVersionTag !== 'function') {
        queryHistoryStatus.textContent = 'Tag helpers not available yet';
        queryHistoryStatus.classList.add('dirty');
        return;
    }
    const relativePath = getRelativePath(file);
    const tagStanza = getVersionTagStanzaName(file);
    const preservedHashes = [...selectedVersionHashes];
    try {
        await setVersionTag(state.currentGit, relativePath, hash, name, tagStanza);
        state.versionTags = await listVersionTags(state.currentGit, relativePath, tagStanza);
        closeTagPopup();
        renderHistorySidebarList();
        state.selectedVersionHashes = preservedHashes;
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
    const hash = state.tagPopupTargetHash;
    if (!name || !hash) {
        return;
    }
    const file = getActiveFile();
    if (!file || !state.currentGit) {
        return;
    }
    if (typeof deleteVersionTag !== 'function') {
        queryHistoryStatus.textContent = 'Tag helpers not available yet';
        queryHistoryStatus.classList.add('dirty');
        return;
    }
    const relativePath = getRelativePath(file);
    const tagStanza = getVersionTagStanzaName(file);
    const preservedHashes = [...selectedVersionHashes];
    try {
        await deleteVersionTag(state.currentGit, relativePath, name, tagStanza);
        state.versionTags = await listVersionTags(state.currentGit, relativePath, tagStanza);
        closeTagPopup();
        renderHistorySidebarList();
        state.selectedVersionHashes = preservedHashes;
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
        const version = state.queryVersions.find(v => v.hash === hash);
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
    if (state.historySidebarMode === 'tree') {
        renderVersionTreeList();
        return;
    }
    if (state.historySidebarMode === 'tags') {
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
    if (state.queryVersions.length === 0) {
        const emptyMessage = getQueryHistoryEmptyMessage(getActiveFile());
        queryVersionList.innerHTML = `<div style="padding:12px;color:#888;">${emptyMessage}</div>`;
        return;
    }

    for (const { version, glyph } of buildVersionTreeRows(state.queryVersions)) {
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
    if (state.versionTags.length === 0) {
        queryVersionList.innerHTML = '<div style="padding:12px;color:#888;">No tagged versions. Right-click a commit to tag.</div>';
        return;
    }

    const sorted = [...versionTags].sort((a, b) => new Date(b.date) - new Date(a.date));
    for (const entry of sorted) {
        const version = state.queryVersions.find(v => v.hash === entry.hash);
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
    if (fileId === state.activeFileId) {
        renderVersionPreview();
    }
    if (refreshHistory && fileId === state.activeFileId && !querySidebar.classList.contains('collapsed')) {
        refreshQueryHistory();
    }
}

function setPreviewMode(mode) {
    state.previewMode = mode;
    queryPreviewModeBtns.forEach(btn => {
        btn.classList.toggle('active', btn.dataset.mode === mode);
    });
    renderVersionPreview();
}

function renderVersionPreview() {
    const primary = getPrimarySelectedHash();
    const isDraftSelected = primary === DRAFT_VERSION_HASH;

    if (state.previewMode === 'diff') {
        if (isMultiVersionCompare()) {
            const [fromHash, toHash] = state.selectedVersionHashes;
            const fromVersion = state.queryVersions.find(v => v.hash === fromHash);
            const toVersion = state.queryVersions.find(v => v.hash === toHash);
            if (fromVersion && toVersion) {
                const diff = diffLines(
                    versionPreviewText(fromVersion),
                    versionPreviewText(toVersion)
                );
                queryVersionPreviewText.innerHTML = renderDiffHtml(diff);
            } else {
                queryVersionPreviewText.textContent = 'Could not load selected versions.';
            }
            return;
        }
        if (isDraftSelected) {
            const baseHash = getTrackedBaseHash();
            const baseVersion = baseHash ? state.queryVersions.find(v => v.hash === baseHash) : null;
            const draftQuery = getDraftPreviewQuery();
            if (baseVersion) {
                const diff = diffLines(
                    versionPreviewText(baseVersion),
                    draftQuery
                );
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
        const version = state.queryVersions.find(v => v.hash === primary);
        if (version) {
            const diff = diffLines(versionPreviewText(version), state.currentQueryText || '');
            queryVersionPreviewText.innerHTML = renderDiffHtml(diff);
            return;
        }
    }

    if (isDraftSelected || !primary) {
        const draftQuery = isDraftSelected ? getDraftPreviewQuery() : state.currentQueryText;
        queryVersionPreviewText.textContent = draftQuery || '(empty query)';
        return;
    }

    const version = state.queryVersions.find(v => v.hash === primary);
    queryVersionPreviewText.textContent = versionPreviewText(version) || '(empty query)';
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
    if (!state.currentProjectPath) {
        state.currentGit = null;
        return;
    }

    state.currentGit = simpleGit(state.currentProjectPath);
}

async function refreshQueryDirtyState(fileId = state.activeFileId) {
    const generation = state.queryRefreshGeneration;
    const file = state.files.find(f => f.id === fileId);
    const tab = tabBar.querySelector(`.tab[data-target-id="${fileId}"]`);
    if (!file || !tab || !state.currentGit) {
        if (tab) {
            tab.classList.remove('dirty');
        }
        return;
    }

    try {
        const relativePath = getRelativePath(file);
        const fileStatus = await getFileStatus(state.currentGit, relativePath);
        const { hasChanges } = fileStatus;
        const trackedHash = state.restoreParentByFileId.get(fileId);
        const draftStatus = isSavedSearchFile(file)
            ? await getSavedSearchDraftStatus(file)
            : null;
        const logicalHasChanges = await resolveEffectiveUnsavedChanges(file, trackedHash, { hasChanges });
        const effectiveHasChanges = logicalHasChanges || state.forcedDraftByFileId.has(fileId);
        if (generation !== state.queryRefreshGeneration && fileId !== state.activeFileId) {
            return;
        }
        tab.classList.toggle('dirty', effectiveHasChanges);
        if (fileId === state.activeFileId && effectiveHasChanges !== state.queryHasUnsavedChanges) {
            state.queryHasUnsavedChanges = effectiveHasChanges;
            if (!querySidebar.classList.contains('collapsed')) {
                renderHistorySidebarList();
                const primary = getPrimarySelectedHash();
                queryRestoreBtn.disabled = !primary || primary === DRAFT_VERSION_HASH || isMultiVersionCompare();
            }
        }
        if (fileId === state.activeFileId && !querySidebar.classList.contains('collapsed')) {
            const syncStatus = file.savedSearchSyncStatus || file.dashboardSyncStatus || '';
            if (isSavedSearchFile(file) || isDashboardFile(file)) {
                queryHistoryStatus.textContent = formatQueryHistoryStatus(file, {
                    hasUnsavedChanges: effectiveHasChanges,
                    syncStatus,
                    draftStatus
                });
            } else {
                queryHistoryStatus.textContent = effectiveHasChanges
                    ? `Unsaved (${trackedHash ? 'draft' : fileStatus.status})`
                    : 'Up to date';
            }
            queryHistoryStatus.classList.toggle('dirty', effectiveHasChanges);
            querySaveBtn.disabled = !effectiveHasChanges;
        }
        if (fileId === state.activeFileId) {
            updateStatusBar({ hasChanges: effectiveHasChanges });
        }
    } catch {
        tab.classList.remove('dirty');
    }
}

async function refreshQueryHistory() {
    const generation = ++state.queryRefreshGeneration;
    const file = getActiveFile();
    if (!file || !state.currentGit || !state.currentProjectPath) {
        renderEmptySavedSearchHistory();
        return;
    }

    const relativePath = getRelativePath(file);
    const listOptions = getListVersionsOptions(file);
    const displayName = isDashboardFile(file)
        ? file.dashboard.name
        : file.name.split('/').pop();
    queryHistoryTitle.textContent = `History: ${displayName}`;
    if (state.queryVersions.length === 0) {
        queryVersionList.innerHTML = '<div style="padding:12px;color:#888;">Loading...</div>';
    }

    try {
        const readPath = isDashboardFile(file)
            ? path.join(state.currentProjectPath, relativePath)
            : file.path;
        const [fileStatus, versions, current, tags, draftStatus] = await Promise.all([
            getFileStatus(state.currentGit, relativePath),
            listVersions(state.currentGit, relativePath, 30, listOptions),
            Promise.resolve(readCurrentQuery(readPath)),
            (typeof listVersionTags === 'function'
                ? listVersionTags(state.currentGit, relativePath, getVersionTagStanzaName(file)).catch(() => [])
                : Promise.resolve([])),
            isSavedSearchFile(file) ? getSavedSearchDraftStatus(file) : Promise.resolve(null)
        ]);

        if (generation !== state.queryRefreshGeneration) {
            return;
        }

        const preservedHashes = [...selectedVersionHashes];
        state.queryVersions = versions;
        state.versionTags = tags;
        if (
            isSavedSearchFile(file)
            && versions.length > 0
            && isStaleSplunkImportSyncStatus(file.savedSearchSyncStatus)
        ) {
            file.savedSearchSyncStatus = '';
        }
        let trackedHash = state.restoreParentByFileId.get(file.id);
        if (!trackedHash && versions.length > 0) {
            trackedHash = versions[0].hash;
            state.restoreParentByFileId.set(file.id, trackedHash);
        }
        const logicalHasChanges = await resolveEffectiveUnsavedChanges(file, trackedHash, fileStatus);
        state.queryHasUnsavedChanges = logicalHasChanges || state.forcedDraftByFileId.has(file.id);
        state.selectedVersionHashes = preservedHashes.filter(hash => (
            hash === DRAFT_VERSION_HASH
                ? state.queryHasUnsavedChanges
                : versions.some(v => v.hash === hash)
        )).slice(-2);
        const primary = getPrimarySelectedHash();
        queryRestoreBtn.disabled = !primary || primary === DRAFT_VERSION_HASH || isMultiVersionCompare();
        querySaveBtn.disabled = !state.queryHasUnsavedChanges;
        if (isSavedSearchFile(file) || isDashboardFile(file)) {
            queryHistoryStatus.textContent = formatQueryHistoryStatus(file, {
                hasUnsavedChanges: state.queryHasUnsavedChanges,
                syncStatus: file.savedSearchSyncStatus || file.dashboardSyncStatus || '',
                draftStatus
            });
        } else {
            queryHistoryStatus.textContent = state.queryHasUnsavedChanges
                ? `Unsaved (${trackedHash ? 'draft' : fileStatus.status})`
                : 'Up to date';
        }
        queryHistoryStatus.classList.toggle('dirty', state.queryHasUnsavedChanges);
        if (isSavedSearchFile(file)) {
            const stanzaName = getSavedSearchStanzaName(file);
            const [drafts, headStanza] = await Promise.all([
                listStanzaDraftsForConf(state.currentGit, relativePath),
                trackedHash
                    ? readVersionStanza(state.currentGit, relativePath, trackedHash, stanzaName)
                    : Promise.resolve('')
            ]);
            const draft = drafts.find((entry) => entry.name === stanzaName);
            state.currentQueryText = resolveSavedSearchDraftPreviewText({
                draftStanzaText: draft?.text || '',
                headStanzaText: headStanza || ''
            });
        } else {
            state.currentQueryText = isDashboardFile(file)
                ? (current.url || current.query || '')
                : (current.query || getSearchText(current.url || ''));
        }
        renderVersionPreview();

        renderHistorySidebarList();
        await refreshQueryDirtyState(file.id);
        updateStatusBar({
            hasChanges: state.queryHasUnsavedChanges,
            status: trackedHash ? 'draft' : fileStatus.status,
            versionCount: versions.length
        });
    } catch (err) {
        if (generation !== state.queryRefreshGeneration) {
            return;
        }
        queryVersionList.innerHTML = `<div style="padding:12px;color:#f48771;">Error: ${err.message}</div>`;
    }
}

function getTrackedBaseHash() {
    const file = getActiveFile();
    return file ? state.restoreParentByFileId.get(file.id) : null;
}

function applyVersionRowClasses(item, hash) {
    const trackedHash = getTrackedBaseHash();
    const isDraft = hash === DRAFT_VERSION_HASH;
    const selIdx = state.selectedVersionHashes.indexOf(hash);
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

    if (state.queryHasUnsavedChanges) {
        appendDraftVersionRow();
    }

    if (state.queryVersions.length === 0) {
        if (!state.queryHasUnsavedChanges) {
            const empty = document.createElement('div');
            empty.style.padding = '12px';
            empty.style.color = '#888';
            empty.textContent = getQueryHistoryEmptyMessage(getActiveFile());
            queryVersionList.appendChild(empty);
        }
        return;
    }

    state.queryVersions.forEach(version => {
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
    state.selectedVersionHashes = [DRAFT_VERSION_HASH];
    updateVersionSelectionUi();
}

function selectQueryVersion(version) {
    state.selectedVersionHashes = [version.hash];
    updateVersionSelectionUi();
}

async function saveQueryVersion() {
    const file = getActiveFile();
    if (!file || !state.currentGit) {
        return;
    }

    await syncFileFromViewUrl(file.id);
    const fileUrl = file.url
        || (fs.existsSync(file.path) ? fs.readFileSync(file.path, 'utf8').trim() : '');
    const savedSearch = resolveSavedSearchFromFile(file, fileUrl);
    if (savedSearch) {
        const prevId = file.savedSearch ? getSavedSearchId(file.savedSearch) : '';
        const nextId = getSavedSearchId(savedSearch);
        if (!file.savedSearch || prevId !== nextId) {
            await applySavedSearchToFile(file, savedSearch, fileUrl);
        }
    }
    const relativePath = getRelativePath(file);
    const note = querySaveMessage.value.trim();
    const label = note || `Update ${file.name.split('/').pop()}`;

    try {
        querySaveBtn.disabled = true;
        const parentHash = state.restoreParentByFileId.get(file.id);
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
        if (file.dashboard) {
            saveOptions.dashboard = file.dashboard;
        }
        if (file.savedSearch) {
            const aceQuery = await getAceQueryText(file);
            saveOptions.seedSearchText = aceQuery
                || getLiveQueryText(file)
                || seedQueryFromSources(file, fileUrl);
        }
        const result = isSavedSearchFile(file)
            ? await saveStanzaVersion(
                state.currentGit,
                relativePath,
                getSavedSearchStanzaName(file),
                label,
                saveOptions
            )
            : await saveVersion(state.currentGit, relativePath, label, parentHash, saveOptions);
        if (!result.saved) {
            if (result.reason === 'missing-stanza') {
                queryHistoryStatus.textContent = 'Nothing to commit: saved search not in git yet';
            } else if (result.reason === 'missing-query') {
                queryHistoryStatus.textContent = 'Nothing to commit: no search query to save';
            } else {
                queryHistoryStatus.textContent = 'No changes to save';
            }
            queryHistoryStatus.classList.remove('dirty');
            return;
        }
        state.forcedDraftByFileId.delete(file.id);
        state.userDraftByFileId.delete(file.id);
        state.liveAceQueryByFileId.delete(file.id);
        if (result.hash) {
            state.restoreParentByFileId.set(file.id, result.hash);
        }
        querySaveMessage.value = '';
        if (file.savedSearch) {
            file.savedSearchStanzaSource = 'head';
            await pushSavedSearchHistoryAfterSave(file);
        }
        await refreshQueryHistory();
        if (state.queryVersions.length > 0) {
            state.restoreParentByFileId.set(file.id, state.queryVersions[0].hash);
        } else {
            state.restoreParentByFileId.delete(file.id);
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
    if (!file || !state.currentGit || !hash || hash === DRAFT_VERSION_HASH) {
        return;
    }

    const version = state.queryVersions.find(v => v.hash === hash);
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

    state.selectedVersionHashes = [hash];

    try {
        queryRestoreBtn.disabled = true;
        const relativePath = getRelativePath(file);

        if (isSavedSearchFile(file)) {
            const stanzaName = getSavedSearchStanzaName(file);
            const trackedHash = state.restoreParentByFileId.get(file.id);

            await syncFileFromViewUrl(file.id);
            const draftStatus = await getSavedSearchDraftStatus(file);
            const isDirty = draftStatus.hasDraft
                || state.forcedDraftByFileId.has(file.id)
                || state.userDraftByFileId.has(file.id);

            if (version.isAutoSave) {
                const restored = await restoreStanzaAutoSaveVersion(
                    state.currentGit,
                    relativePath,
                    stanzaName,
                    hash,
                    version.parentHash || trackedHash
                );
                if (!restored.restored) {
                    throw new Error(restored.reason || 'Restore failed');
                }
                state.forcedDraftByFileId.add(file.id);
                state.userDraftByFileId.delete(file.id);
                state.restoreParentByFileId.set(file.id, restored.baseHash);
                state.selectedVersionHashes = [DRAFT_VERSION_HASH];
                if (restored.stanzaText) {
                    await applySavedSearchAceFromStanza(file, restored.stanzaText);
                }
                await refreshQueryHistory();
                return;
            }

            let autoSaveResult = { saved: false };
            if (!shouldSkipAutoSaveOnRestore(version, isDirty)) {
                const autoSaveOptions = {};
                const author = getGitAuthorFromSettings();
                if (author) {
                    autoSaveOptions.author = author;
                }
                if (file.savedSearch) {
                    autoSaveOptions.savedSearch = {
                        ...file.savedSearch,
                        id: getSavedSearchId(file.savedSearch)
                    };
                }
                const aceQuery = await getAceQueryText(file);
                const liveQuery = aceQuery || getLiveQueryText(file) || (await getLiveAceOrUrlQuery(file));
                if (liveQuery) {
                    autoSaveOptions.seedSearchText = liveQuery;
                }
                autoSaveResult = await autoSaveStanzaBeforeRestore(
                    state.currentGit,
                    relativePath,
                    stanzaName,
                    hash,
                    autoSaveOptions
                );
            }

            if (trackedHash === hash) {
                const draftStatus = await getSavedSearchDraftStatus(file);
                if (draftStatus.hasDraft || state.forcedDraftByFileId.has(file.id) || autoSaveResult.saved) {
                    await discardStanzaDraft(state.currentGit, relativePath, stanzaName);
                    state.forcedDraftByFileId.delete(file.id);
                    state.userDraftByFileId.delete(file.id);
                    state.restoreParentByFileId.set(file.id, hash);
                    state.selectedVersionHashes = [hash];
                    const stanza = await readVersionStanza(state.currentGit, relativePath, hash, stanzaName);
                    if (stanza) {
                        await applySavedSearchAceFromStanza(file, stanza);
                    }
                    await refreshQueryHistory();
                    return;
                }
            }

            const restored = await restoreStanzaVersion(state.currentGit, relativePath, stanzaName, hash);
            if (!restored.restored) {
                throw new Error(restored.reason || 'Restore failed');
            }
            state.forcedDraftByFileId.add(file.id);
            state.restoreParentByFileId.set(file.id, restored.baseHash || hash);
            state.selectedVersionHashes = [DRAFT_VERSION_HASH];
            if (restored.stanzaText) {
                await applySavedSearchAceFromStanza(file, restored.stanzaText);
            }
            await refreshQueryHistory();
            return;
        }

        if (isDashboardFile(file)) {
            const trackedHash = state.restoreParentByFileId.get(file.id);
            if (trackedHash && await hasDraftChanges(state.currentGit, relativePath, trackedHash)) {
                await saveDraftStash(state.currentGit, relativePath, trackedHash);
                state.userDraftByFileId.delete(file.id);
            }

            await restoreVersion(
                state.currentGit,
                relativePath,
                hash,
                trackedHash,
                { skipAutoSave: true }
            );
            state.forcedDraftByFileId.add(file.id);
            state.restoreParentByFileId.set(file.id, hash);
            state.selectedVersionHashes = [DRAFT_VERSION_HASH];
            await refreshQueryHistory();
            return;
        }

        const trackedHash = state.restoreParentByFileId.get(file.id);
        const isDirty = !!(trackedHash && await hasDraftChanges(state.currentGit, relativePath, trackedHash))
            || state.userDraftByFileId.has(file.id);
        const headHash = version.isAutoSave ? (await state.currentGit.revparse(['HEAD'])).trim() : '';
        const restored = await restorePlainQueryVersion({
            git: state.currentGit,
            relativePath,
            hash,
            version,
            trackedHash,
            isDirty,
            syncUrl: () => syncFileFromViewUrl(file.id)
        });

        file.url = restored.url;
        fs.writeFileSync(file.path, restored.url, 'utf8');

        const view = document.getElementById(file.id);
        if (view) {
            view.src = restored.url;
        }

        if (version.isAutoSave) {
            await consumeAutoSave(state.currentGit, hash);
            if (hash === headHash) {
                await state.currentGit.raw(['reset', '--mixed', `${hash}^`]);
            }
            state.restoreParentByFileId.set(file.id, version.parentHash || trackedHash || hash);
            state.forcedDraftByFileId.add(file.id);
            state.selectedVersionHashes = [DRAFT_VERSION_HASH];
        } else {
            state.forcedDraftByFileId.delete(file.id);
            state.userDraftByFileId.delete(file.id);
            state.restoreParentByFileId.set(file.id, hash);
        }
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
