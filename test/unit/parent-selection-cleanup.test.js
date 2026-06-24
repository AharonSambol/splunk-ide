const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
    GUEST_CLEAR_SELECTION_JS,
    GUEST_RECOVER_JS,
    attachParentSelectionCleanup,
} = require('../../lib/parent-selection-cleanup');

describe('attachParentSelectionCleanup', () => {
    it('registers document mouse handlers', () => {
        const listeners = new Map();
        const doc = {
            addEventListener(type, handler, capture) {
                listeners.set(type, { handler, capture });
            },
            querySelector() {
                return null;
            },
        };

        attachParentSelectionCleanup(doc);

        for (const eventType of ['mouseup', 'pointerup', 'mousedown', 'pointerdown']) {
            assert.ok(listeners.has(eventType));
            assert.equal(listeners.get(eventType).capture, true);
        }
    });

    it('invokes gated guest recovery on document mouseup', async () => {
        const executed = [];
        const doc = {
            listeners: {},
            addEventListener(type, handler, capture) {
                this.listeners[type] = handler;
            },
            querySelector(selector) {
                if (selector === 'webview.active') {
                    return {
                        executeJavaScript(code) {
                            executed.push(code);
                            return Promise.resolve();
                        },
                    };
                }
                return null;
            },
        };

        attachParentSelectionCleanup(doc);
        await doc.listeners.mouseup();

        assert.deepEqual(executed, [GUEST_RECOVER_JS]);
        assert.match(executed[0], /__splunkIdeDragInProgress/);
        assert.match(executed[0], /__splunkIdeRecoverFromMissedDrag/);
    });

    it('clears guest selection on mousedown outside the active webview', async () => {
        const executed = [];
        const outside = { id: 'outside' };
        const doc = {
            listeners: {},
            addEventListener(type, handler, capture) {
                this.listeners[type] = handler;
            },
            querySelector(selector) {
                if (selector === 'webview.active') {
                    return {
                        executeJavaScript(code) {
                            executed.push(code);
                            return Promise.resolve();
                        },
                    };
                }
                return null;
            },
        };

        attachParentSelectionCleanup(doc);
        await doc.listeners.mousedown({ target: outside });

        assert.deepEqual(executed, [GUEST_CLEAR_SELECTION_JS]);
    });

    it('does not clear guest selection on mousedown inside the active webview', async () => {
        const executed = [];
        const webview = {
            executeJavaScript(code) {
                executed.push(code);
                return Promise.resolve();
            },
            closest() {
                return webview;
            },
        };

        const doc = {
            listeners: {},
            addEventListener(type, handler, capture) {
                this.listeners[type] = handler;
            },
            querySelector() {
                return webview;
            },
        };

        attachParentSelectionCleanup(doc);
        await doc.listeners.mousedown({ target: webview });

        assert.deepEqual(executed, []);
    });
});
