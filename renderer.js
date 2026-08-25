const { ipcRenderer } = require('electron');
const { attachParentSelectionCleanup } = require('./lib/parent-selection-cleanup');
const state = require('./renderer/state');
const { closeConfirmModal, attachConfirmModal } = require('./renderer/confirm-modal');
const { showFindOverlay, hideFindOverlay } = require('./renderer/find-overlay');
const {
    loadGitSyncSettings,
    closeGitSyncSettingsModal,
    attachGitSettings,
} = require('./renderer/git-settings');
const {
    openQuickSearch,
    closeQuickSearch,
    attachQuickSearch,
} = require('./renderer/quick-search');
const {
    attachLayout,
    initializeLayoutControls,
    setQueryHistoryPanelOpen,
    toggleQueryHistoryPanel,
} = require('./renderer/layout');
const {
    attachExplorer,
    openFile,
    loadProject,
    createNewFile,
    openStartupSearch,
    hideNewItemMenu,
    closeNewFileModal,
    updateExplorer,
    ensureDirectoryExists,
    syncFolderList,
    persistIdeFolders,
    createFileWithUrl,
    openNewFileModal,
    clearOpenTabs,
} = require('./renderer/explorer');
const {
    attachTabs,
    createTab,
    createView,
    closeTab,
    switchToFile,
    updateTabLabel,
    duplicateCurrentTab,
    openMostRecentTab,
    switchToPreviousTab,
    switchToNextTab,
    getViewUrl,
} = require('./renderer/tabs');
const {
    attachHistory,
    closeTagPopup,
    initializeQueryVersions,
    refreshQueryHistory,
    onQueryFileChanged,
    applySavedSearchToFile,
    syncFileFromViewUrl,
    saveFileUrl,
    handleSplunkSave,
    getActiveFile,
    shouldRefreshLiveDraftOnKey,
    scheduleRefreshLiveDraftState,
    refreshQueryDirtyState,
    updateStatusBar,
} = require('./renderer/history');

attachParentSelectionCleanup(document);
attachConfirmModal();
attachGitSettings();

const {
    newFileBtn,
    newItemMenu,
    newSearchChoice,
    newFolderBtn,
    newProjectBtn,
    openProjectBtn,
    projectNameLabel,
    tabBar,
    explorer,
    historyTabs,
    sidebar,
    sidebarCollapseBtn,
    sidebarReopenBtn,
    sidebarResize,
    querySidebarResize,
    sidebarDragOverlay,
    quickSearchOverlay,
    quickSearchModal,
    newFileModal,
    newFileModalBox,
    newFileModalLabel,
    newFileModalInput,
    newFileFolderRow,
    newFileFolderSelect,
    newFileCreateBtn,
    newFileCancelBtn,
    querySidebar,
    querySidebarReopenBtn,
    queryHistoryTitle,
    queryHistoryStatus,
    queryHistoryClose,
    queryVersionList,
    tagPopup,
    tagPopupInput,
    tagPopupCancel,
    tagPopupClear,
    tagPopupSave,
    queryVersionPreviewText,
    queryPreviewModeBtns,
    querySaveMessage,
    querySaveBtn,
    queryRestoreBtn,
    confirmModal,
    confirmModalBox,
    confirmModalTitle,
    confirmModalBody,
    confirmCancelBtn,
    confirmOkBtn,
    gitSyncSettingsModal,
    gitSyncSettingsModalBox,
    statusFile,
    statusSave,
    statusVersions,
} = require('./renderer/dom');

attachHistory({
    updateExplorer,
    openFile,
    createView,
    switchToFile,
    updateTabLabel,
    persistIdeFolders,
    syncFolderList,
    ensureDirectoryExists,
    getViewUrl,
});
attachExplorer({
    createTab,
    createView,
    closeTab,
    switchToFile,
    clearOpenTabs,
    initializeQueryVersions,
    refreshQueryHistory,
    onQueryFileChanged,
    applySavedSearchToFile,
    updateTabLabel,
});
attachTabs({
    syncFileFromViewUrl,
    saveFileUrl,
    handleSplunkSave,
    refreshQueryHistory,
    updateExplorer,
    onQueryFileChanged,
    getActiveFile,
    createFileWithUrl,
    shouldRefreshLiveDraftOnKey,
    scheduleRefreshLiveDraftState,
    refreshQueryDirtyState,
    setQueryHistoryPanelOpen,
});
attachLayout({
    syncActiveFile: syncFileFromViewUrl,
    refreshHistory: refreshQueryHistory,
    updateStatusBar,
});

document.addEventListener('mousedown', event => {
    const target = event.target;
    if (!(target instanceof Node)) {
        return;
    }
    if (tagPopup.classList.contains('visible') && !tagPopup.contains(target)) {
        closeTagPopup();
    }
    if (quickSearchOverlay.classList.contains('visible') && !quickSearchModal.contains(target)) {
        closeQuickSearch();
    }
    if (newFileModal.classList.contains('visible') && !newFileModalBox.contains(target)) {
        closeNewFileModal();
    }
    if (confirmModal.classList.contains('visible') && !confirmModalBox.contains(target)) {
        closeConfirmModal(false);
    }
    if (gitSyncSettingsModal.classList.contains('visible') && !gitSyncSettingsModalBox.contains(target)) {
        closeGitSyncSettingsModal();
    }
    if (newItemMenu.classList.contains('visible') && !newItemMenu.contains(target) && target !== newFileBtn) {
        hideNewItemMenu();
    }
    if (state._findOverlay && !state._findOverlay.overlay.contains(target)) {
        hideFindOverlay();
    }
});
ipcRenderer.on('app-keydown', (_event, keyInfo) => {
    handleKeyboardShortcut(keyInfo);
});
attachQuickSearch({ openFile });

window.onload = async () => {
    initializeLayoutControls();
    await loadGitSyncSettings();
    const workspacePath = await ipcRenderer.invoke('get-default-workspace');
    await loadProject(workspacePath);
    if (state.files.length === 0) {
        createNewFile('Search 1');
    } else {
        openStartupSearch();
    }
};

function handleKeyboardShortcut(d) {
    if (!d || typeof d.key !== 'string') {
        return;
    }

    // Skip if modal or quick search is open
    if (quickSearchOverlay.classList.contains('visible')
        || newFileModal.classList.contains('visible')
        || confirmModal.classList.contains('visible')
        || tagPopup.classList.contains('visible')) {
        return;
    }

    // Close find overlay on Escape (also handles key events forwarded from webview)
    try {
        if (d && typeof d.key === 'string' && d.key.toLowerCase() === 'escape') {
            try { hideFindOverlay(); } catch (e) { /* ignore */ }
            try {
                const view = document.querySelector('webview.active');
                if (view) {
                    const id = view.getWebContentsId();
                    ipcRenderer.invoke('stop-find-in-page', { webContentsId: id, action: 'clearSelection' });
                }
            } catch (e) { /* ignore */ }
            return;
        }
    } catch (e) { /* ignore */ }

    const key = d.key.toLowerCase();
    const ctrlOrMeta = !!(d.ctrl || d.meta);

    // Handle Shift-Shift for quick search
    if (key === 'shift') {
        state.shiftTapCount += 1;

        if (state.shiftTapCount === 1) {
            state.shiftTimer = globalThis.setTimeout(() => {
                state.shiftTapCount = 0;
            }, 400);
        } else if (state.shiftTapCount === 2) {
            globalThis.clearTimeout(state.shiftTimer);
            state.shiftTapCount = 0;
            openQuickSearch();
        }
        return;
    }

    // Handle modifed shortcuts
    if (ctrlOrMeta) {
        if (d.shift && key === 'f') {
            openQuickSearch('content');
            return;
        }
        if (d.shift && key === 'n') {
            duplicateCurrentTab();
            return;
        }
        if (d.shift && key === 'h') {
            toggleQueryHistoryPanel();
            return;
        }
        if (key === 'tab') {
            openMostRecentTab();
        } else if (key === 'n') {
            openNewFileModal();
        }

        // Ctrl+F / Cmd+F -> use Electron findInPage for active webview
        try {
            if (key === 'f') {
                const view = document.querySelector('webview.active');
                if (!view) return;
                showFindOverlay(view);
                return;
            }

            // Escape -> clear find highlights (also handled by overlay)
            if (keyName === 'escape') {
                const view = document.querySelector('webview.active');
                if (view) {
                    try {
                        const id = view.getWebContentsId();
                        ipcRenderer.invoke('stop-find-in-page', { webContentsId: id, action: 'clearSelection' });
                    } catch (err) {
                        // ignore
                    }
                }
            }
        } catch (err) {
            // ignore
        }

    }

    // Handle Alt+Left/Right for tab navigation
    if (d.alt) {
        if (d.code === 'ArrowLeft' || key === 'arrowleft') {
            switchToPreviousTab();
        } else if (d.code === 'ArrowRight' || key === 'arrowright') {
            switchToNextTab();
        }
    }
}

// Handle commands from main process context menu (Select All, etc.)
ipcRenderer.on('context-menu-command', (event, arg) => {
    try {
        const cmd = arg && arg.command;
        const view = document.querySelector('webview.active');
        if (!view) return;

        if (cmd === 'selectAll') {
            try {
                view.executeJavaScript('document.execCommand("selectAll");').catch(() => {});
            } catch (err) {
                // ignore
            }
        }
        if (cmd === 'paste') {
            const text = arg && arg.text ? arg.text : '';
            if (!text) return;
            try {
                // Insert text at the current selection/caret inside the webview
                const safeText = JSON.stringify(text);
                const js = `(function(){ try{ if(window.getSelection && window.getSelection().rangeCount>0){ const sel=window.getSelection(); const range=sel.getRangeAt(0); range.deleteContents(); const node=document.createTextNode(${safeText}); range.insertNode(node); // move caret after inserted node
                    range.setStartAfter(node); range.collapse(true); sel.removeAllRanges(); sel.addRange(range);
                } else { document.execCommand('insertText', false, ${safeText}); } } catch(e){} })();`;
                view.executeJavaScript(js).catch(() => {});
            } catch (err) {
                // ignore
            }
        }
    } catch (err) {
        console.error('context-menu-command handler error', err);
    }
});
