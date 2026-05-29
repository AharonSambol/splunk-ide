const { ipcRenderer } = require('electron');

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
    } catch (err) {
        // ignore
    }
}, true);

// Also forward beforeinput events if available
window.addEventListener('beforeinput', (e) => {
    try {
        ipcRenderer.sendToHost('webview-beforeinput', { inputType: e.inputType });
    } catch (err) {}
}, true);
