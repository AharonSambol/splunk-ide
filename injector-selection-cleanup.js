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

        function deselectAceOnPointerExit() {
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

        function endAceSelectionDrag() {
            const pointerExited = window.__splunkIdePointerExited === true;
            try {
                const editor = document.querySelector('.ace_editor')?.env?.editor;
                if (!editor) return;
                const mouseHandler = editor.$mouseHandler;
                const stuckDrag = mouseHandler && (mouseHandler.state || mouseHandler.$mousedownEvent);
                if (pointerExited || stuckDrag) {
                    deselectAceOnPointerExit();
                }
            } catch (err) {
                // ignore
            }
        }

        window.__splunkIdeDeselectAceOnPointerExit = deselectAceOnPointerExit;
        window.__splunkIdeEndSelectionDrag = endAceSelectionDrag;
        window.__splunkIdePointerExited = false;

        function markPointerExited() {
            window.__splunkIdePointerExited = true;
            deselectAceOnPointerExit();
        }

        function markPointerEntered() {
            window.__splunkIdePointerExited = false;
        }

        for (const eventType of ['mouseup', 'pointerup']) {
            document.addEventListener(eventType, () => {
                window.__splunkIdePointerExited = false;
                endAceSelectionDrag();
            }, true);
        }

        window.addEventListener('blur', markPointerExited, true);
        document.addEventListener('mouseleave', markPointerExited, true);
        document.addEventListener('pointerleave', markPointerExited, true);
        document.addEventListener('mouseenter', markPointerEntered, true);
        document.addEventListener('pointerenter', markPointerEntered, true);

        document.addEventListener('keydown', (e) => {
            try {
                endAceSelectionDrag();
            } catch (err) {
                // ignore
            }
        }, true);
    } catch (e) {
        console.error('Failed to inject selection cleanup:', e);
    }
})();
