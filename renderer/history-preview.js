'use strict';

const { extractSearchFromStanza } = require('../lib/git/query-versions');
const { diffLines, renderDiffHtml } = require('../lib/git/diff-lines');
const state = require('./state');
const { queryVersionPreviewText, queryPreviewModeBtns } = require('./dom');

let DRAFT_VERSION_HASH;
let getPrimarySelectedHash;
let isMultiVersionCompare;
let getTrackedBaseHash;
let getActiveFile;
let isSavedSearchFile;
let getLiveQueryText;

function attachHistoryPreview(deps) {
    ({
        DRAFT_VERSION_HASH = DRAFT_VERSION_HASH,
        getPrimarySelectedHash = getPrimarySelectedHash,
        isMultiVersionCompare = isMultiVersionCompare,
        getTrackedBaseHash = getTrackedBaseHash,
        getActiveFile = getActiveFile,
        isSavedSearchFile = isSavedSearchFile,
        getLiveQueryText = getLiveQueryText,
    } = deps);
}

function versionPreviewText(version) {
    if (!version) {
        return '';
    }
    if (version.stanzaText) {
        return extractSearchFromStanza(version.stanzaText) || version.stanzaText;
    }
    const raw = String(version.url || '').trim();
    if (raw.startsWith('<') || raw.startsWith('{') || raw.startsWith('[')) {
        return raw;
    }
    return version.query || raw;
}

function getDraftPreviewQuery() {
    const file = getActiveFile();
    if (file && isSavedSearchFile(file)) {
        return state.currentQueryText || '';
    }
    return getLiveQueryText() || state.currentQueryText || '';
}

function setPreviewMode(mode) {
    state.previewMode = mode;
    queryPreviewModeBtns.forEach(btn => {
        btn.classList.toggle('active', btn.dataset.mode === mode);
    });
    renderVersionPreview();
}

function renderVersionPreview() {
    const primary = getPrimarySelectedHash();
    const isDraftSelected = primary === DRAFT_VERSION_HASH;

    if (state.previewMode === 'diff') {
        if (isMultiVersionCompare()) {
            const [fromHash, toHash] = state.selectedVersionHashes;
            const fromVersion = state.queryVersions.find(v => v.hash === fromHash);
            const toVersion = state.queryVersions.find(v => v.hash === toHash);
            if (fromVersion && toVersion) {
                const diff = diffLines(
                    versionPreviewText(fromVersion),
                    versionPreviewText(toVersion)
                );
                queryVersionPreviewText.innerHTML = renderDiffHtml(diff);
            } else {
                queryVersionPreviewText.textContent = 'Could not load selected versions.';
            }
            return;
        }
        if (isDraftSelected) {
            const baseHash = getTrackedBaseHash();
            const baseVersion = baseHash ? state.queryVersions.find(v => v.hash === baseHash) : null;
            const draftQuery = getDraftPreviewQuery();
            if (baseVersion) {
                const diff = diffLines(
                    versionPreviewText(baseVersion),
                    draftQuery
                );
                queryVersionPreviewText.innerHTML = renderDiffHtml(diff);
            } else {
                queryVersionPreviewText.textContent = 'No saved base version to compare against.';
            }
            return;
        }
        if (!primary) {
            queryVersionPreviewText.textContent = 'Select a version to diff.';
            return;
        }
        const version = state.queryVersions.find(v => v.hash === primary);
        if (version) {
            const diff = diffLines(versionPreviewText(version), state.currentQueryText || '');
            queryVersionPreviewText.innerHTML = renderDiffHtml(diff);
            return;
        }
    }

    if (isDraftSelected || !primary) {
        const draftQuery = isDraftSelected ? getDraftPreviewQuery() : state.currentQueryText;
        queryVersionPreviewText.textContent = draftQuery || '(empty query)';
        return;
    }

    const version = state.queryVersions.find(v => v.hash === primary);
    queryVersionPreviewText.textContent = versionPreviewText(version) || '(empty query)';
}

module.exports = {
    attachHistoryPreview,
    versionPreviewText,
    getDraftPreviewQuery,
    setPreviewMode,
    renderVersionPreview,
};
