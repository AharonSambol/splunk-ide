const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createContextMenuTemplate } = require('../lib/main/context-menu');

function findItem(template, label) {
    return template.find((item) => item.label === label);
}

function makeDeps(overrides = {}) {
    const sent = [];
    const clipboard = {
        text: '',
        readText() {
            return this.text;
        },
        writeText(value) {
            this.text = value;
        },
        ...overrides.clipboard
    };
    const webContents = {
        targets: new Map(),
        fromId(id) {
            return this.targets.get(id) || null;
        },
        ...overrides.webContents
    };
    const sender = {
        messages: sent,
        send(channel, payload) {
            sent.push({ channel, payload });
        },
        ...overrides.sender
    };

    return { clipboard, webContents, sender, sent };
}

describe('createContextMenuTemplate', () => {
    it('includes Copy when selection is present', () => {
        const { clipboard, webContents, sender } = makeDeps();
        const template = createContextMenuTemplate({
            info: { selection: 'hello' },
            clipboard,
            webContents,
            sender
        });

        assert.ok(findItem(template, 'Copy'));
    });

    it('omits Copy when selection is empty', () => {
        const { clipboard, webContents, sender } = makeDeps();
        const template = createContextMenuTemplate({
            info: { selection: '' },
            clipboard,
            webContents,
            sender
        });

        assert.equal(findItem(template, 'Copy'), undefined);
    });

    it('includes Paste when clipboard has text', () => {
        const { clipboard, webContents, sender } = makeDeps();
        clipboard.text = 'pasted';
        const template = createContextMenuTemplate({
            info: {},
            clipboard,
            webContents,
            sender
        });

        assert.ok(findItem(template, 'Paste'));
    });

    it('omits Paste when clipboard is empty', () => {
        const { clipboard, webContents, sender } = makeDeps();
        const template = createContextMenuTemplate({
            info: {},
            clipboard,
            webContents,
            sender
        });

        assert.equal(findItem(template, 'Paste'), undefined);
    });

    it('Paste uses webContents.paste when available', () => {
        const { clipboard, webContents, sender } = makeDeps();
        clipboard.text = 'pasted';
        const pasteCalls = [];
        webContents.targets.set(42, { paste: () => pasteCalls.push('paste') });

        const template = createContextMenuTemplate({
            info: { webContentsId: 42 },
            clipboard,
            webContents,
            sender
        });

        findItem(template, 'Paste').click();
        assert.deepEqual(pasteCalls, ['paste']);
        assert.equal(sender.messages.length, 0);
    });

    it('Paste falls back to sender.send when webContents is unavailable', () => {
        const { clipboard, webContents, sender } = makeDeps();
        clipboard.text = 'pasted';

        const template = createContextMenuTemplate({
            info: {},
            clipboard,
            webContents,
            sender
        });

        findItem(template, 'Paste').click();
        assert.deepEqual(sender.messages, [{
            channel: 'context-menu-command',
            payload: { command: 'paste', text: 'pasted' }
        }]);
    });

    it('Select All uses webContents.selectAll when available', () => {
        const { clipboard, webContents, sender } = makeDeps();
        const selectAllCalls = [];
        webContents.targets.set(7, { selectAll: () => selectAllCalls.push('selectAll') });

        const template = createContextMenuTemplate({
            info: { webContentsId: 7 },
            clipboard,
            webContents,
            sender
        });

        findItem(template, 'Select All').click();
        assert.deepEqual(selectAllCalls, ['selectAll']);
        assert.equal(sender.messages.length, 0);
    });

    it('Select All falls back to renderer command', () => {
        const { clipboard, webContents, sender } = makeDeps();

        const template = createContextMenuTemplate({
            info: {},
            clipboard,
            webContents,
            sender
        });

        findItem(template, 'Select All').click();
        assert.deepEqual(sender.messages, [{
            channel: 'context-menu-command',
            payload: { command: 'selectAll' }
        }]);
    });

    it('Copy writes selection to clipboard', () => {
        const { clipboard, webContents, sender } = makeDeps();

        const template = createContextMenuTemplate({
            info: { selection: 'copied text' },
            clipboard,
            webContents,
            sender
        });

        findItem(template, 'Copy').click();
        assert.equal(clipboard.text, 'copied text');
    });
});
