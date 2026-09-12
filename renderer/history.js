'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { simpleGit } = require('simple-git');
const {
    extractQueryFromUrl,
    getSearchText,
} = require('../lib/url-utils');
const { getSavedSearchConfPath, getDashboardViewPath } = require('../lib/objects/object-paths');
const { getStanzaDraftStatus, listStanzaDraftsForConf } = require('../lib/git/stanza-drafts');
const {
    formatQueryHistoryStatus,
    getQueryHistoryEmptyMessage,
    isStaleSplunkImportSyncStatus,
} = require('../lib/ui/query-history-ui');
const {
    getFileStatus,
    hasDraftChanges,
    listVersions,
    readCurrentQuery,
    readVersionStanza,
    listVersionTags,
    extractSearchFromStanza,
} = require('../lib/git/query-versions');
const { resolveSavedSearchDraftPreviewText } = require('../lib/objects/saved-search-preview');
const { shouldScheduleLiveDraftRefresh } = require('../lib/objects/saved-search-dirty');
const state = require('./state');
const {
    historyTabs,
    queryHistoryTitle,
    queryHistoryStatus,
    queryVersionList,
    tagPopup,
    tagPopupInput,
    tagPopupCancel,
    tagPopupClear,
    tagPopupSave,
    queryPreviewModeBtns,
    querySaveMessage,
    querySaveBtn,
    queryRestoreBtn,
    querySidebar,
    tabBar,
    statusFile,
    statusSave,
    statusVersions,
} = require('./dom');
const {
    attachHistoryRestore,
    restoreQueryVersion,
    restoreSelectedVersion,
} = require('./history-restore');
const {
    attachHistorySave,
    saveQueryVersion,
} = require('./history-save');
const {
    attachHistorySync,
    SAVED_SEARCH_SYNC_STATUS,
    getSplunkRestSettings,
    classifyPushSyncStatus,
    getLatestFileCommit,
    renderEmptySavedSearchHistory,
    clearDashboardContext,
    clearSavedSearchContext,
    syncFileFromViewUrl,
    syncSavedSearchDraftOnNavigate,
    saveFileUrl,
    handleSplunkSave,
    applySavedSearchToFile,
    resolveDashboardFromFile,
    syncDashboardTrackedBase,
    enterDashboardHistory,
    applyDashboardToFile,
    seedQueryFromSources,
    resolveSavedSearchFromFile,
    preserveDraftBeforeRemoteSync,
    restoreDraftAfterRemoteSync,
    syncSavedSearchTrackedBase,
    pushSavedSearchHistoryAfterSave,
    enterSavedSearchHistory,
} = require('./history-sync');
const {
    attachHistoryTags,
    getTagsForHash,
    appendTagPills,
    attachVersionRowContextMenu,
    positionTagPopup,
    openTagPopup,
    closeTagPopup,
    saveTagFromPopup,
    clearTagFromPopup,
} = require('./history-tags');
const {
    attachHistoryPreview,
    versionPreviewText,
    getDraftPreviewQuery,
    setPreviewMode,
    renderVersionPreview,
} = require('./history-preview');

const DRAFT_VERSION_HASH = '__draft__';

let updateExplorer;
let openFile;
let createView;
let switchToFile;
let updateTabLabel;
let persistIdeFolders;
let syncFolderList;
let ensureDirectoryExists;
let getViewUrl;

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


function isSavedSearchFile(file) {
    return Boolean(file?.savedSearch);
}

function isDashboardFile(file) {
    return Boolean(file?.dashboard);
}

function isVersionedObjectFile(file) {
    return isSavedSearchFile(file) || isDashboardFile(file);
}

function getDashboardViewRelativePath(dashboard) {
    return getDashboardViewPath({
        instance: dashboard.instance,
        app: dashboard.app,
        owner: dashboard.owner,
        name: dashboard.name,
        ext: dashboard.ext || 'xml'
    });
}

function getSavedSearchStanzaName(file) {
    return String(file?.savedSearch?.name ?? '').trim();
}

function getVersionTagStanzaName(file) {
    return isSavedSearchFile(file) ? getSavedSearchStanzaName(file) : undefined;
}

function getListVersionsOptions(file) {
    const stanza = getSavedSearchStanzaName(file);
    return stanza ? { stanza } : {};
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


function setHistorySidebarMode(mode) {
    if (mode !== 'history' && mode !== 'tree' && mode !== 'tags') {
        return;
    }
    state.historySidebarMode = mode;
    historyTabs.forEach(tab => {
        tab.classList.toggle('active', tab.dataset.mode === mode);
    });
    renderHistorySidebarList();
}

// Query version history (per active .spl file)
function getActiveFile() {
    return state.files.find(f => f.id === state.activeFileId) || null;
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

function setStanzaSearch(stanzaText, stanzaName, search) {
    if (!stanzaText) {
        return `[${stanzaName}]\nsearch = ${search}\n\n`;
    }
    if (/^search\s*=/m.test(stanzaText)) {
        return stanzaText.replace(/^search\s*=.*$/m, `search = ${search}`);
    }
    const lines = stanzaText.split('\n');
    if (lines[0]?.startsWith('[')) {
        lines.splice(1, 0, `search = ${search}`);
        const block = lines.join('\n');
        return block.endsWith('\n') ? block : `${block}\n`;
    }
    return `[${stanzaName}]\nsearch = ${search}\n\n`;
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


function getRelativePath(file) {
    if (file.savedSearch) {
        return getSavedSearchConfPath(file.savedSearch);
    }
    if (file.dashboard) {
        return getDashboardViewRelativePath(file.dashboard);
    }
    return path.relative(state.currentProjectPath, file.path).split(path.sep).join('/');
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

function selectDraftVersion() {
    state.selectedVersionHashes = [DRAFT_VERSION_HASH];
    updateVersionSelectionUi();
}

function selectQueryVersion(version) {
    state.selectedVersionHashes = [version.hash];
    updateVersionSelectionUi();
}

function attachHistory({
    updateExplorer: updateExplorerFn,
    openFile: openFileFn,
    createView: createViewFn,
    switchToFile: switchToFileFn,
    updateTabLabel: updateTabLabelFn,
    persistIdeFolders: persistIdeFoldersFn,
    syncFolderList: syncFolderListFn,
    ensureDirectoryExists: ensureDirectoryExistsFn,
    getViewUrl: getViewUrlFn,
}) {
    updateExplorer = updateExplorerFn;
    openFile = openFileFn;
    createView = createViewFn;
    switchToFile = switchToFileFn;
    updateTabLabel = updateTabLabelFn;
    persistIdeFolders = persistIdeFoldersFn;
    syncFolderList = syncFolderListFn;
    ensureDirectoryExists = ensureDirectoryExistsFn;
    getViewUrl = getViewUrlFn;

    // phase 2: deps that only exist after attachHistory assigns the lets above
    attachHistorySync({
        getViewUrl,
        ensureDirectoryExists,
        persistIdeFolders,
        syncFolderList,
        updateExplorer,
        updateTabLabel,
    });

    querySaveBtn.addEventListener('click', saveQueryVersion);
    querySaveMessage.addEventListener('keydown', event => {
        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            if (!querySaveBtn.disabled) {
                saveQueryVersion();
            }
        }
    });
    queryRestoreBtn.addEventListener('click', restoreSelectedVersion);
    historyTabs.forEach(tab => {
        tab.addEventListener('click', () => setHistorySidebarMode(tab.dataset.mode));
    });
    tagPopupCancel.addEventListener('click', closeTagPopup);
    tagPopupClear.addEventListener('click', () => clearTagFromPopup());
    tagPopupSave.addEventListener('click', () => saveTagFromPopup());
    tagPopupInput.addEventListener('keydown', event => {
        if (event.key === 'Enter') {
            event.preventDefault();
            if (state.tagPopupClearMode) {
                clearTagFromPopup();
            } else {
                saveTagFromPopup();
            }
        }
        if (event.key === 'Escape') {
            event.preventDefault();
            closeTagPopup();
        }
    });
    queryPreviewModeBtns.forEach(btn => {
        btn.addEventListener('click', () => setPreviewMode(btn.dataset.mode));
    });
}

attachHistorySync({
    onQueryFileChanged,
    renderVersionPreview,
    updateStatusBar,
    getRelativePath,
    isSavedSearchFile,
    getSavedSearchStanzaName,
    getSavedSearchDraftStatus,
    getLiveAceOrUrlQuery,
    setStanzaSearch,
    getAceQueryText,
    getLiveQueryText,
    getListVersionsOptions,
    getVersionTagStanzaName,
    getDashboardViewRelativePath,
    refreshQueryHistory,
    syncSavedSearchAceEditor,
});
attachHistoryRestore({
    DRAFT_VERSION_HASH,
    getActiveFile,
    getRelativePath,
    isSavedSearchFile,
    getSavedSearchStanzaName,
    syncFileFromViewUrl,
    getSavedSearchDraftStatus,
    applySavedSearchAceFromStanza,
    refreshQueryHistory,
    getAceQueryText,
    getLiveQueryText,
    getLiveAceOrUrlQuery,
    isDashboardFile,
    getPrimarySelectedHash,
    isMultiVersionCompare,
});
attachHistorySave({
    getActiveFile,
    syncFileFromViewUrl,
    resolveSavedSearchFromFile,
    applySavedSearchToFile,
    getRelativePath,
    getAceQueryText,
    getLiveQueryText,
    seedQueryFromSources,
    isSavedSearchFile,
    getSavedSearchStanzaName,
    pushSavedSearchHistoryAfterSave,
    refreshQueryHistory,
});
attachHistoryTags({
    DRAFT_VERSION_HASH,
    getActiveFile,
    getRelativePath,
    getVersionTagStanzaName,
    renderHistorySidebarList,
    applyVersionRowClasses,
});
attachHistoryPreview({
    DRAFT_VERSION_HASH,
    getPrimarySelectedHash,
    isMultiVersionCompare,
    getTrackedBaseHash,
    getActiveFile,
    isSavedSearchFile,
    getLiveQueryText,
});

module.exports = {
    DRAFT_VERSION_HASH,
    SAVED_SEARCH_SYNC_STATUS,
    attachHistory,
    getPrimarySelectedHash,
    isMultiVersionCompare,
    updateVersionSelectionUi,
    handleVersionRowClick,
    toggleVersionMultiSelect,
    setHistorySidebarMode,
    getTagsForHash,
    appendTagPills,
    attachVersionRowContextMenu,
    positionTagPopup,
    openTagPopup,
    closeTagPopup,
    saveTagFromPopup,
    clearTagFromPopup,
    selectVersionByHash,
    buildVersionTreeRows,
    renderHistorySidebarList,
    renderVersionTreeList,
    renderTagsList,
    setPreviewMode,
    renderVersionPreview,
    appendDraftVersionRow,
    renderQueryVersionList,
    selectDraftVersion,
    selectQueryVersion,
    applyVersionRowClasses,
    getTrackedBaseHash,
    getSplunkRestSettings,
    classifyPushSyncStatus,
    getLatestFileCommit,
    isSavedSearchFile,
    isDashboardFile,
    isVersionedObjectFile,
    getDashboardViewRelativePath,
    getSavedSearchStanzaName,
    getVersionTagStanzaName,
    getListVersionsOptions,
    versionPreviewText,
    getSavedSearchDraftStatus,
    resolveEffectiveUnsavedChanges,
    renderEmptySavedSearchHistory,
    clearDashboardContext,
    clearSavedSearchContext,
    syncFileFromViewUrl,
    syncSavedSearchDraftOnNavigate,
    saveFileUrl,
    handleSplunkSave,
    applySavedSearchToFile,
    resolveDashboardFromFile,
    syncDashboardTrackedBase,
    enterDashboardHistory,
    applyDashboardToFile,
    getActiveFile,
    getLiveQueryText,
    getAceQueryText,
    setAceQueryText,
    applySavedSearchAceFromStanza,
    syncSavedSearchAceEditor,
    getDraftPreviewQuery,
    setStanzaSearch,
    getLiveAceOrUrlQuery,
    getQueryBaseline,
    shouldRefreshLiveDraftOnKey,
    scheduleRefreshLiveDraftState,
    refreshLiveDraftState,
    seedQueryFromSources,
    getRelativePath,
    resolveSavedSearchFromFile,
    preserveDraftBeforeRemoteSync,
    restoreDraftAfterRemoteSync,
    syncSavedSearchTrackedBase,
    pushSavedSearchHistoryAfterSave,
    enterSavedSearchHistory,
    onQueryFileChanged,
    updateStatusBar,
    initializeQueryVersions,
    refreshQueryDirtyState,
    refreshQueryHistory,
    saveQueryVersion,
    restoreQueryVersion,
    restoreSelectedVersion,
};
