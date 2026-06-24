const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { findInPage, stopFindInPage } = require('../lib/main/find-in-page');

function makeWebContents(targets = new Map()) {
    return {
        fromId(id) {
            return targets.get(id) || null;
        },
        targets
    };
}

describe('findInPage', () => {
    it('uses valid webContentsId', () => {
        const calls = [];
        const webContents = makeWebContents(new Map([
            [10, { findInPage: (...args) => calls.push(args) }]
        ]));

        const result = findInPage({
            webContents,
            senderId: 99,
            args: { webContentsId: 10, text: 'needle', options: { forward: true } }
        });

        assert.deepEqual(result, { ok: true });
        assert.deepEqual(calls, [['needle', { forward: true }]]);
    });

    it('falls back to senderId when webContentsId is missing', () => {
        const calls = [];
        const webContents = makeWebContents(new Map([
            [5, { findInPage: (...args) => calls.push(args) }]
        ]));

        const result = findInPage({
            webContents,
            senderId: 5,
            args: { text: 'foo' }
        });

        assert.deepEqual(result, { ok: true });
        assert.deepEqual(calls, [['foo', {}]]);
    });

    it('returns ok false when target is missing', () => {
        const webContents = makeWebContents();

        const result = findInPage({
            webContents,
            senderId: 1,
            args: { text: 'missing' }
        });

        assert.deepEqual(result, { ok: false });
    });

    it('treats empty text as an empty string', () => {
        const calls = [];
        const webContents = makeWebContents(new Map([
            [3, { findInPage: (...args) => calls.push(args) }]
        ]));

        const result = findInPage({
            webContents,
            senderId: 3,
            args: {}
        });

        assert.deepEqual(result, { ok: true });
        assert.deepEqual(calls, [['', {}]]);
    });

    it('returns ok false when findInPage throws', () => {
        const webContents = makeWebContents(new Map([
            [2, {
                findInPage() {
                    throw new Error('boom');
                }
            }]
        ]));

        const result = findInPage({
            webContents,
            senderId: 2,
            args: { text: 'err' }
        });

        assert.deepEqual(result, { ok: false });
    });
});

describe('stopFindInPage', () => {
    it('uses valid webContentsId', () => {
        const calls = [];
        const webContents = makeWebContents(new Map([
            [11, { stopFindInPage: (action) => calls.push(action) }]
        ]));

        const result = stopFindInPage({
            webContents,
            senderId: 99,
            args: { webContentsId: 11, action: 'keepSelection' }
        });

        assert.deepEqual(result, { ok: true });
        assert.deepEqual(calls, ['keepSelection']);
    });

    it('falls back to senderId when webContentsId is missing', () => {
        const calls = [];
        const webContents = makeWebContents(new Map([
            [6, { stopFindInPage: (action) => calls.push(action) }]
        ]));

        const result = stopFindInPage({
            webContents,
            senderId: 6,
            args: {}
        });

        assert.deepEqual(result, { ok: true });
        assert.deepEqual(calls, ['clearSelection']);
    });

    it('returns ok false when target is missing', () => {
        const webContents = makeWebContents();

        const result = stopFindInPage({
            webContents,
            senderId: 1,
            args: {}
        });

        assert.deepEqual(result, { ok: false });
    });

    it('defaults stop action to clearSelection', () => {
        const calls = [];
        const webContents = makeWebContents(new Map([
            [4, { stopFindInPage: (action) => calls.push(action) }]
        ]));

        const result = stopFindInPage({
            webContents,
            senderId: 4,
            args: { webContentsId: 4 }
        });

        assert.deepEqual(result, { ok: true });
        assert.deepEqual(calls, ['clearSelection']);
    });

    it('returns ok false when stopFindInPage throws', () => {
        const webContents = makeWebContents(new Map([
            [8, {
                stopFindInPage() {
                    throw new Error('boom');
                }
            }]
        ]));

        const result = stopFindInPage({
            webContents,
            senderId: 8,
            args: {}
        });

        assert.deepEqual(result, { ok: false });
    });
});
