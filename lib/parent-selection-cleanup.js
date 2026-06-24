const GUEST_DESELECT_JS = `(function(){
    window.__splunkIdePointerExited = true;
    window.__splunkIdeDeselectAceOnPointerExit?.();
})()`;

/**
 * Parent-side cleanup when pointer exits webview or mouseup happens outside guest.
 *
 * @param {Document} [doc=document]
 */
function attachParentSelectionCleanup(doc) {
    const root = doc || (typeof document !== 'undefined' ? document : null);
    if (!root) return;

    const cleanupActiveWebview = () => {
        const view = root.querySelector('webview.active');
        if (!view || typeof view.executeJavaScript !== 'function') return;
        view.executeJavaScript(GUEST_DESELECT_JS).catch(() => {});
    };

    for (const eventType of ['mouseup', 'pointerup']) {
        root.addEventListener(eventType, cleanupActiveWebview, true);
    }
}

module.exports = {
    GUEST_DESELECT_JS,
    attachParentSelectionCleanup,
};
