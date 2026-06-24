const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
    clearAceSelection,
    deselectAceOnPointerExit,
    endAceSelectionDrag,
    recoverFromMissedDrag,
    resetDragState,
} = require('../../lib/end-ace-selection-drag');

function createMockEditor(overrides = {}) {
    const selection = {
        start: { row: 0, column: 0 },
        end: { row: 0, column: 5 },
        moveCursorTo(row, column) {
            this.start = { row, column };
            this.end = { row, column };
        },
    };

    const mouseHandler = {
        state: 'select',
        $mousedownEvent: { button: 0 },
        onMouseUpCalls: 0,
        onMouseUp() {
            this.onMouseUpCalls += 1;
            this.state = '';
            this.$mousedownEvent = null;
        },
        ...overrides.mouseHandler,
    };

    const editor = {
        selection,
        $mouseHandler: mouseHandler,
        cleared: false,
        getSelectionRange() {
            return {
                start: selection.start,
                end: selection.end,
                isEmpty() {
                    return selection.start.column === selection.end.column
                        && selection.start.row === selection.end.row;
                },
            };
        },
        clearSelection() {
            this.cleared = true;
            selection.moveCursorTo(selection.end.row, selection.end.column);
        },
        ...overrides.editor,
    };

    return {
        editor,
        aceElement: { env: { editor } },
    };
}

function createMockDocument(editorBundle, selectionOverrides = {}) {
    const nativeSelection = {
        rangeCount: 1,
        isCollapsed: false,
        removeAllRangesCalls: 0,
        removeAllRanges() {
            this.removeAllRangesCalls += 1;
            this.isCollapsed = true;
        },
        ...selectionOverrides,
    };

    return {
        querySelector(selector) {
            if (selector === '.ace_editor') {
                return editorBundle.aceElement;
            }
            return null;
        },
        getSelection() {
            return nativeSelection;
        },
    };
}

function withFlags(flags, fn) {
    const previous = {
        pointerExited: globalThis.__splunkIdePointerExited,
        dragInProgress: globalThis.__splunkIdeDragInProgress,
    };

    if ('pointerExited' in flags) {
        globalThis.__splunkIdePointerExited = flags.pointerExited;
    }
    if ('dragInProgress' in flags) {
        globalThis.__splunkIdeDragInProgress = flags.dragInProgress;
    }

    try {
        fn();
    } finally {
        globalThis.__splunkIdePointerExited = previous.pointerExited;
        globalThis.__splunkIdeDragInProgress = previous.dragInProgress;
    }
}

describe('resetDragState', () => {
    it('resets stuck mouse handler without clearing selection', () => {
        const mock = createMockEditor();
        resetDragState(createMockDocument(mock));

        assert.equal(mock.editor.$mouseHandler.state, '');
        assert.equal(mock.editor.$mouseHandler.$mousedownEvent, null);
        assert.equal(mock.editor.$mouseHandler.onMouseUpCalls, 1);
        assert.equal(mock.editor.cleared, false);
    });

    it('does nothing when mouse handler is idle', () => {
        const mock = createMockEditor({
            mouseHandler: { state: '', $mousedownEvent: null },
        });
        resetDragState(createMockDocument(mock));

        assert.equal(mock.editor.$mouseHandler.onMouseUpCalls, 0);
        assert.equal(mock.editor.cleared, false);
    });
});

describe('clearAceSelection', () => {
    it('clears Ace selection and native DOM selection', () => {
        const mock = createMockEditor();
        const doc = createMockDocument(mock);
        clearAceSelection(doc);

        assert.equal(mock.editor.cleared, true);
        assert.equal(doc.getSelection().removeAllRangesCalls, 1);
    });
});

describe('recoverFromMissedDrag', () => {
    it('clears stuck mouse handler state and Ace selection', () => {
        const mock = createMockEditor();
        recoverFromMissedDrag(createMockDocument(mock));

        assert.equal(mock.editor.$mouseHandler.state, '');
        assert.equal(mock.editor.$mouseHandler.$mousedownEvent, null);
        assert.equal(mock.editor.$mouseHandler.onMouseUpCalls, 1);
        assert.equal(mock.editor.cleared, true);
        assert.equal(mock.editor.selection.end.column, 5);
    });

    it('clears native DOM selection', () => {
        const mock = createMockEditor({
            mouseHandler: { state: '', $mousedownEvent: null },
        });
        const doc = createMockDocument(mock);
        recoverFromMissedDrag(doc);

        assert.equal(doc.getSelection().removeAllRangesCalls, 1);
    });
});

describe('deselectAceOnPointerExit', () => {
    it('is an alias for recoverFromMissedDrag', () => {
        assert.equal(deselectAceOnPointerExit, recoverFromMissedDrag);
    });
});

describe('endAceSelectionDrag', () => {
    it('resets handler on normal mouseup without clearing selection', () => {
        withFlags({ pointerExited: false, dragInProgress: false }, () => {
            const mock = createMockEditor();
            endAceSelectionDrag(createMockDocument(mock));

            assert.equal(mock.editor.$mouseHandler.state, '');
            assert.equal(mock.editor.$mouseHandler.onMouseUpCalls, 1);
            assert.equal(mock.editor.cleared, false);
        });
    });

    it('does nothing when mouse handler state is idle and pointer has not exited', () => {
        withFlags({ pointerExited: false, dragInProgress: false }, () => {
            const mock = createMockEditor({
                mouseHandler: { state: '', $mousedownEvent: null },
            });
            endAceSelectionDrag(createMockDocument(mock));

            assert.equal(mock.editor.$mouseHandler.onMouseUpCalls, 0);
            assert.equal(mock.editor.cleared, false);
        });
    });

    it('recovers when pointer left during an active drag', () => {
        withFlags({ pointerExited: true, dragInProgress: true }, () => {
            const mock = createMockEditor({
                mouseHandler: { state: '', $mousedownEvent: null },
            });
            endAceSelectionDrag(createMockDocument(mock));

            assert.equal(mock.editor.cleared, true);
        });
    });

    it('does not recover on pointer exit alone without drag in progress', () => {
        withFlags({ pointerExited: true, dragInProgress: false }, () => {
            const mock = createMockEditor({
                mouseHandler: { state: '', $mousedownEvent: null },
            });
            endAceSelectionDrag(createMockDocument(mock));

            assert.equal(mock.editor.cleared, false);
        });
    });

    it('does nothing when no ace editor is present', () => {
        const doc = { querySelector: () => null };
        assert.doesNotThrow(() => endAceSelectionDrag(doc));
    });

    it('resets orphaned mousedown state without clearing selection', () => {
        withFlags({ pointerExited: false, dragInProgress: false }, () => {
            const mock = createMockEditor({
                mouseHandler: {
                    state: '',
                    $mousedownEvent: { button: 0 },
                    onMouseUpCalls: 0,
                    onMouseUp() {
                        this.onMouseUpCalls += 1;
                        this.$mousedownEvent = null;
                    },
                },
            });
            endAceSelectionDrag(createMockDocument(mock));

            assert.equal(mock.editor.$mouseHandler.$mousedownEvent, null);
            assert.equal(mock.editor.$mouseHandler.onMouseUpCalls, 1);
            assert.equal(mock.editor.cleared, false);
        });
    });

    it('still resets handler state when onMouseUp throws', () => {
        withFlags({ pointerExited: false, dragInProgress: false }, () => {
            const mock = createMockEditor({
                mouseHandler: {
                    state: 'select',
                    $mousedownEvent: { button: 0 },
                    onMouseUp() {
                        throw new Error('synthetic mouseup failed');
                    },
                },
            });
            endAceSelectionDrag(createMockDocument(mock));

            assert.equal(mock.editor.$mouseHandler.state, '');
            assert.equal(mock.editor.cleared, false);
        });
    });
});
