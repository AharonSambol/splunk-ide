const GUEST_RECOVER_JS = `(function(){
    window.__splunkIdePointerExited = true;
    if (window.__splunkIdeDragInProgress) {
        window.__splunkIdeRecoverFromMissedDrag?.();
        window.__splunkIdeDragInProgress = false;
    }
})()`;

const GUEST_CLEAR_SELECTION_JS = 'window.__splunkIdeClearSelection?.()';

/** @deprecated use GUEST_RECOVER_JS */
const GUEST_DESELECT_JS = GUEST_RECOVER_JS;

/**
 * Parent-side cleanup when mouseup happens outside the guest during drag.
 * Recovery is gated inside the guest on __splunkIdeDragInProgress.
 *
 * @param {Document} [doc=document]
 */
function attachParentSelectionCleanup(doc) {
    const root = doc || (typeof document !== 'undefined' ? document : null);
    if (!root) return;

    const recoverActiveWebview = () => {
        const view = root.querySelector('webview.active');
        if (!view || typeof view.executeJavaScript !== 'function') return;
        view.executeJavaScript(GUEST_RECOVER_JS).catch(() => {});
    };

    const clearActiveWebviewSelection = (event) => {
        const target = event?.target;
        if (target && typeof target.closest === 'function' && target.closest('webview.active')) {
            return;
        }
        const view = root.querySelector('webview.active');
        if (!view || typeof view.executeJavaScript !== 'function') return;
        view.executeJavaScript(GUEST_CLEAR_SELECTION_JS).catch(() => {});
    };

    for (const eventType of ['mouseup', 'pointerup']) {
        root.addEventListener(eventType, recoverActiveWebview, true);
    }

    for (const eventType of ['mousedown', 'pointerdown']) {
        root.addEventListener(eventType, clearActiveWebviewSelection, true);
    }
}

module.exports = {
    GUEST_CLEAR_SELECTION_JS,
    GUEST_DESELECT_JS,
    GUEST_RECOVER_JS,
    attachParentSelectionCleanup,
};
