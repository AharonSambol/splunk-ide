'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const {
    shouldForwardKey,
    shouldInterceptShortcut,
    toKeyInfo,
    windowForContents,
    attachAppShortcuts
} = require('../lib/main/app-shortcuts');

function input(overrides = {}) {
    return {
        type: 'keyDown',
        key: 'n',
        code: 'KeyN',
        control: false,
        meta: false,
        alt: false,
        shift: false,
        isComposing: false,
        ...overrides
    };
}

describe('shouldForwardKey', () => {
    it('forwards modifiers, shift, and escape', () => {
        assert.equal(shouldForwardKey(input({ control: true })), true);
        assert.equal(shouldForwardKey(input({ key: 'Shift' })), true);
        assert.equal(shouldForwardKey(input({ key: 'Escape' })), true);
        assert.equal(shouldForwardKey(input({ key: 'a' })), false);
        assert.equal(shouldForwardKey(input({ type: 'keyUp', control: true })), false);
    });
});

describe('shouldInterceptShortcut', () => {
    it('intercepts app shortcuts only', () => {
        assert.equal(shouldInterceptShortcut(input({ control: true, key: 'n' })), true);
        assert.equal(shouldInterceptShortcut(input({ meta: true, key: 'f' })), true);
        assert.equal(shouldInterceptShortcut(input({ control: true, key: 'Tab' })), true);
        assert.equal(shouldInterceptShortcut(input({ control: true, shift: true, key: 'h' })), true);
        assert.equal(shouldInterceptShortcut(input({ alt: true, key: 'ArrowLeft' })), true);
        assert.equal(shouldInterceptShortcut(input({ control: true, key: 'c' })), false);
        assert.equal(shouldInterceptShortcut(input({ key: 'Shift' })), false);
        assert.equal(shouldInterceptShortcut(input({ key: 'Escape' })), false);
    });
});

describe('toKeyInfo', () => {
    it('maps electron input to renderer key info', () => {
        assert.deepEqual(toKeyInfo(input({ control: true, shift: true, key: 'F', code: 'KeyF' })), {
            key: 'F',
            code: 'KeyF',
            ctrl: true,
            meta: false,
            alt: false,
            shift: true
        });
    });
});

describe('windowForContents', () => {
    it('climbs from webview contents to the owner window', () => {
        const owner = { isDestroyed: () => false };
        const renderer = { hostWebContents: null };
        const webview = { hostWebContents: renderer, getOwnerBrowserWindow: () => null };
        const BrowserWindow = {
            fromWebContents(contents) {
                return contents === renderer ? owner : null;
            },
            getFocusedWindow() { return null; },
            getAllWindows() { return []; }
        };
        assert.equal(windowForContents(webview, BrowserWindow), owner);
    });
});

describe('attachAppShortcuts', () => {
    it('sends app-keydown from any webContents and intercepts shortcuts', () => {
        const app = new EventEmitter();
        const sent = [];
        const preventCalls = [];
        const owner = {
            isDestroyed: () => false,
            webContents: {
                isDestroyed: () => false,
                send(channel, payload) { sent.push({ channel, payload }); }
            }
        };
        const BrowserWindow = {
            fromWebContents: () => owner,
            getFocusedWindow: () => owner,
            getAllWindows: () => [owner]
        };
        attachAppShortcuts({ app, BrowserWindow });

        const webview = new EventEmitter();
        webview.getType = () => 'webview';
        webview.getOwnerBrowserWindow = () => null;
        webview.hostWebContents = null;
        app.emit('web-contents-created', {}, webview);

        const event = { preventDefault: () => preventCalls.push(true) };
        webview.emit('before-input-event', event, input({ meta: true, key: 'n' }));
        webview.emit('before-input-event', event, input({ key: 'Shift' }));
        webview.emit('before-input-event', event, input({ key: 'a' }));

        assert.equal(preventCalls.length, 1);
        assert.deepEqual(sent.map(item => item.channel), ['app-keydown', 'app-keydown']);
        assert.equal(sent[0].payload.meta, true);
        assert.equal(sent[1].payload.key, 'Shift');
    });
});
