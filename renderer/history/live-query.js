'use strict';

const fs = require('node:fs');
const {
    extractSearchFromStanza,
    readVersionStanza,
} = require('../../lib/git/query-versions');
const { listStanzaDraftsForConf } = require('../../lib/git/stanza-drafts');
const { extractQueryFromUrl } = require('../../lib/splunk-url');
const state = require('../state');

let getActiveFile = () => null;
let isSavedSearchFile = () => false;
let getSavedSearchStanzaName = () => '';
let getRelativePath = () => '';

function attachHistoryLiveQuery({
    getActiveFile: getActiveFileDep = getActiveFile,
    isSavedSearchFile: isSavedSearchFileDep = isSavedSearchFile,
    getSavedSearchStanzaName: getSavedSearchStanzaNameDep = getSavedSearchStanzaName,
    getRelativePath: getRelativePathDep = getRelativePath,
} = {}) {
    getActiveFile = getActiveFileDep;
    isSavedSearchFile = isSavedSearchFileDep;
    getSavedSearchStanzaName = getSavedSearchStanzaNameDep;
    getRelativePath = getRelativePathDep;
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

module.exports = {
    attachHistoryLiveQuery,
    getLiveQueryText,
    getAceQueryText,
    setAceQueryText,
    applySavedSearchAceFromStanza,
    syncSavedSearchAceEditor,
    getLiveAceOrUrlQuery,
    getQueryBaseline,
};
