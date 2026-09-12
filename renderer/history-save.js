'use strict';

const fs = require('node:fs');
const { getSavedSearchId } = require('../lib/objects/saved-search-id');
const { saveVersion, saveStanzaVersion } = require('../lib/git/query-versions');
const state = require('./state');
const { getGitAuthorFromSettings } = require('./git-settings');
const { querySaveMessage, querySaveBtn, queryHistoryStatus } = require('./dom');

let getActiveFile;
let syncFileFromViewUrl;
let resolveSavedSearchFromFile;
let applySavedSearchToFile;
let getRelativePath;
let getAceQueryText;
let getLiveQueryText;
let seedQueryFromSources;
let isSavedSearchFile;
let getSavedSearchStanzaName;
let pushSavedSearchHistoryAfterSave;
let refreshQueryHistory;

function attachHistorySave(deps) {
    getActiveFile = deps.getActiveFile;
    syncFileFromViewUrl = deps.syncFileFromViewUrl;
    resolveSavedSearchFromFile = deps.resolveSavedSearchFromFile;
    applySavedSearchToFile = deps.applySavedSearchToFile;
    getRelativePath = deps.getRelativePath;
    getAceQueryText = deps.getAceQueryText;
    getLiveQueryText = deps.getLiveQueryText;
    seedQueryFromSources = deps.seedQueryFromSources;
    isSavedSearchFile = deps.isSavedSearchFile;
    getSavedSearchStanzaName = deps.getSavedSearchStanzaName;
    pushSavedSearchHistoryAfterSave = deps.pushSavedSearchHistoryAfterSave;
    refreshQueryHistory = deps.refreshQueryHistory;
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

module.exports = {
    attachHistorySave,
    saveQueryVersion,
};
