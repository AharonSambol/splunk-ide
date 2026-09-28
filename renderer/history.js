'use strict';

const path = require('node:path');
const { getSavedSearchConfPath, getDashboardViewPath } = require('../lib/objects/object-paths');
const { setStanzaSearch } = require('../lib/git/stanza-versions');
const state = require('./state');
const {
    historyTabs,
    tagPopup,
    tagPopupInput,
    tagPopupCancel,
    tagPopupClear,
    tagPopupSave,
    queryPreviewModeBtns,
    querySaveMessage,
    querySaveBtn,
    queryRestoreBtn,
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
const {
    attachHistoryRefresh,
    onQueryFileChanged,
    updateStatusBar,
    initializeQueryVersions,
    refreshQueryHistory,
} = require('./history/refresh');

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

attachHistoryRefresh({
    DRAFT_VERSION_HASH,
    getActiveFile,
    getRelativePath,
    getListVersionsOptions,
    isSavedSearchFile,
    isDashboardFile,
    getSavedSearchStanzaName,
    getVersionTagStanzaName,
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
