'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { ipcRenderer } = require('electron');
const {
    closeFileState,
    reorderTabs: computeTabOrder,
    getPreviousTab,
    getNextTab,
    createDuplicateFileName,
} = require('../lib/ui/tab-state');
const { getFileFolder } = require('../lib/splunk-url');
const { createTabElement, setActiveTab, updateTabTitle } = require('../lib/ui/render-tabs');
const { attachWebviewSelectionDragHandlers } = require('../lib/webview/webview-selection-drag-handlers');
const { buildSplunkSaveInjectorSource } = require('../lib/webview/webview-splunk-save-hooks');
const state = require('./state');
const {
    copyUrlBtn,
    prevPageBtn,
    nextPageBtn,
    tabBar,
    viewsContainer,
    querySidebar,
} = require('./dom');
const { QUERY_SIDEBAR_COLLAPSED_KEY } = require('./layout');

const PROJECT_ROOT = path.join(__dirname, '..');

let syncFileFromViewUrl;
let saveFileUrl;
let handleSplunkSave;
let refreshQueryHistory;
let updateExplorer;
let onQueryFileChanged;
let getActiveFile = () => state.files.find(f => f.id === state.activeFileId) || null;
let createFileWithUrl;
let shouldRefreshLiveDraftOnKey;
let scheduleRefreshLiveDraftState;
let refreshQueryDirtyState;
let setQueryHistoryPanelOpen;

function copyActiveFileUrl() {
    if (!state.activeFileId) {
        alert('No file open');
        return;
    }

    const file = getActiveFile();

    saveFileUrl(file.id);

    if (!file?.url) {
        alert('No URL available');
        return;
    }

    navigator.clipboard.writeText(file.url).then(() => {
        copyUrlBtn.textContent = 'Copied!';
        setTimeout(() => {
            copyUrlBtn.textContent = 'Copy URL';
        }, 2000);
    }).catch(err => {
        alert('Failed to copy: ' + err);
    });
}

function duplicateCurrentTab() {
    if (!state.activeFileId) {
        alert('No file open to duplicate');
        return;
    }

    const activeFile = getActiveFile();
    if (!activeFile) {
        return;
    }

    const baseName = activeFile.name.split('/').pop();
    const folder = getFileFolder(activeFile.name);
    const newName = createDuplicateFileName(state.files, baseName);
    createFileWithUrl(newName, activeFile.url, folder);
}

function getOpenTabIds() {
    return Array.from(tabBar.querySelectorAll('.tab')).map(tab => tab.dataset.targetId);
}

function closeTab(fileId) {
    const file = state.files.find(f => f.id === fileId);
    if (!file) {
        return;
    }

    saveFileUrl(fileId);

    const openTabsBeforeClose = getOpenTabIds();
    const wasActive = state.activeFileId === fileId;

    const tab = tabBar.querySelector(`.tab[data-target-id="${fileId}"]`);
    if (tab) {
        tab.remove();
    }

    const view = document.getElementById(fileId);
    if (view) {
        view.remove();
    }

    const tabState = closeFileState(state.files, openTabsBeforeClose, state.activeFileId, fileId, state.fileMru);
    state.fileMru = tabState.fileMru;

    if (wasActive) {
        if (tabState.activeFileId) {
            switchToFile(tabState.activeFileId);
        } else {
            state.activeFileId = null;
            document.querySelectorAll('webview').forEach(view => view.classList.remove('active'));
            document.querySelectorAll('.explorer-item').forEach(item => item.classList.remove('active'));
        }
    }
}

function getViewUrl(fileId) {
    const view = document.getElementById(fileId);
    if (!view) {
        return '';
    }
    try {
        return view.getURL() || '';
    } catch {
        return '';
    }
}

function updateTabLabel(file) {
    updateTabTitle(tabBar, file.id, file.name);
}

function createTab(file) {
    const tab = createTabElement(document, file, state.activeFileId, {
        onClose: closeTab,
        onSwitch: switchToFile,
    });

    // Drag and drop handlers
    tab.addEventListener('dragstart', (e) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', file.id);
        tab.classList.add('dragging');
    });

    tab.addEventListener('dragend', () => {
        tab.classList.remove('dragging');
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('drag-over'));
    });

    tab.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const draggedTab = tabBar.querySelector('.tab.dragging');
        if (draggedTab && draggedTab !== tab) {
            const rect = tab.getBoundingClientRect();
            const midpoint = rect.left + rect.width / 2;
            if (e.clientX < midpoint) {
                tab.classList.add('drag-over');
            } else {
                tab.classList.remove('drag-over');
            }
        }
    });

    tab.addEventListener('dragleave', () => {
        tab.classList.remove('drag-over');
    });

    tab.addEventListener('drop', (dropEvent) => {
        dropEvent.preventDefault();
        const draggedFileId = dropEvent.dataTransfer.getData('text/plain');
        if (draggedFileId && draggedFileId !== file.id) {
            reorderTabs(draggedFileId, file.id, dropEvent);
        }
    });

    tabBar.appendChild(tab);
}

function createView(file) {
    const view = document.createElement('webview');
    view.id = file.id;
    view.setAttribute('allowpopups', '');

    // use a preload script so we can capture keys inside the guest page
    try {
        const preloadPath = path.join(PROJECT_ROOT, 'webview-preload.js');
        // Preload must be an absolute file:// URL and set before src
        view.setAttribute('preload', pathToFileURL(preloadPath).href);
        view.setAttribute('webpreferences', 'contextIsolation=yes,sandbox=yes');
    } catch (err) {

    }
    // set src after preload so the preload script is injected
    view.src = file.url || state.SPLUNK_URL;
    viewsContainer.appendChild(view);

    // Listen for key events forwarded from the webview preload
    view.addEventListener('ipc-message', async (event) => {
        if (event.channel === 'webview-keydown') {
            const keyInfo = event.args[0] || {};
            if (shouldRefreshLiveDraftOnKey(keyInfo)) {
                scheduleRefreshLiveDraftState(file.id);
            }
        } else if (event.channel === 'webview-beforeinput') {
            scheduleRefreshLiveDraftState(file.id);
        } else if (event.channel === 'save-file') {
            saveFileUrl(file.id);
        } else if (event.channel === 'splunk-save') {
            void handleSplunkSave(file.id);
        } else if (event.channel === 'webview-contextmenu') {
            // Forward to main process to show native menu
            try {
                const info = event.args[0] || {};
                // include webContentsId so main can target the webview's webContents
                try { info.webContentsId = view.getWebContentsId(); } catch (e) {}
                // try and get the selection from the .ace_editor
                let selection = await view.executeJavaScript(`
                (() => {
                    const el = document.querySelector('.ace_editor');
                    return el?.env?.editor?.getSelectedText() ?? '';
                })()
                `);
                if(selection) {
                    info.selection = selection;
                }
                ipcRenderer.invoke('show-context-menu', info);
            } catch (err) {
                console.error('Failed to invoke show-context-menu', err);
            }
        }
    });
    // Update navigation button state on navigation events
    const updateNavState = () => {
        try {
            const active = document.querySelector('webview.active');
            if (!active) {
                prevPageBtn.disabled = true;
                nextPageBtn.disabled = true;
                return;
            }
            try {
                prevPageBtn.disabled = !(typeof active.canGoBack === 'function' ? active.canGoBack() : false);
            } catch (e) { prevPageBtn.disabled = true; }
            try {
                nextPageBtn.disabled = !(typeof active.canGoForward === 'function' ? active.canGoForward() : false);
            } catch (e) { nextPageBtn.disabled = true; }
        } catch (e) {
            prevPageBtn.disabled = true;
            nextPageBtn.disabled = true;
        }
    };

    const syncUrlFromView = () => {
        void syncFileFromViewUrl(file.id);
    };

    view.addEventListener('did-navigate', updateNavState);
    view.addEventListener('did-navigate-in-page', updateNavState);
    view.addEventListener('did-stop-loading', updateNavState);
    view.addEventListener('dom-ready', updateNavState);
    view.addEventListener('did-navigate-in-page', syncUrlFromView);
    view.addEventListener('did-navigate', syncUrlFromView);
    view.addEventListener('did-stop-loading', syncUrlFromView);
    const injectorCode = [
        fs.readFileSync(path.join(PROJECT_ROOT, 'injectors', 'injector.js'), 'utf8'),
        fs.readFileSync(path.join(PROJECT_ROOT, 'injectors', 'injector-selection-cleanup.js'), 'utf8'),
    ].join('\n');
    const saveHookCode = buildSplunkSaveInjectorSource();
    const injectGuestScripts = () => {
        view.executeJavaScript(injectorCode).catch((err) => {
            console.error('Failed to inject guest helpers into webview', file.id, err);
        });
        view.executeJavaScript(saveHookCode)
            .then(() => {
                console.log('save hooks injected into webview', file.id);
            })
            .catch((err) => {
                console.error('Failed to inject save hooks into webview', file.id, err);
            });
    };
    view.addEventListener('dom-ready', injectGuestScripts);
    view.addEventListener('did-navigate-in-page', injectGuestScripts);
    view.addEventListener('did-stop-loading', injectGuestScripts);

    // Ensure nav state is updated when this view becomes active
    view.addEventListener('focus', () => {
        try { updateNavState(); } catch (e) {}
    });

    view.__endSelectionDrag = attachWebviewSelectionDragHandlers(view);
}

function navigateBack() {
    const view = document.querySelector('webview.active');
    if (!view) return;
    try {
        if (typeof view.canGoBack === 'function') {
            if (view.canGoBack()) return view.goBack();
        }
        // fallback: execute history.back in webview
        view.executeJavaScript('history.back()').catch(() => {});
    } catch (e) {
        // ignore
    }
}

function navigateForward() {
    const view = document.querySelector('webview.active');
    if (!view) return;
    try {
        if (typeof view.canGoForward === 'function') {
            if (view.canGoForward()) return view.goForward();
        }
        view.executeJavaScript('history.forward()').catch(() => {});
    } catch (e) {
        // ignore
    }
}

function updateNavButtons() {
    try {
        const view = document.querySelector('webview.active');
        if (!view) {
            prevPageBtn.disabled = true;
            nextPageBtn.disabled = true;
            return;
        }
        try { prevPageBtn.disabled = !(typeof view.canGoBack === 'function' ? view.canGoBack() : false); } catch (e) { prevPageBtn.disabled = true; }
        try { nextPageBtn.disabled = !(typeof view.canGoForward === 'function' ? view.canGoForward() : false); } catch (e) { nextPageBtn.disabled = true; }
    } catch (e) {
        prevPageBtn.disabled = true;
        nextPageBtn.disabled = true;
    }
}

function applyTabOrder(tabIds) {
    tabIds.forEach(tabId => {
        const tab = tabBar.querySelector(`.tab[data-target-id="${tabId}"]`);
        if (tab) {
            tabBar.appendChild(tab);
        }
    });
}

function reorderTabs(draggedFileId, targetFileId, dropEvent) {
    const targetTab = tabBar.querySelector(`.tab[data-target-id="${targetFileId}"]`);
    if (!targetTab || !tabBar.querySelector(`.tab[data-target-id="${draggedFileId}"]`)) {
        return;
    }

    const rect = targetTab.getBoundingClientRect();
    const midpoint = rect.left + rect.width / 2;
    const position = dropEvent.clientX < midpoint ? 'before' : 'after';
    const newOrder = computeTabOrder(getOpenTabIds(), draggedFileId, targetFileId, position);
    applyTabOrder(newOrder);
}

function activateFile(targetId) {
    if (!state.files.some(file => file.id === targetId)) {
        return;
    }

    if (state.activeFileId && state.activeFileId !== targetId) {
        const outgoingView = document.getElementById(state.activeFileId);
        try { outgoingView?.__endSelectionDrag?.(); } catch (e) {}
        saveFileUrl(state.activeFileId);
    }

    state.activeFileId = targetId;
    state.fileMru = state.fileMru.filter(id => id !== targetId);
    state.fileMru.unshift(targetId);

    setActiveTab(tabBar, targetId);

    document.querySelectorAll('webview').forEach(view => {
        view.classList.toggle('active', view.id === targetId);
    });

    document.querySelectorAll('.explorer-item').forEach(item => {
        item.classList.toggle('active', item.dataset.fileId === targetId);
    });
}

function switchToFile(targetId) {
    const prevFileId = state.activeFileId;
    activateFile(targetId);
    if (prevFileId !== targetId) {
        state.selectedVersionHashes = [];
    }
    try { setTimeout(updateNavButtons, 50); } catch (e) {}
    refreshQueryDirtyState(targetId);
    void (async () => {
        await syncFileFromViewUrl(targetId);
        if (!querySidebar.classList.contains('collapsed')) {
            await refreshQueryHistory();
        } else if (state.activeFileId && localStorage.getItem(QUERY_SIDEBAR_COLLAPSED_KEY) !== 'true') {
            setQueryHistoryPanelOpen(true);
        }
    })();
}

function openMostRecentTab() {
    if (state.fileMru.length < 2) {
        return;
    }

    const targetId = state.fileMru[1];
    switchToFile(targetId);
}

function switchToPreviousTab() {
    const previousTabId = getPreviousTab(getOpenTabIds(), state.activeFileId);
    if (previousTabId) {
        switchToFile(previousTabId);
    }
}

function switchToNextTab() {
    const nextTabId = getNextTab(getOpenTabIds(), state.activeFileId);
    if (nextTabId) {
        switchToFile(nextTabId);
    }
}

function attachTabs({
    syncFileFromViewUrl: syncFn,
    saveFileUrl: saveFn,
    handleSplunkSave: saveHookFn,
    refreshQueryHistory: refreshFn,
    updateExplorer: updateExplorerFn,
    onQueryFileChanged: onQueryFn,
    getActiveFile: getActiveFn,
    createFileWithUrl: createFileFn,
    shouldRefreshLiveDraftOnKey: shouldRefreshFn,
    scheduleRefreshLiveDraftState: scheduleFn,
    refreshQueryDirtyState: dirtyFn,
    setQueryHistoryPanelOpen: setPanelFn,
} = {}) {
    syncFileFromViewUrl = syncFn;
    saveFileUrl = saveFn;
    handleSplunkSave = saveHookFn;
    refreshQueryHistory = refreshFn;
    updateExplorer = updateExplorerFn;
    onQueryFileChanged = onQueryFn;
    if (getActiveFn) {
        getActiveFile = getActiveFn;
    }
    createFileWithUrl = createFileFn;
    shouldRefreshLiveDraftOnKey = shouldRefreshFn;
    scheduleRefreshLiveDraftState = scheduleFn;
    refreshQueryDirtyState = dirtyFn;
    setQueryHistoryPanelOpen = setPanelFn;
    copyUrlBtn.addEventListener('click', copyActiveFileUrl);
    prevPageBtn.addEventListener('click', navigateBack);
    nextPageBtn.addEventListener('click', navigateForward);
}

module.exports = {
    attachTabs,
    getOpenTabIds,
    closeTab,
    duplicateCurrentTab,
    copyActiveFileUrl,
    getViewUrl,
    updateTabLabel,
    createTab,
    createView,
    navigateBack,
    navigateForward,
    updateNavButtons,
    applyTabOrder,
    reorderTabs,
    switchToFile,
    openMostRecentTab,
    switchToPreviousTab,
    switchToNextTab,
};
