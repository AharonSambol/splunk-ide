const { GUEST_RECOVER_JS } = require('./parent-selection-cleanup');

const DESELECT_ON_POINTER_EXIT_JS = GUEST_RECOVER_JS;

/**
 * Parent-side fallback when guest preload misses mouseup after pointer exit.
 *
 * @param {EventTarget & { executeJavaScript?: (code: string) => Promise<unknown> }} view
 * @returns {() => void}
 */
function attachWebviewSelectionDragHandlers(view) {
    const recoverOnPointerExit = () => {
        view.executeJavaScript(DESELECT_ON_POINTER_EXIT_JS).catch(() => {});
    };

    for (const eventType of ['mouseleave', 'pointerleave']) {
        view.addEventListener(eventType, recoverOnPointerExit);
    }

    return recoverOnPointerExit;
}

module.exports = {
    DESELECT_ON_POINTER_EXIT_JS,
    attachWebviewSelectionDragHandlers,
};
