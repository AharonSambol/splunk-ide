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
 * Aggressively deselect Ace when the pointer leaves the guest page/webview.
 * Used on mouseleave/pointerleave from parent or guest document.
 *
 * @param {Document|ParentNode} [root=document]
 */
function deselectAceOnPointerExit(root) {
    const doc = root || (typeof document !== 'undefined' ? document : null);
    if (!doc) return;

    try {
        const editor = doc.querySelector('.ace_editor')?.env?.editor;
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
 * Clear stuck Ace mouse-selection state when a mouseup is missed.
 * On keydown, also deselect if the pointer previously left the page.
 *
 * @param {Document|ParentNode} [root=document]
 */
function endAceSelectionDrag(root) {
    const doc = root || (typeof document !== 'undefined' ? document : null);
    if (!doc) return;

    const pointerExited = typeof globalThis !== 'undefined'
        && globalThis.__splunkIdePointerExited;

    try {
        const editor = doc.querySelector('.ace_editor')?.env?.editor;
        if (!editor) return;

        const mouseHandler = editor.$mouseHandler;
        const stuckDrag = mouseHandler && (mouseHandler.state || mouseHandler.$mousedownEvent);

        if (pointerExited || stuckDrag) {
            deselectAceOnPointerExit(doc);
        }
    } catch (err) {
        // ignore
    }
}

module.exports = {
    deselectAceOnPointerExit,
    endAceSelectionDrag,
    resetAceMouseHandler,
    clearAceEditorSelection,
};
