'use strict';

const { ipcRenderer } = require('electron');
const state = require('./state');

// Inline find overlay for Ctrl+F (behaves like Chrome's find)
function createFindOverlay() {
    if (state._findOverlay) return state._findOverlay;
    const overlay = document.createElement('div');
    overlay.id = 'find-overlay';
    overlay.style.position = 'fixed';
    overlay.style.top = '8px';
    overlay.style.right = '8px';
    overlay.style.zIndex = 9999;
    overlay.style.background = 'rgba(40,40,40,0.95)';
    overlay.style.color = '#fff';
    overlay.style.padding = '6px';
    overlay.style.borderRadius = '6px';
    overlay.style.display = 'flex';
    overlay.style.alignItems = 'center';
    overlay.style.boxShadow = '0 2px 10px rgba(0,0,0,0.4)';

    const input = document.createElement('input');
    input.type = 'search';
    input.placeholder = 'Find in page';
    input.style.padding = '6px';
    input.style.border = 'none';
    input.style.outline = 'none';
    input.style.background = 'transparent';
    input.style.color = '#fff';
    input.style.width = '260px';

    const prevBtn = document.createElement('button');
    prevBtn.textContent = '◀';
    prevBtn.title = 'Previous';
    prevBtn.style.marginLeft = '6px';
    prevBtn.className = "project-action";

    const nextBtn = document.createElement('button');
    nextBtn.textContent = '▶';
    nextBtn.title = 'Next';
    nextBtn.style.marginLeft = '4px';
    nextBtn.className = "project-action";

    const closeBtn = document.createElement('button');
    closeBtn.textContent = '✕';
    closeBtn.title = 'Close';
    closeBtn.style.marginLeft = '8px';
    closeBtn.className = "project-action";

    overlay.appendChild(input);
    overlay.appendChild(prevBtn);
    overlay.appendChild(nextBtn);
    overlay.appendChild(closeBtn);
    document.body.appendChild(overlay);

    // Events
    input.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') {
            ev.preventDefault();
            // Enter should move to next result
            doFind(input.value, true, true);
        } else if (ev.key === 'Escape') {
            ev.preventDefault();
            hideFindOverlay();
        }
    });

    // Live search on each character change
    input.addEventListener('input', (ev) => {
        try {
            doFind(input.value, true, true);
        } catch (e) {
            // ignore
        }
    });

    nextBtn.addEventListener('click', () => {
        doFind(input.value, true, true);
    });
    prevBtn.addEventListener('click', () => {
        doFind(input.value, false, true);
    });
    closeBtn.addEventListener('click', hideFindOverlay);

    state._findOverlay = { overlay, input, prevBtn, nextBtn, closeBtn };
    return state._findOverlay;
}

function showFindOverlay(view) {
    const f = createFindOverlay();
    f.input.value = state._lastFindQuery || '';
    f.input.focus();
    f.input.select();
    state._findWasActive = true;
}

function hideFindOverlay() {
    if (!state._findOverlay) return;
    try {
        // remove overlay from DOM
        state._findOverlay.overlay.remove();
    } catch (e) {
        // ignore
    }
    state._findOverlay = null;
    state._lastFindQuery = '';
    state._findWasActive = false;
    try {
        const view = document.querySelector('webview.active');
        if (view) {
            const id = view.getWebContentsId();
            ipcRenderer.invoke('stop-find-in-page', { webContentsId: id, action: 'clearSelection' });
        }
    } catch (err) {
        // ignore
    }
}

function doFind(text, forward = true, findNext = false) {
    if (!text) return;
    state._lastFindQuery = text;
    try {
        const view = document.querySelector('webview.active');
        if (!view) return;
        const id = view.getWebContentsId();
        ipcRenderer.invoke('find-in-page', { webContentsId: id, text, options: { forward, findNext } });
    } catch (err) {
        // ignore
    }
}

module.exports = {
    createFindOverlay,
    showFindOverlay,
    hideFindOverlay,
    doFind,
};
