'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
    extractQueryFromUrl,
    parseSavedSearchFromUrl,
    parseDashboardFromUrl,
    shouldClearTabObjectOnNavigate,
    splunkUiUrlToRestBase,
} = require('../../lib/splunk-url');
const { getSavedSearchId } = require('../../lib/objects/saved-search-id');
const { getSavedSearchConfPath } = require('../../lib/objects/object-paths');
const { saveStanzaDraft, recomposeWorktree, listStanzaDraftsForConf } = require('../../lib/git/stanza-drafts');
const { openSavedSearchHistory } = require('../../lib/objects/saved-search-open');
const { isStaleSplunkImportSyncStatus } = require('../../lib/ui/query-history-ui');
const { openDashboardHistory } = require('../../lib/objects/dashboard-open');
const { ensureRemote, pushSharedHistoryWithReconcile } = require('../../lib/git/git-sync');
const {
    hasDraftChanges,
    saveDraftStash,
    popDraftStash,
    listVersions,
    readVersionStanza,
    saveStanzaVersion,
    setVersionTag,
    formatSplunkSaveTagName,
    extractSearchFromStanza,
} = require('../../lib/git/query-versions');
const { resolveSavedSearchDirtyOnNavigate } = require('../../lib/objects/saved-search-dirty');
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
