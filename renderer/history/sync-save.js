'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
    parseSavedSearchFromUrl,
    parseDashboardFromUrl,
    shouldClearTabObjectOnNavigate,
} = require('../../lib/splunk-url');
const { getSavedSearchId } = require('../../lib/objects/saved-search-id');
const { resolveSavedSearchDirtyOnNavigate } = require('../../lib/objects/saved-search-dirty');
const {
    saveStanzaDraft,
    recomposeWorktree,
    listStanzaDraftsForConf,
} = require('../../lib/git/stanza-drafts');
const {
    readVersionStanza,
    extractSearchFromStanza,
    listVersions,
    saveStanzaVersion,
    setVersionTag,
    formatSplunkSaveTagName,
} = require('../../lib/git/query-versions');
const { isStaleSplunkImportSyncStatus } = require('../../lib/ui/history-status');
const { getGitAuthorFromSettings } = require('../git-settings');
const state = require('../state');
const { applyDashboardToFile, clearDashboardContext } = require('./sync-dashboard');

let getViewUrl;
let ensureDirectoryExists;
let onQueryFileChanged;
let isSavedSearchFile;
let getRelativePath;
let getSavedSearchStanzaName;
let getLiveAceOrUrlQuery;
let getSavedSearchDraftStatus;
let getAceQueryText;
let getLiveQueryText;
let getListVersionsOptions;
let getVersionTagStanzaName;
let refreshQueryHistory;
let setStanzaSearch;
let clearSavedSearchContext;
let applySavedSearchToFile;
let seedQueryFromSources;
let pushSavedSearchHistoryAfterSave;

function attachHistorySyncSave(deps) {
    ({
        getViewUrl = getViewUrl,
        ensureDirectoryExists = ensureDirectoryExists,
        onQueryFileChanged = onQueryFileChanged,
        isSavedSearchFile = isSavedSearchFile,
        getRelativePath = getRelativePath,
        getSavedSearchStanzaName = getSavedSearchStanzaName,
        getLiveAceOrUrlQuery = getLiveAceOrUrlQuery,
        getSavedSearchDraftStatus = getSavedSearchDraftStatus,
        getAceQueryText = getAceQueryText,
        getLiveQueryText = getLiveQueryText,
        getListVersionsOptions = getListVersionsOptions,
        getVersionTagStanzaName = getVersionTagStanzaName,
        refreshQueryHistory = refreshQueryHistory,
        setStanzaSearch = setStanzaSearch,
        clearSavedSearchContext = clearSavedSearchContext,
        applySavedSearchToFile = applySavedSearchToFile,
        seedQueryFromSources = seedQueryFromSources,
        pushSavedSearchHistoryAfterSave = pushSavedSearchHistoryAfterSave,
    } = deps);
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

module.exports = {
    attachHistorySyncSave,
    syncFileFromViewUrl,
    syncSavedSearchDraftOnNavigate,
    saveFileUrl,
    handleSplunkSave,
};
