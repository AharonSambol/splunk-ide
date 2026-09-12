'use strict';

const {
    setVersionTag,
    deleteVersionTag,
    listVersionTags,
} = require('../../lib/git/query-versions');
const state = require('../state');
const {
    tagPopup,
    tagPopupInput,
    tagPopupSave,
    tagPopupClear,
    queryHistoryStatus,
    queryVersionList,
} = require('../dom');

let DRAFT_VERSION_HASH;
let getActiveFile;
let getRelativePath;
let getVersionTagStanzaName;
let renderHistorySidebarList;
let applyVersionRowClasses;

function attachHistoryTags(deps) {
    ({
        DRAFT_VERSION_HASH = DRAFT_VERSION_HASH,
        getActiveFile = getActiveFile,
        getRelativePath = getRelativePath,
        getVersionTagStanzaName = getVersionTagStanzaName,
        renderHistorySidebarList = renderHistorySidebarList,
        applyVersionRowClasses = applyVersionRowClasses,
    } = deps);
}

function getTagsForHash(hash) {
    return state.versionTags.filter(tag => tag.hash === hash);
}

function appendTagPills(labelEl, hash) {
    for (const tag of getTagsForHash(hash)) {
        const pill = document.createElement('span');
        pill.className = 'version-tag-pill';
        pill.textContent = tag.name;
        labelEl.appendChild(pill);
    }
}

function attachVersionRowContextMenu(item, hash, tagName) {
    item.addEventListener('contextmenu', event => {
        if (hash === DRAFT_VERSION_HASH) {
            return;
        }
        if (state.historySidebarMode !== 'history' && state.historySidebarMode !== 'tree' && state.historySidebarMode !== 'tags') {
            return;
        }
        if ((state.historySidebarMode === 'history' || state.historySidebarMode === 'tree') && getTagsForHash(hash).length > 0) {
            return;
        }
        event.preventDefault();
        openTagPopup(hash, event.clientX, event.clientY, tagName);
    });
}

function positionTagPopup(x, y) {
    const pad = 8;
    const wasVisible = tagPopup.classList.contains('visible');
    tagPopup.classList.add('visible');
    tagPopup.style.visibility = 'hidden';
    const { width, height } = tagPopup.getBoundingClientRect();
    let left = x;
    let top = y;
    if (top + height > window.innerHeight - pad) {
        top = y - height;
    }
    left = Math.max(pad, Math.min(left, window.innerWidth - width - pad));
    top = Math.max(pad, Math.min(top, window.innerHeight - height - pad));
    tagPopup.style.left = `${left}px`;
    tagPopup.style.top = `${top}px`;
    tagPopup.style.visibility = '';
    if (!wasVisible) {
        tagPopup.classList.remove('visible');
    }
}

function openTagPopup(hash, x, y, tagName) {
    if (!hash || hash === DRAFT_VERSION_HASH) {
        return;
    }
    const clearMode = state.historySidebarMode === 'tags' || Boolean(tagName);
    state.tagPopupClearMode = clearMode;
    state.tagPopupTargetHash = hash;
    tagPopupInput.readOnly = clearMode;
    tagPopupInput.value = tagName || getTagsForHash(hash)[0]?.name || '';
    tagPopupSave.hidden = clearMode;
    tagPopupClear.hidden = !clearMode;
    positionTagPopup(x, y);
    tagPopup.classList.add('visible');
    if (!clearMode) {
        tagPopupInput.focus();
        tagPopupInput.select();
    }
}

function closeTagPopup() {
    tagPopup.classList.remove('visible');
    state.tagPopupTargetHash = null;
    state.tagPopupClearMode = false;
    tagPopupInput.readOnly = false;
    tagPopupInput.value = '';
    tagPopupSave.hidden = false;
    tagPopupClear.hidden = true;
}

async function saveTagFromPopup() {
    const name = tagPopupInput.value.trim();
    const hash = state.tagPopupTargetHash;
    if (!name || !hash) {
        return;
    }
    const file = getActiveFile();
    if (!file || !state.currentGit) {
        return;
    }
    if (typeof setVersionTag !== 'function') {
        queryHistoryStatus.textContent = 'Tag helpers not available yet';
        queryHistoryStatus.classList.add('dirty');
        return;
    }
    const relativePath = getRelativePath(file);
    const tagStanza = getVersionTagStanzaName(file);
    const preservedHashes = [...state.selectedVersionHashes];
    try {
        await setVersionTag(state.currentGit, relativePath, hash, name, tagStanza);
        state.versionTags = await listVersionTags(state.currentGit, relativePath, tagStanza);
        closeTagPopup();
        renderHistorySidebarList();
        state.selectedVersionHashes = preservedHashes;
        queryVersionList.querySelectorAll('.query-version-item').forEach(item => {
            applyVersionRowClasses(item, item.dataset.hash);
        });
    } catch (err) {
        queryHistoryStatus.textContent = `Tag failed: ${err.message}`;
        queryHistoryStatus.classList.add('dirty');
    }
}

async function clearTagFromPopup() {
    const name = tagPopupInput.value.trim();
    const hash = state.tagPopupTargetHash;
    if (!name || !hash) {
        return;
    }
    const file = getActiveFile();
    if (!file || !state.currentGit) {
        return;
    }
    if (typeof deleteVersionTag !== 'function') {
        queryHistoryStatus.textContent = 'Tag helpers not available yet';
        queryHistoryStatus.classList.add('dirty');
        return;
    }
    const relativePath = getRelativePath(file);
    const tagStanza = getVersionTagStanzaName(file);
    const preservedHashes = [...state.selectedVersionHashes];
    try {
        await deleteVersionTag(state.currentGit, relativePath, name, tagStanza);
        state.versionTags = await listVersionTags(state.currentGit, relativePath, tagStanza);
        closeTagPopup();
        renderHistorySidebarList();
        state.selectedVersionHashes = preservedHashes;
        queryVersionList.querySelectorAll('.query-version-item').forEach(item => {
            applyVersionRowClasses(item, item.dataset.hash);
        });
    } catch (err) {
        queryHistoryStatus.textContent = `Clear tag failed: ${err.message}`;
        queryHistoryStatus.classList.add('dirty');
    }
}

module.exports = {
    attachHistoryTags,
    getTagsForHash,
    appendTagPills,
    attachVersionRowContextMenu,
    positionTagPopup,
    openTagPopup,
    closeTagPopup,
    saveTagFromPopup,
    clearTagFromPopup,
};
