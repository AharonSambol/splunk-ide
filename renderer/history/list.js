'use strict';

const { getQueryHistoryEmptyMessage } = require('../../lib/ui/query-history-ui');
const state = require('../state');
const { queryVersionList } = require('../dom');
const { appendTagPills, attachVersionRowContextMenu } = require('./tags');
const { restoreQueryVersion } = require('./restore');

let DRAFT_VERSION_HASH;
let getActiveFile;
let applyVersionRowClasses;
let handleVersionRowClick;
let selectDraftVersion;

function attachHistoryList(deps) {
    ({
        DRAFT_VERSION_HASH = DRAFT_VERSION_HASH,
        getActiveFile = getActiveFile,
        applyVersionRowClasses = applyVersionRowClasses,
        handleVersionRowClick = handleVersionRowClick,
        selectDraftVersion = selectDraftVersion,
    } = deps);
}

function buildVersionTreeRows(versions) {
    const byHash = new Map(versions.map(v => [v.hash, v]));
    const children = new Map();
    for (const version of versions) {
        const parent = version.parentHash && byHash.has(version.parentHash) ? version.parentHash : null;
        if (!children.has(parent)) {
            children.set(parent, []);
        }
        children.get(parent).push(version);
    }
    const rows = [];
    function walk(parentHash, prefix, depth) {
        const kids = children.get(parentHash) || [];
        kids.forEach((version, index) => {
            const last = index === kids.length - 1;
            const connector = depth === 0 ? '' : (last ? '└─ ' : '├─ ');
            const continuation = depth === 0 ? '' : (last ? '   ' : '│  ');
            rows.push({ version, glyph: prefix + connector });
            walk(version.hash, prefix + continuation, depth + 1);
        });
    }
    walk(null, '', 0);
    return rows;
}

function renderHistorySidebarList() {
    if (state.historySidebarMode === 'tree') {
        renderVersionTreeList();
        return;
    }
    if (state.historySidebarMode === 'tags') {
        renderTagsList();
        return;
    }
    renderQueryVersionList();
}

function renderVersionTreeList() {
    queryVersionList.innerHTML = '';

    if (!getActiveFile()) {
        queryVersionList.innerHTML = '<div style="padding:12px;color:#888;">Open a query to see its version tree.</div>';
        return;
    }
    if (state.queryVersions.length === 0) {
        const emptyMessage = getQueryHistoryEmptyMessage(getActiveFile());
        queryVersionList.innerHTML = `<div style="padding:12px;color:#888;">${emptyMessage}</div>`;
        return;
    }

    for (const { version, glyph } of buildVersionTreeRows(state.queryVersions)) {
        const item = document.createElement('div');
        item.className = 'query-version-item';
        item.dataset.hash = version.hash;
        applyVersionRowClasses(item, version.hash);

        const label = document.createElement('div');
        label.className = 'version-label';
        label.style.fontFamily = "'Consolas', 'Courier New', monospace";
        label.textContent = `${glyph}${version.message || 'Saved version'}`;
        appendTagPills(label, version.hash);

        const meta = document.createElement('div');
        meta.className = 'version-meta';
        const when = new Date(version.date).toLocaleString();
        const shortHash = version.hash.substring(0, 7);
        meta.textContent = `${shortHash} · ${when}`;

        item.appendChild(label);
        item.appendChild(meta);
        item.addEventListener('click', event => handleVersionRowClick(event, version.hash));
        attachVersionRowContextMenu(item, version.hash);
        queryVersionList.appendChild(item);
    }
}

function renderTagsList() {
    queryVersionList.innerHTML = '';

    if (!getActiveFile()) {
        queryVersionList.innerHTML = '<div style="padding:12px;color:#888;">Open a query to see tagged versions.</div>';
        return;
    }
    if (state.versionTags.length === 0) {
        queryVersionList.innerHTML = '<div style="padding:12px;color:#888;">No tagged versions. Right-click a commit to tag.</div>';
        return;
    }

    const sorted = [...state.versionTags].sort((a, b) => new Date(b.date) - new Date(a.date));
    for (const entry of sorted) {
        const version = state.queryVersions.find(v => v.hash === entry.hash);
        const item = document.createElement('div');
        item.className = 'query-version-item';
        item.dataset.hash = entry.hash;
        applyVersionRowClasses(item, entry.hash);

        const label = document.createElement('div');
        label.className = 'version-label';
        label.textContent = entry.name;

        const meta = document.createElement('div');
        meta.className = 'version-meta';
        const shortHash = entry.hash.substring(0, 7);
        const taggedWhen = new Date(entry.date).toLocaleString();
        const commitWhen = version ? new Date(version.date).toLocaleString() : 'unknown';
        meta.textContent = `${shortHash} · commit ${commitWhen} · tagged ${taggedWhen}`;

        item.appendChild(label);
        item.appendChild(meta);
        item.addEventListener('click', event => handleVersionRowClick(event, entry.hash));
        item.addEventListener('dblclick', () => restoreQueryVersion(entry.hash, { confirm: false }));
        attachVersionRowContextMenu(item, entry.hash, entry.name);
        queryVersionList.appendChild(item);
    }
}

function appendDraftVersionRow() {
    const item = document.createElement('div');
    item.className = 'query-version-item draft';
    item.dataset.hash = DRAFT_VERSION_HASH;
    applyVersionRowClasses(item, DRAFT_VERSION_HASH);

    const label = document.createElement('div');
    label.className = 'version-label';
    label.textContent = 'Draft changes';

    const meta = document.createElement('div');
    meta.className = 'version-meta';
    meta.textContent = 'Uncommitted changes';

    item.appendChild(label);
    item.appendChild(meta);
    item.addEventListener('click', selectDraftVersion);
    queryVersionList.appendChild(item);
}

function renderQueryVersionList() {
    queryVersionList.innerHTML = '';

    if (state.queryHasUnsavedChanges) {
        appendDraftVersionRow();
    }

    if (state.queryVersions.length === 0) {
        if (!state.queryHasUnsavedChanges) {
            const empty = document.createElement('div');
            empty.style.padding = '12px';
            empty.style.color = '#888';
            empty.textContent = getQueryHistoryEmptyMessage(getActiveFile());
            queryVersionList.appendChild(empty);
        }
        return;
    }

    state.queryVersions.forEach(version => {
        const item = document.createElement('div');
        item.className = 'query-version-item';
        item.dataset.hash = version.hash;
        applyVersionRowClasses(item, version.hash);

        const label = document.createElement('div');
        label.className = 'version-label';
        label.textContent = version.message || 'Saved version';
        label.title = version.message;
        appendTagPills(label, version.hash);

        const meta = document.createElement('div');
        meta.className = 'version-meta';
        const when = new Date(version.date).toLocaleString();
        const shortHash = version.hash.substring(0, 7);
        meta.textContent = version.parentHash
            ? `${shortHash} · parent ${version.parentHash.substring(0, 7)} · ${when}`
            : `${shortHash} · ${when}`;

        item.appendChild(label);
        item.appendChild(meta);
        item.addEventListener('click', event => handleVersionRowClick(event, version.hash));
        item.addEventListener('dblclick', () => restoreQueryVersion(version.hash, { confirm: false }));
        attachVersionRowContextMenu(item, version.hash);
        queryVersionList.appendChild(item);
    });
}

module.exports = {
    attachHistoryList,
    renderHistorySidebarList,
    renderVersionTreeList,
    renderTagsList,
    renderQueryVersionList,
    appendDraftVersionRow,
    buildVersionTreeRows,
};
