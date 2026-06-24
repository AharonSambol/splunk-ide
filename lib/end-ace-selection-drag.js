/**
 * Reset Ace mouse-handler drag state.
 *
 * @param {object | null | undefined} mouseHandler
 */
function resetAceMouseHandler(mouseHandler) {
    if (!mouseHandler) return;

    try {
        mouseHandler.onMouseUp?.({
            domEvent: { button: 0, buttons: 0, which: 1, type: 'mouseup' },
        });
    } catch (err) {
        // ignore ineffective synthetic mouseup
    }

    mouseHandler.state = '';
    mouseHandler.$mousedownEvent = null;
}

/**
 * Clear Ace selection and native DOM selection.
 *
 * @param {object} editor
 */
function clearAceEditorSelection(editor) {
    const range = editor.getSelectionRange?.();
    if (range && !range.isEmpty()) {
        editor.selection.moveCursorTo(range.end.row, range.end.column);
        editor.clearSelection?.();
    }
}

/**
 * Clear browser text selection inside the document.
 *
 * @param {Document|ParentNode} doc
 */
function clearNativeSelection(doc) {
    const selection = doc.getSelection?.();
    if (selection && selection.rangeCount > 0 && !selection.isCollapsed) {
        selection.removeAllRanges();
    }
}

/**
 * @param {Document|ParentNode} doc
 * @returns {object | undefined}
 */
function getAceEditor(doc) {
    return doc.querySelector('.ace_editor')?.env?.editor;
}

/**
 * End an active drag without clearing the user's text selection.
 *
 * @param {Document|ParentNode} [root=document]
 */
function resetDragState(root) {
    const doc = root || (typeof document !== 'undefined' ? document : null);
    if (!doc) return;

    try {
        const editor = getAceEditor(doc);
        if (!editor) return;
        const mouseHandler = editor.$mouseHandler;
        if (!mouseHandler || (!mouseHandler.state && !mouseHandler.$mousedownEvent)) return;
        resetAceMouseHandler(mouseHandler);
    } catch (err) {
        // ignore
    }
}

/**
 * Clear Ace selection and native DOM selection.
 *
 * @param {Document|ParentNode} [root=document]
 */
function clearAceSelection(root) {
    const doc = root || (typeof document !== 'undefined' ? document : null);
    if (!doc) return;

    try {
        const editor = getAceEditor(doc);
        if (editor) {
            resetAceMouseHandler(editor.$mouseHandler);
            clearAceEditorSelection(editor);
        }
        clearNativeSelection(doc);
    } catch (err) {
        // ignore
    }
}

/**
 * Recover from a missed mouseup after pointer left the webview during drag.
 *
 * @param {Document|ParentNode} [root=document]
 */
function recoverFromMissedDrag(root) {
    clearAceSelection(root);
}

/**
 * Clear stuck Ace mouse-selection state when a mouseup is missed.
 * On keydown, recover only if the pointer left during an active drag.
 *
 * @param {Document|ParentNode} [root=document]
 */
function endAceSelectionDrag(root) {
    const doc = root || (typeof document !== 'undefined' ? document : null);
    if (!doc) return;

    const pointerExited = typeof globalThis !== 'undefined'
        && globalThis.__splunkIdePointerExited;
    const dragInProgress = typeof globalThis !== 'undefined'
        && globalThis.__splunkIdeDragInProgress;

    if (pointerExited && dragInProgress) {
        recoverFromMissedDrag(doc);
        return;
    }

    resetDragState(doc);
}

/** @deprecated use recoverFromMissedDrag */
const deselectAceOnPointerExit = recoverFromMissedDrag;

module.exports = {
    clearAceSelection,
    deselectAceOnPointerExit,
    endAceSelectionDrag,
    recoverFromMissedDrag,
    resetDragState,
    resetAceMouseHandler,
    clearAceEditorSelection,
};
