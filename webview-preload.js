const path = require('node:path');
const { ipcRenderer } = require('electron');
const {
    recoverFromMissedDrag,
    resetDragState,
} = require(path.join(__dirname, 'lib', 'end-ace-selection-drag.js'));
const { attachSelectionDragTracker } = require(path.join(__dirname, 'lib', 'selection-drag-tracker.js'));

window.__splunkIdeRecoverFromMissedDrag = () => recoverFromMissedDrag(document);
window.__splunkIdeDeselectAceOnPointerExit = window.__splunkIdeRecoverFromMissedDrag;
window.__splunkIdePointerExited = false;
window.__splunkIdeDragInProgress = false;

attachSelectionDragTracker(document, {
    resetDragState: () => resetDragState(document),
    recoverFromMissedDrag: () => recoverFromMissedDrag(document),
});

// Capture keydown at the capture phase to observe events before page handlers.
window.addEventListener('keydown', (e) => {
    try {
        ipcRenderer.sendToHost('webview-keydown', {
            key: e.key,
            code: e.code,
            ctrl: e.ctrlKey,
            meta: e.metaKey,
            alt: e.altKey,
            shift: e.shiftKey
        });

        if (e.key === 'Enter') {
            const target = e.target;
            const isTextField = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target.isContentEditable;
            if (isTextField) {
                // Wait for the page to update its URL (Splunk reacts to Enter) before telling the host to save.
                // We'll listen for history/hash events and poll as a fallback with a timeout.
                try {
                    const prevHref = window.location.href;
                    let sent = false;
                    const sendSave = () => {
                        if (sent) return;
                        sent = true;
                        try { 
                            ipcRenderer.sendToHost('save-file'); 
                        } catch (err) { /* ignore */ }
                        window.removeEventListener('popstate', onLoc);
                        window.removeEventListener('hashchange', onLoc);
                        clearInterval(pollId);
                    };

                    const onLoc = () => {
                        if (window.location.href !== prevHref) {
                            sendSave();
                        }
                    };

                    window.addEventListener('popstate', onLoc);
                    window.addEventListener('hashchange', onLoc);

                    const pollInterval = 50;
                    const maxWait = 1000;
                    let waited = 0;
                    const pollId = setInterval(() => {
                        if (window.location.href !== prevHref) {
                            sendSave();
                            return;
                        }
                        waited += pollInterval;
                        if (waited >= maxWait) {
                            // give up waiting and send save anyway
                            sendSave();
                        }
                    }, pollInterval);
                } catch (err) {
                    // fallback: send immediately
                    try { ipcRenderer.sendToHost('save-file'); } catch (e) { /* ignore */ }
                }
            }
        }
    } catch (err) {
        console.error('Error sending keydown event to host:', err);
        // ignore
    }
}, true);

// Also forward beforeinput events if available
window.addEventListener('beforeinput', (e) => {
    try {
        ipcRenderer.sendToHost('webview-beforeinput', { inputType: e.inputType });
    } catch (err) {}
}, true);

// Forward contextmenu events (right-click) to the host so the native menu can be shown.
window.addEventListener('contextmenu', async (e) => {
    try {
        let selection = window.getSelection().toString();
        ipcRenderer.sendToHost('webview-contextmenu', { x: e.clientX, y: e.clientY, selection });
    } catch (err) {
        // ignore
    }
}, true);
