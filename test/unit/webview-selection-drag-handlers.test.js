const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
    DESELECT_ON_POINTER_EXIT_JS,
    attachWebviewSelectionDragHandlers,
} = require('../../lib/webview-selection-drag-handlers');

describe('attachWebviewSelectionDragHandlers', () => {
    it('registers mouseleave, mouseout, pointerleave, and blur handlers', () => {
        const listeners = new Map();
        const view = {
            addEventListener(type, handler) {
                listeners.set(type, handler);
            },
            executeJavaScript: async () => {},
        };

        attachWebviewSelectionDragHandlers(view);

        for (const eventType of ['mouseleave', 'mouseout', 'pointerleave', 'blur']) {
            assert.ok(listeners.has(eventType), `missing ${eventType} listener`);
        }
    });

    it('executes pointer-exit deselect in the guest on handler invocation', async () => {
        const executed = [];
        const view = {
            listeners: {},
            addEventListener(type, handler) {
                this.listeners[type] = handler;
            },
            executeJavaScript(code) {
                executed.push(code);
                return Promise.resolve();
            },
        };

        attachWebviewSelectionDragHandlers(view);
        await view.listeners.mouseleave();

        assert.deepEqual(executed, [DESELECT_ON_POINTER_EXIT_JS]);
        assert.match(executed[0], /__splunkIdePointerExited = true/);
        assert.match(executed[0], /__splunkIdeDeselectAceOnPointerExit/);
    });

    it('returns the cleanup handler for manual invocation', () => {
        const view = {
            addEventListener() {},
            executeJavaScript: async () => {},
        };

        const cleanup = attachWebviewSelectionDragHandlers(view);
        assert.equal(typeof cleanup, 'function');
    });

    it('swallows executeJavaScript failures', async () => {
        const view = {
            listeners: {},
            addEventListener(type, handler) {
                this.listeners[type] = handler;
            },
            executeJavaScript() {
                return Promise.reject(new Error('guest unavailable'));
            },
        };

        attachWebviewSelectionDragHandlers(view);
        await assert.doesNotReject(async () => view.listeners.blur());
    });
});
