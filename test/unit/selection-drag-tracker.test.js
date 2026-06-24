const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { attachSelectionDragTracker } = require('../../lib/selection-drag-tracker');

function createMockDoc() {
    const listeners = new Map();

    return {
        listeners,
        addEventListener(type, handler, capture) {
            listeners.set(type, { handler, capture });
        },
        resetCalls: 0,
        recoverCalls: 0,
    };
}

describe('attachSelectionDragTracker', () => {
    it('does not reset drag state on click without movement', () => {
        const doc = createMockDoc();
        attachSelectionDragTracker(doc, {
            resetDragState: () => { doc.resetCalls += 1; },
            recoverFromMissedDrag: () => { doc.recoverCalls += 1; },
        });

        doc.listeners.get('mousedown').handler({ clientX: 10, clientY: 10 });
        doc.listeners.get('mouseup').handler();

        assert.equal(doc.resetCalls, 0);
        assert.equal(globalThis.__splunkIdeDragInProgress, false);
    });

    it('resets drag state after pointer movement exceeds threshold', () => {
        const doc = createMockDoc();
        attachSelectionDragTracker(doc, {
            resetDragState: () => { doc.resetCalls += 1; },
            recoverFromMissedDrag: () => { doc.recoverCalls += 1; },
        });

        doc.listeners.get('mousedown').handler({ clientX: 10, clientY: 10 });
        doc.listeners.get('mousemove').handler({ clientX: 20, clientY: 10 });
        assert.equal(globalThis.__splunkIdeDragInProgress, true);
        doc.listeners.get('mouseup').handler();

        assert.equal(doc.resetCalls, 1);
        assert.equal(globalThis.__splunkIdeDragInProgress, false);
    });

    it('recovers only when pointer leaves during drag', () => {
        const doc = createMockDoc();
        attachSelectionDragTracker(doc, {
            resetDragState: () => { doc.resetCalls += 1; },
            recoverFromMissedDrag: () => { doc.recoverCalls += 1; },
        });

        doc.listeners.get('mouseleave').handler();
        assert.equal(doc.recoverCalls, 0);

        doc.listeners.get('mousedown').handler({ clientX: 0, clientY: 0 });
        doc.listeners.get('mousemove').handler({ clientX: 10, clientY: 0 });
        doc.listeners.get('mouseleave').handler();

        assert.equal(doc.recoverCalls, 1);
    });
});
