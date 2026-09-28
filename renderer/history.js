'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { simpleGit } = require('simple-git');
const {
    extractQueryFromUrl,
    getSearchText,
} = require('../lib/splunk-url');
const { getSavedSearchConfPath, getDashboardViewPath } = require('../lib/objects/object-paths');
const { listStanzaDraftsForConf } = require('../lib/git/stanza-drafts');
const { setStanzaSearch } = require('../lib/git/stanza-versions');
const {
    formatQueryHistoryStatus,
    isStaleSplunkImportSyncStatus,
} = require('../lib/ui/history-status');
const {
    getFileStatus,
    listVersions,
    readCurrentQuery,
    readVersionStanza,
    listVersionTags,
    extractSearchFromStanza,
} = require('../lib/git/query-versions');
const { resolveSavedSearchDraftPreviewText } = require('../lib/objects/saved-search-preview');
const state = require('./state');
const {
    historyTabs,
    queryHistoryTitle,
    queryHistoryStatus,
    queryVersionList,
    tagPopup,
    tagPopupInput,
    tagPopupCancel,
    tagPopupClear,
    tagPopupSave,
    queryPreviewModeBtns,
    querySaveMessage,
    querySaveBtn,
    queryRestoreBtn,
    querySidebar,
    statusFile,
    statusSave,
    statusVersions,
} = require('./dom');
const {
    attachHistoryRestore,
    restoreQueryVersion,
    restoreSelectedVersion,
} = require('./history/restore');
const {
    attachHistorySave,
    saveQueryVersion,
} = require('./history/save');
const {
    attachHistorySync,
    SAVED_SEARCH_SYNC_STATUS,
    getSplunkRestSettings,
    classifyPushSyncStatus,
    getLatestFileCommit,
    renderEmptySavedSearchHistory,
    clearDashboardContext,
    clearSavedSearchContext,
    syncFileFromViewUrl,
    syncSavedSearchDraftOnNavigate,
    saveFileUrl,
    handleSplunkSave,
    applySavedSearchToFile,
    resolveDashboardFromFile,
    syncDashboardTrackedBase,
    enterDashboardHistory,
    applyDashboardToFile,
    seedQueryFromSources,
    resolveSavedSearchFromFile,
    preserveDraftBeforeRemoteSync,
    restoreDraftAfterRemoteSync,
    syncSavedSearchTrackedBase,
    pushSavedSearchHistoryAfterSave,
    enterSavedSearchHistory,
} = require('./history/sync');
const {
    attachHistoryTags,
    getTagsForHash,
    appendTagPills,
    attachVersionRowContextMenu,
    positionTagPopup,
    openTagPopup,
    closeTagPopup,
    saveTagFromPopup,
    clearTagFromPopup,
} = require('./history/tags');
const {
    attachHistoryPreview,
    versionPreviewText,
    getDraftPreviewQuery,
    setPreviewMode,
    renderVersionPreview,
} = require('./history/preview');
const {
    attachHistoryDirty,
    getSavedSearchDraftStatus,
    resolveEffectiveUnsavedChanges,
    shouldRefreshLiveDraftOnKey,
    scheduleRefreshLiveDraftState,
    refreshLiveDraftState,
    refreshQueryDirtyState,
} = require('./history/dirty');
const {
    attachHistoryList,
    renderHistorySidebarList,
    renderVersionTreeList,
    renderTagsList,
    renderQueryVersionList,
    appendDraftVersionRow,
    buildVersionTreeRows,
} = require('./history/list');
const {
    attachHistoryLiveQuery,
    getLiveQueryText,
    getAceQueryText,
    setAceQueryText,
    applySavedSearchAceFromStanza,
    syncSavedSearchAceEditor,
    getLiveAceOrUrlQuery,
    getQueryBaseline,
} = require('./history/live-query');
const {
    attachHistorySelection,
    getPrimarySelectedHash,
    isMultiVersionCompare,
    updateVersionSelectionUi,
    handleVersionRowClick,
    toggleVersionMultiSelect,
    selectVersionByHash,
    getTrackedBaseHash,
    applyVersionRowClasses,
    selectDraftVersion,
    selectQueryVersion,
} = require('./history/selection');

const DRAFT_VERSION_HASH = '__draft__';

let updateExplorer;
let openFile;
let createView;
let switchToFile;
let updateTabLabel;
let persistIdeFolders;
let syncFolderList;
let ensureDirectoryExists;
let getViewUrl;







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

// Query version history (per active .spl file)
function getActiveFile() {
    return state.files.find(f => f.id === state.activeFileId) || null;
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



function onQueryFileChanged(fileId, { refreshHistory = false } = {}) {
    refreshQueryDirtyState(fileId);
    if (fileId === state.activeFileId) {
        renderVersionPreview();
    }
    if (refreshHistory && fileId === state.activeFileId && !querySidebar.classList.contains('collapsed')) {
        refreshQueryHistory();
    }
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

        const preservedHashes = [...state.selectedVersionHashes];
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





function attachHistory({
    updateExplorer: updateExplorerFn,
    openFile: openFileFn,
    createView: createViewFn,
    switchToFile: switchToFileFn,
    updateTabLabel: updateTabLabelFn,
    persistIdeFolders: persistIdeFoldersFn,
    syncFolderList: syncFolderListFn,
    ensureDirectoryExists: ensureDirectoryExistsFn,
    getViewUrl: getViewUrlFn,
}) {
    updateExplorer = updateExplorerFn;
    openFile = openFileFn;
    createView = createViewFn;
    switchToFile = switchToFileFn;
    updateTabLabel = updateTabLabelFn;
    persistIdeFolders = persistIdeFoldersFn;
    syncFolderList = syncFolderListFn;
    ensureDirectoryExists = ensureDirectoryExistsFn;
    getViewUrl = getViewUrlFn;

    // phase 2: deps that only exist after attachHistory assigns the lets above
    attachHistorySync({
        getViewUrl,
        ensureDirectoryExists,
        persistIdeFolders,
        syncFolderList,
        updateExplorer,
        updateTabLabel,
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
    queryPreviewModeBtns.forEach(btn => {
        btn.addEventListener('click', () => setPreviewMode(btn.dataset.mode));
    });
}

attachHistorySync({
    onQueryFileChanged,
    renderVersionPreview,
    updateStatusBar,
    getRelativePath,
    isSavedSearchFile,
    getSavedSearchStanzaName,
    getSavedSearchDraftStatus,
    getLiveAceOrUrlQuery,
    setStanzaSearch,
    getAceQueryText,
    getLiveQueryText,
    getListVersionsOptions,
    getVersionTagStanzaName,
    getDashboardViewRelativePath,
    refreshQueryHistory,
    syncSavedSearchAceEditor,
});
attachHistoryRestore({
    DRAFT_VERSION_HASH,
    getActiveFile,
    getRelativePath,
    isSavedSearchFile,
    getSavedSearchStanzaName,
    syncFileFromViewUrl,
    getSavedSearchDraftStatus,
    applySavedSearchAceFromStanza,
    refreshQueryHistory,
    getAceQueryText,
    getLiveQueryText,
    getLiveAceOrUrlQuery,
    isDashboardFile,
    getPrimarySelectedHash,
    isMultiVersionCompare,
});
attachHistorySave({
    getActiveFile,
    syncFileFromViewUrl,
    resolveSavedSearchFromFile,
    applySavedSearchToFile,
    getRelativePath,
    getAceQueryText,
    getLiveQueryText,
    seedQueryFromSources,
    isSavedSearchFile,
    getSavedSearchStanzaName,
    pushSavedSearchHistoryAfterSave,
    refreshQueryHistory,
});
attachHistoryTags({
    DRAFT_VERSION_HASH,
    getActiveFile,
    getRelativePath,
    getVersionTagStanzaName,
    renderHistorySidebarList,
    applyVersionRowClasses,
});
attachHistoryPreview({
    DRAFT_VERSION_HASH,
    getPrimarySelectedHash,
    isMultiVersionCompare,
    getTrackedBaseHash,
    getActiveFile,
    isSavedSearchFile,
    getLiveQueryText,
});
attachHistoryLiveQuery({
    getActiveFile,
    isSavedSearchFile,
    getSavedSearchStanzaName,
    getRelativePath,
});

attachHistorySelection({
    DRAFT_VERSION_HASH,
    getActiveFile,
});

attachHistoryList({
    DRAFT_VERSION_HASH,
    getActiveFile,
    applyVersionRowClasses,
    handleVersionRowClick,
    selectDraftVersion,
});
attachHistoryDirty({
    DRAFT_VERSION_HASH,
    isSavedSearchFile,
    isDashboardFile,
    isVersionedObjectFile,
    getRelativePath,
    getSavedSearchStanzaName,
    getLiveAceOrUrlQuery,
    getQueryBaseline,
    onQueryFileChanged,
    renderHistorySidebarList,
    getPrimarySelectedHash,
    isMultiVersionCompare,
    updateStatusBar,
});

module.exports = {
    DRAFT_VERSION_HASH,
    SAVED_SEARCH_SYNC_STATUS,
    attachHistory,
    getPrimarySelectedHash,
    isMultiVersionCompare,
    updateVersionSelectionUi,
    handleVersionRowClick,
    toggleVersionMultiSelect,
    setHistorySidebarMode,
    getTagsForHash,
    appendTagPills,
    attachVersionRowContextMenu,
    positionTagPopup,
    openTagPopup,
    closeTagPopup,
    saveTagFromPopup,
    clearTagFromPopup,
    selectVersionByHash,
    buildVersionTreeRows,
    renderHistorySidebarList,
    renderVersionTreeList,
    renderTagsList,
    setPreviewMode,
    renderVersionPreview,
    appendDraftVersionRow,
    renderQueryVersionList,
    selectDraftVersion,
    selectQueryVersion,
    applyVersionRowClasses,
    getTrackedBaseHash,
    getSplunkRestSettings,
    classifyPushSyncStatus,
    getLatestFileCommit,
    isSavedSearchFile,
    isDashboardFile,
    isVersionedObjectFile,
    getDashboardViewRelativePath,
    getSavedSearchStanzaName,
    getVersionTagStanzaName,
    getListVersionsOptions,
    versionPreviewText,
    getSavedSearchDraftStatus,
    resolveEffectiveUnsavedChanges,
    renderEmptySavedSearchHistory,
    clearDashboardContext,
    clearSavedSearchContext,
    syncFileFromViewUrl,
    syncSavedSearchDraftOnNavigate,
    saveFileUrl,
    handleSplunkSave,
    applySavedSearchToFile,
    resolveDashboardFromFile,
    syncDashboardTrackedBase,
    enterDashboardHistory,
    applyDashboardToFile,
    getActiveFile,
    getLiveQueryText,
    getAceQueryText,
    setAceQueryText,
    applySavedSearchAceFromStanza,
    syncSavedSearchAceEditor,
    getDraftPreviewQuery,
    setStanzaSearch,
    getLiveAceOrUrlQuery,
    getQueryBaseline,
    shouldRefreshLiveDraftOnKey,
    scheduleRefreshLiveDraftState,
    refreshLiveDraftState,
    seedQueryFromSources,
    getRelativePath,
    resolveSavedSearchFromFile,
    preserveDraftBeforeRemoteSync,
    restoreDraftAfterRemoteSync,
    syncSavedSearchTrackedBase,
    pushSavedSearchHistoryAfterSave,
    enterSavedSearchHistory,
    onQueryFileChanged,
    updateStatusBar,
    initializeQueryVersions,
    refreshQueryDirtyState,
    refreshQueryHistory,
    saveQueryVersion,
    restoreQueryVersion,
    restoreSelectedVersion,
};
