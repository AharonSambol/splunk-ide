'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
    extractQueryFromUrl,
    parseSavedSearchFromUrl,
    splunkUiUrlToRestBase,
} = require('../../lib/splunk-url');
const { getSavedSearchConfPath } = require('../../lib/objects/object-paths');
const { openSavedSearchHistory } = require('../../lib/objects/saved-search-open');
const { isStaleSplunkImportSyncStatus } = require('../../lib/ui/history-status');
const {
    attachHistorySyncDashboard,
    clearDashboardContext,
    resolveDashboardFromFile,
    syncDashboardTrackedBase,
    enterDashboardHistory,
    applyDashboardToFile,
} = require('./sync-dashboard');
const {
    attachHistorySyncSave,
    syncFileFromViewUrl,
    syncSavedSearchDraftOnNavigate,
    saveFileUrl,
    handleSplunkSave,
} = require('./sync-save');
const { ensureRemote, pushSharedHistoryWithReconcile } = require('../../lib/git/git-sync');
const {
    hasDraftChanges,
    saveDraftStash,
    popDraftStash,
    listVersions,
} = require('../../lib/git/query-versions');
const { explorerIdForFile, replaceItemId } = require('../../lib/explorer/ide-folders');
const state = require('../state');
const { getGitAuthorFromSettings, getGitRemoteSettings } = require('../git-settings');
const {
    queryHistoryTitle,
    queryHistoryStatus,
    queryVersionList,
    querySaveBtn,
    queryRestoreBtn,
} = require('../dom');

let getViewUrl;
let ensureDirectoryExists;
let persistIdeFolders;
let syncFolderList;
let updateExplorer;
let updateTabLabel;
let onQueryFileChanged;
let renderVersionPreview;
let updateStatusBar;
let getRelativePath;
let isSavedSearchFile;
let getSavedSearchStanzaName;
let getSavedSearchDraftStatus;
let getLiveAceOrUrlQuery;
let setStanzaSearch;
let getAceQueryText;
let getLiveQueryText;
let getListVersionsOptions;
let getVersionTagStanzaName;
let getDashboardViewRelativePath;
let refreshQueryHistory;
let syncSavedSearchAceEditor;

function attachHistorySync(deps) {
    ({
        getViewUrl = getViewUrl,
        ensureDirectoryExists = ensureDirectoryExists,
        persistIdeFolders = persistIdeFolders,
        syncFolderList = syncFolderList,
        updateExplorer = updateExplorer,
        updateTabLabel = updateTabLabel,
        onQueryFileChanged = onQueryFileChanged,
        renderVersionPreview = renderVersionPreview,
        updateStatusBar = updateStatusBar,
        getRelativePath = getRelativePath,
        isSavedSearchFile = isSavedSearchFile,
        getSavedSearchStanzaName = getSavedSearchStanzaName,
        getSavedSearchDraftStatus = getSavedSearchDraftStatus,
        getLiveAceOrUrlQuery = getLiveAceOrUrlQuery,
        setStanzaSearch = setStanzaSearch,
        getAceQueryText = getAceQueryText,
        getLiveQueryText = getLiveQueryText,
        getListVersionsOptions = getListVersionsOptions,
        getVersionTagStanzaName = getVersionTagStanzaName,
        getDashboardViewRelativePath = getDashboardViewRelativePath,
        refreshQueryHistory = refreshQueryHistory,
        syncSavedSearchAceEditor = syncSavedSearchAceEditor,
    } = deps);

    attachHistorySyncDashboard({
        getSplunkRestSettings,
        renderEmptySavedSearchHistory,
        onQueryFileChanged,
        getRelativePath,
        getDashboardViewRelativePath,
        ensureDirectoryExists,
        updateTabLabel,
        updateExplorer,
    });

    attachHistorySyncSave({
        getViewUrl,
        ensureDirectoryExists,
        onQueryFileChanged,
        isSavedSearchFile,
        getRelativePath,
        getSavedSearchStanzaName,
        getLiveAceOrUrlQuery,
        getSavedSearchDraftStatus,
        getAceQueryText,
        getLiveQueryText,
        getListVersionsOptions,
        getVersionTagStanzaName,
        refreshQueryHistory,
        setStanzaSearch,
        clearSavedSearchContext,
        applySavedSearchToFile,
        seedQueryFromSources,
        pushSavedSearchHistoryAfterSave,
    });
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





function seedQueryFromSources(file, fileUrl) {
    const fromUrl = extractQueryFromUrl(fileUrl);
    if (/^https?:\/\//i.test(fromUrl.trim())) {
        return '';
    }
    return fromUrl;
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

module.exports = {
    SAVED_SEARCH_SYNC_STATUS,
    attachHistorySync,
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
};
