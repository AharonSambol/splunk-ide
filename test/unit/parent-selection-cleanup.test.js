const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
    GUEST_DESELECT_JS,
    attachParentSelectionCleanup,
} = require('../../lib/parent-selection-cleanup');

describe('attachParentSelectionCleanup', () => {
    it('registers document mouseup and pointerup handlers', () => {
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

        for (const eventType of ['mouseup', 'pointerup']) {
            assert.ok(listeners.has(eventType));
            assert.equal(listeners.get(eventType).capture, true);
        }
    });

    it('cleans up the active webview on document mouseup', async () => {
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

        assert.deepEqual(executed, [GUEST_DESELECT_JS]);
    });
});
