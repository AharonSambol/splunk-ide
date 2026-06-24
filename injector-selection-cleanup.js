(function () {
    try {
        function resetAceMouseHandler(mouseHandler) {
            if (!mouseHandler) return;
            try {
                mouseHandler.onMouseUp?.({
                    domEvent: { button: 0, buttons: 0, which: 1, type: 'mouseup' },
                });
            } catch (err) {
                // ignore
            }
            mouseHandler.state = '';
            mouseHandler.$mousedownEvent = null;
        }

        function clearAceEditorSelection(editor) {
            const range = editor.getSelectionRange?.();
            if (range && !range.isEmpty()) {
                editor.selection.moveCursorTo(range.end.row, range.end.column);
                editor.clearSelection?.();
            }
        }

        function clearNativeSelection() {
            const selection = document.getSelection?.();
            if (selection && selection.rangeCount > 0 && !selection.isCollapsed) {
                selection.removeAllRanges();
            }
        }

        function clearInputSelection() {
            const active = document.activeElement;
            if (!active) return;
            if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
                const end = active.selectionEnd ?? active.value.length;
                active.setSelectionRange(end, end);
            }
        }

        function resetDragState() {
            try {
                const editor = document.querySelector('.ace_editor')?.env?.editor;
                if (editor) {
                    resetAceMouseHandler(editor.$mouseHandler);
                }
            } catch (err) {
                // ignore
            }
        }

        function recoverFromMissedDrag() {
            try {
                const editor = document.querySelector('.ace_editor')?.env?.editor;
                if (editor) {
                    resetAceMouseHandler(editor.$mouseHandler);
                    clearAceEditorSelection(editor);
                }
                clearInputSelection();
                clearNativeSelection();
            } catch (err) {
                // ignore
            }
        }

        window.__splunkIdeRecoverFromMissedDrag = recoverFromMissedDrag;
        window.__splunkIdeDeselectAceOnPointerExit = recoverFromMissedDrag;
        window.__splunkIdePointerExited = false;
        window.__splunkIdeDragInProgress = false;

        for (const eventType of ['mousedown', 'pointerdown']) {
            document.addEventListener(eventType, () => {
                window.__splunkIdeDragInProgress = true;
            }, true);
        }

        for (const eventType of ['mouseup', 'pointerup']) {
            document.addEventListener(eventType, () => {
                resetDragState();
                window.__splunkIdeDragInProgress = false;
                window.__splunkIdePointerExited = false;
            }, true);
        }

        function markPointerExited() {
            window.__splunkIdePointerExited = true;
            if (window.__splunkIdeDragInProgress) {
                recoverFromMissedDrag();
                window.__splunkIdeDragInProgress = false;
            }
        }

        function markPointerEntered() {
            window.__splunkIdePointerExited = false;
        }

        document.addEventListener('mouseleave', markPointerExited, true);
        document.addEventListener('pointerleave', markPointerExited, true);
        document.addEventListener('mouseenter', markPointerEntered, true);
        document.addEventListener('pointerenter', markPointerEntered, true);

        document.addEventListener('keydown', () => {
            try {
                if (window.__splunkIdePointerExited && window.__splunkIdeDragInProgress) {
                    recoverFromMissedDrag();
                }
                window.__splunkIdeDragInProgress = false;
            } catch (err) {
                // ignore
            }
        }, true);
    } catch (e) {
        console.error('Failed to inject selection cleanup:', e);
    }
})();
