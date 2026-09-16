'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { ipcRenderer } = require('electron');
const { attachWebviewSelectionDragHandlers } = require('../../lib/webview/webview-selection-drag-handlers');
const { buildSplunkSaveInjectorSource } = require('../../lib/webview/webview-splunk-save-hooks');
const state = require('../state');
const {
    prevPageBtn,
    nextPageBtn,
    viewsContainer,
} = require('../dom');

const PROJECT_ROOT = path.join(__dirname, '..', '..');

let syncFileFromViewUrl;
let saveFileUrl;
let handleSplunkSave;
let shouldRefreshLiveDraftOnKey;
let scheduleRefreshLiveDraftState;

function attachTabsView(deps) {
    ({
        syncFileFromViewUrl = syncFileFromViewUrl,
        saveFileUrl = saveFileUrl,
        handleSplunkSave = handleSplunkSave,
        shouldRefreshLiveDraftOnKey = shouldRefreshLiveDraftOnKey,
        scheduleRefreshLiveDraftState = scheduleRefreshLiveDraftState,
    } = deps);
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

module.exports = {
    attachTabsView,
    createView,
    navigateBack,
    navigateForward,
    updateNavButtons,
};
