const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
    deselectAceOnPointerExit,
    endAceSelectionDrag,
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

describe('deselectAceOnPointerExit', () => {
    it('always clears stuck mouse handler state and Ace selection', () => {
        const mock = createMockEditor();
        deselectAceOnPointerExit(createMockDocument(mock));

        assert.equal(mock.editor.$mouseHandler.state, '');
        assert.equal(mock.editor.$mouseHandler.$mousedownEvent, null);
        assert.equal(mock.editor.$mouseHandler.onMouseUpCalls, 1);
        assert.equal(mock.editor.cleared, true);
        assert.equal(mock.editor.selection.end.column, 5);
    });

    it('clears selection even when mouse handler is already idle', () => {
        const mock = createMockEditor({
            mouseHandler: { state: '', $mousedownEvent: null },
        });
        deselectAceOnPointerExit(createMockDocument(mock));

        assert.equal(mock.editor.cleared, true);
        assert.equal(mock.editor.selection.start.column, 5);
    });

    it('clears native DOM selection', () => {
        const mock = createMockEditor({
            mouseHandler: { state: '', $mousedownEvent: null },
        });
        const doc = createMockDocument(mock);
        deselectAceOnPointerExit(doc);

        assert.equal(doc.getSelection().removeAllRangesCalls, 1);
    });
});

describe('endAceSelectionDrag', () => {
    it('clears stuck mouse handler state and selection when active', () => {
        const mock = createMockEditor();
        endAceSelectionDrag(createMockDocument(mock));

        assert.equal(mock.editor.$mouseHandler.state, '');
        assert.equal(mock.editor.$mouseHandler.$mousedownEvent, null);
        assert.equal(mock.editor.$mouseHandler.onMouseUpCalls, 1);
        assert.equal(mock.editor.cleared, true);
        assert.equal(mock.editor.selection.end.column, 5);
    });

    it('does nothing when mouse handler state is idle and pointer has not exited', () => {
        const previousFlag = globalThis.__splunkIdePointerExited;
        globalThis.__splunkIdePointerExited = false;

        const mock = createMockEditor({
            mouseHandler: { state: '', $mousedownEvent: null },
        });
        endAceSelectionDrag(createMockDocument(mock));

        assert.equal(mock.editor.$mouseHandler.onMouseUpCalls, 0);
        assert.equal(mock.editor.cleared, false);

        globalThis.__splunkIdePointerExited = previousFlag;
    });

    it('deselects on keydown after pointer left the page', () => {
        const previousFlag = globalThis.__splunkIdePointerExited;
        globalThis.__splunkIdePointerExited = true;

        const mock = createMockEditor({
            mouseHandler: { state: '', $mousedownEvent: null },
        });
        endAceSelectionDrag(createMockDocument(mock));

        assert.equal(mock.editor.cleared, true);

        globalThis.__splunkIdePointerExited = previousFlag;
    });

    it('does nothing when no ace editor is present', () => {
        const doc = { querySelector: () => null };
        assert.doesNotThrow(() => endAceSelectionDrag(doc));
    });

    it('does nothing when editor has no mouse handler', () => {
        const mock = createMockEditor({
            editor: { $mouseHandler: null },
        });
        assert.doesNotThrow(() => endAceSelectionDrag(createMockDocument(mock)));
    });

    it('clears orphaned mousedown state when drag state is already idle', () => {
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
        assert.equal(mock.editor.cleared, true);
    });

    it('still clears handler state when onMouseUp throws', () => {
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
        assert.equal(mock.editor.cleared, true);
    });
});
