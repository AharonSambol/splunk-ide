'use strict';

const fs = require('node:fs');
const { getSavedSearchId } = require('../lib/objects/saved-search-id');
const {
    hasDraftChanges,
    saveDraftStash,
    readVersionStanza,
    restoreVersion,
    restoreStanzaVersion,
    restoreStanzaAutoSaveVersion,
    discardStanzaDraft,
    consumeAutoSave,
    shouldSkipAutoSaveOnRestore,
    autoSaveStanzaBeforeRestore,
} = require('../lib/git/query-versions');
const { restorePlainQueryVersion } = require('../lib/git/plain-query-restore');
const state = require('./state');
const { showConfirmModal } = require('./confirm-modal');
const { getGitAuthorFromSettings } = require('./git-settings');
const { queryRestoreBtn, queryHistoryStatus } = require('./dom');

let DRAFT_VERSION_HASH;
let getActiveFile;
let getRelativePath;
let isSavedSearchFile;
let getSavedSearchStanzaName;
let syncFileFromViewUrl;
let getSavedSearchDraftStatus;
let applySavedSearchAceFromStanza;
let refreshQueryHistory;
let getAceQueryText;
let getLiveQueryText;
let getLiveAceOrUrlQuery;
let isDashboardFile;
let getPrimarySelectedHash;
let isMultiVersionCompare;

function attachHistoryRestore(deps) {
    DRAFT_VERSION_HASH = deps.DRAFT_VERSION_HASH;
    getActiveFile = deps.getActiveFile;
    getRelativePath = deps.getRelativePath;
    isSavedSearchFile = deps.isSavedSearchFile;
    getSavedSearchStanzaName = deps.getSavedSearchStanzaName;
    syncFileFromViewUrl = deps.syncFileFromViewUrl;
    getSavedSearchDraftStatus = deps.getSavedSearchDraftStatus;
    applySavedSearchAceFromStanza = deps.applySavedSearchAceFromStanza;
    refreshQueryHistory = deps.refreshQueryHistory;
    getAceQueryText = deps.getAceQueryText;
    getLiveQueryText = deps.getLiveQueryText;
    getLiveAceOrUrlQuery = deps.getLiveAceOrUrlQuery;
    isDashboardFile = deps.isDashboardFile;
    getPrimarySelectedHash = deps.getPrimarySelectedHash;
    isMultiVersionCompare = deps.isMultiVersionCompare;
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

module.exports = {
    attachHistoryRestore,
    restoreQueryVersion,
    restoreSelectedVersion,
};
