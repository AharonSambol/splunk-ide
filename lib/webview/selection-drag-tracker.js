const DRAG_THRESHOLD_PX = 3;

/**
 * Wire pointer listeners that distinguish click from drag.
 * Only resets Ace drag state after an actual drag; clicks are left to Ace.
 *
 * @param {Document|ParentNode} doc
 * @param {{ resetDragState: (root?: Document|ParentNode) => void, recoverFromMissedDrag: (root?: Document|ParentNode) => void }} handlers
 */
function attachSelectionDragTracker(doc, { resetDragState, recoverFromMissedDrag }) {
    let pointerDown = null;
    let dragInProgress = false;

    function setDragInProgress(value) {
        dragInProgress = value;
        if (typeof globalThis !== 'undefined') {
            globalThis.__splunkIdeDragInProgress = value;
        }
    }

    function onPointerDown(event) {
        pointerDown = { x: event.clientX, y: event.clientY };
        setDragInProgress(false);
    }

    function onPointerMove(event) {
        if (!pointerDown || dragInProgress) return;
        const dx = event.clientX - pointerDown.x;
        const dy = event.clientY - pointerDown.y;
        if ((dx * dx) + (dy * dy) >= DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX) {
            setDragInProgress(true);
        }
    }

    function onPointerUp() {
        if (dragInProgress) {
            resetDragState(doc);
        }
        pointerDown = null;
        setDragInProgress(false);
        if (typeof globalThis !== 'undefined') {
            globalThis.__splunkIdePointerExited = false;
        }
    }

    function markPointerExited() {
        if (typeof globalThis !== 'undefined') {
            globalThis.__splunkIdePointerExited = true;
        }
        if (dragInProgress) {
            recoverFromMissedDrag(doc);
            setDragInProgress(false);
        }
    }

    function markPointerEntered() {
        if (typeof globalThis !== 'undefined') {
            globalThis.__splunkIdePointerExited = false;
        }
    }

    for (const eventType of ['mousedown', 'pointerdown']) {
        doc.addEventListener(eventType, onPointerDown, true);
    }
    for (const eventType of ['mousemove', 'pointermove']) {
        doc.addEventListener(eventType, onPointerMove, true);
    }
    for (const eventType of ['mouseup', 'pointerup']) {
        doc.addEventListener(eventType, onPointerUp, true);
    }

    doc.addEventListener('mouseleave', markPointerExited, true);
    doc.addEventListener('pointerleave', markPointerExited, true);
    doc.addEventListener('mouseenter', markPointerEntered, true);
    doc.addEventListener('pointerenter', markPointerEntered, true);

    doc.addEventListener('keydown', () => {
        try {
            const pointerExited = typeof globalThis !== 'undefined'
                && globalThis.__splunkIdePointerExited;
            if (pointerExited && dragInProgress) {
                recoverFromMissedDrag(doc);
            }
            setDragInProgress(false);
        } catch (err) {
            // ignore
        }
    }, true);
}

module.exports = {
    DRAG_THRESHOLD_PX,
    attachSelectionDragTracker,
};
