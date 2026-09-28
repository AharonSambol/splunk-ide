'use strict';

const path = require('node:path');
const { simpleGit } = require('simple-git');
const {
    getFileStatus,
    listVersions,
    readCurrentQuery,
    listVersionTags,
    readVersionStanza,
} = require('../../lib/git/query-versions');
const { listStanzaDraftsForConf } = require('../../lib/git/stanza-drafts');
const { resolveSavedSearchDraftPreviewText } = require('../../lib/objects/saved-search-preview');
const { formatQueryHistoryStatus, isStaleSplunkImportSyncStatus } = require('../../lib/ui/history-status');
const { getSearchText } = require('../../lib/splunk-url');
const state = require('../state');
const {
    queryHistoryTitle,
    queryVersionList,
    queryHistoryStatus,
    querySaveBtn,
    queryRestoreBtn,
    querySidebar,
    statusFile,
    statusSave,
    statusVersions,
} = require('../dom');
const { renderEmptySavedSearchHistory } = require('./sync');
const {
    getSavedSearchDraftStatus,
    resolveEffectiveUnsavedChanges,
    refreshQueryDirtyState,
} = require('./dirty');
const { renderVersionPreview } = require('./preview');
const { renderHistorySidebarList } = require('./list');
const { getPrimarySelectedHash, isMultiVersionCompare } = require('./selection');

let DRAFT_VERSION_HASH;
let getActiveFile;
let getRelativePath;
let getListVersionsOptions;
let isSavedSearchFile;
let isDashboardFile;
let getSavedSearchStanzaName;
let getVersionTagStanzaName;

function attachHistoryRefresh(deps) {
    ({
        DRAFT_VERSION_HASH = DRAFT_VERSION_HASH,
        getActiveFile = getActiveFile,
        getRelativePath = getRelativePath,
        getListVersionsOptions = getListVersionsOptions,
        isSavedSearchFile = isSavedSearchFile,
        isDashboardFile = isDashboardFile,
        getSavedSearchStanzaName = getSavedSearchStanzaName,
        getVersionTagStanzaName = getVersionTagStanzaName,
    } = deps);
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

module.exports = {
    attachHistoryRefresh,
    onQueryFileChanged,
    updateStatusBar,
    initializeQueryVersions,
    refreshQueryHistory,
};
