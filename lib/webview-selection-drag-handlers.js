const { GUEST_DESELECT_JS } = require('./parent-selection-cleanup');

const DESELECT_ON_POINTER_EXIT_JS = GUEST_DESELECT_JS;

/**
 * Parent-side fallback when guest preload misses mouseup after pointer exit.
 *
 * @param {EventTarget & { executeJavaScript?: (code: string) => Promise<unknown> }} view
 * @returns {() => void}
 */
function attachWebviewSelectionDragHandlers(view) {
    const deselectOnPointerExit = () => {
        view.executeJavaScript(DESELECT_ON_POINTER_EXIT_JS).catch(() => {});
    };

    for (const eventType of ['mouseleave', 'mouseout', 'pointerleave', 'blur']) {
        view.addEventListener(eventType, deselectOnPointerExit);
    }

    return deselectOnPointerExit;
}

module.exports = {
    DESELECT_ON_POINTER_EXIT_JS,
    attachWebviewSelectionDragHandlers,
};
