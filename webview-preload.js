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

        if (e.key === 'Enter') {
            const target = e.target;
            const isTextField = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target.isContentEditable;
            if (isTextField) {
                ipcRenderer.sendToHost('save-file');
            }
        }
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
