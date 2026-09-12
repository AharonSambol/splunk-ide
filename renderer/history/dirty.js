'use strict';

const { getStanzaDraftStatus } = require('../../lib/git/stanza-drafts');
const { getFileStatus, hasDraftChanges } = require('../../lib/git/query-versions');
const { formatQueryHistoryStatus } = require('../../lib/ui/query-history-ui');
const { shouldScheduleLiveDraftRefresh } = require('../../lib/objects/saved-search-dirty');
const state = require('../state');
const {
    queryHistoryStatus,
    querySaveBtn,
    queryRestoreBtn,
    querySidebar,
    tabBar,
} = require('../dom');

let DRAFT_VERSION_HASH;
let isSavedSearchFile;
let isDashboardFile;
let isVersionedObjectFile;
let getRelativePath;
let getSavedSearchStanzaName;
let getLiveAceOrUrlQuery;
let getQueryBaseline;
let onQueryFileChanged;
let renderHistorySidebarList;
let getPrimarySelectedHash;
let isMultiVersionCompare;
let updateStatusBar;

function attachHistoryDirty(deps) {
    ({
        DRAFT_VERSION_HASH = DRAFT_VERSION_HASH,
        isSavedSearchFile = isSavedSearchFile,
        isDashboardFile = isDashboardFile,
        isVersionedObjectFile = isVersionedObjectFile,
        getRelativePath = getRelativePath,
        getSavedSearchStanzaName = getSavedSearchStanzaName,
        getLiveAceOrUrlQuery = getLiveAceOrUrlQuery,
        getQueryBaseline = getQueryBaseline,
        onQueryFileChanged = onQueryFileChanged,
        renderHistorySidebarList = renderHistorySidebarList,
        getPrimarySelectedHash = getPrimarySelectedHash,
        isMultiVersionCompare = isMultiVersionCompare,
        updateStatusBar = updateStatusBar,
    } = deps);
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

module.exports = {
    attachHistoryDirty,
    getSavedSearchDraftStatus,
    resolveEffectiveUnsavedChanges,
    shouldRefreshLiveDraftOnKey,
    scheduleRefreshLiveDraftState,
    refreshLiveDraftState,
    refreshQueryDirtyState,
};
