'use strict';

const state = require('../state');
const { queryVersionList, queryRestoreBtn } = require('../dom');
const { renderVersionPreview } = require('./preview');

let DRAFT_VERSION_HASH;
let getActiveFile;

function attachHistorySelection(deps) {
    ({
        DRAFT_VERSION_HASH = DRAFT_VERSION_HASH,
        getActiveFile = getActiveFile,
    } = deps);
}

function getPrimarySelectedHash() {
    return state.selectedVersionHashes.length ? state.selectedVersionHashes[state.selectedVersionHashes.length - 1] : null;
}

function isMultiVersionCompare() {
    return state.selectedVersionHashes.length === 2
        && !state.selectedVersionHashes.includes(DRAFT_VERSION_HASH);
}

function updateVersionSelectionUi() {
    const primary = getPrimarySelectedHash();
    queryRestoreBtn.disabled = !primary || primary === DRAFT_VERSION_HASH || isMultiVersionCompare();
    queryVersionList.querySelectorAll('.query-version-item').forEach(item => {
        applyVersionRowClasses(item, item.dataset.hash);
    });
    renderVersionPreview();
}

function handleVersionRowClick(event, hash) {
    if (hash === DRAFT_VERSION_HASH) {
        selectDraftVersion();
        return;
    }
    if (event.metaKey || event.ctrlKey) {
        toggleVersionMultiSelect(hash);
        return;
    }
    const version = state.queryVersions.find(v => v.hash === hash);
    if (version) {
        selectQueryVersion(version);
    }
}

function toggleVersionMultiSelect(hash) {
    if (hash === DRAFT_VERSION_HASH) {
        return;
    }
    let hashes = state.selectedVersionHashes.filter(h => h !== DRAFT_VERSION_HASH);
    const idx = hashes.indexOf(hash);
    if (idx >= 0) {
        hashes.splice(idx, 1);
    } else {
        hashes.push(hash);
        if (hashes.length > 2) {
            hashes.shift();
        }
    }
    state.selectedVersionHashes = hashes;
    updateVersionSelectionUi();
}

function selectVersionByHash(hash) {
    if (hash === DRAFT_VERSION_HASH) {
        selectDraftVersion();
    } else {
        const version = state.queryVersions.find(v => v.hash === hash);
        if (version) {
            selectQueryVersion(version);
        }
    }
    const row = queryVersionList.querySelector(`.query-version-item[data-hash="${hash}"]`);
    if (row) {
        row.scrollIntoView({ block: 'nearest' });
    }
}

function getTrackedBaseHash() {
    const file = getActiveFile();
    return file ? state.restoreParentByFileId.get(file.id) : null;
}

function applyVersionRowClasses(item, hash) {
    const trackedHash = getTrackedBaseHash();
    const isDraft = hash === DRAFT_VERSION_HASH;
    const selIdx = state.selectedVersionHashes.indexOf(hash);
    const isMulti = isMultiVersionCompare();
    item.classList.toggle('selected', !isMulti && selIdx >= 0);
    item.classList.toggle('selected-compare-from', isMulti && selIdx === 0);
    item.classList.toggle('selected-compare-to', isMulti && selIdx === 1);
    item.classList.toggle('tracked-base', !isDraft && !!trackedHash && hash === trackedHash);
    item.classList.toggle('draft', isDraft);
}

function selectDraftVersion() {
    state.selectedVersionHashes = [DRAFT_VERSION_HASH];
    updateVersionSelectionUi();
}

function selectQueryVersion(version) {
    state.selectedVersionHashes = [version.hash];
    updateVersionSelectionUi();
}

module.exports = {
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
};
