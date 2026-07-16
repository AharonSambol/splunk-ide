const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
    isSavedSearchSaveRequest,
    isSplunkSavedSearchEditorPage,
    isSplunkSearchRunnerPage,
    isSavedSearchPage,
    isSplunkSaveButton,
    shouldNotifyOnSave,
    notifyHostSplunkSave,
    attachSplunkSaveHooks,
    buildSplunkSaveInjectorSource,
    SPLUNK_SAVE_EVENT,
} = require('../../lib/webview-splunk-save-hooks');

describe('isSavedSearchSaveRequest', () => {
    it('matches saved-search POST and PUT writes', () => {
        const url = '/en-US/splunkd/__raw/servicesNS/nobody/search/saved/searches/error-rate';
        assert.equal(isSavedSearchSaveRequest(url, 'POST'), true);
        assert.equal(isSavedSearchSaveRequest(url, 'PUT'), true);
        assert.equal(isSavedSearchSaveRequest(url, 'GET'), false);
        assert.equal(isSavedSearchSaveRequest('/services/data/indexes', 'POST'), false);
    });

    it('matches encoded and newer Splunk API paths', () => {
        const encoded = '/servicesNS/nobody/search/saved%2Fsearches/error-rate';
        assert.equal(isSavedSearchSaveRequest(encoded, 'POST'), true);
        assert.equal(
            isSavedSearchSaveRequest('/api/search/v2/savedsearches/error-rate', 'PUT'),
            true
        );
    });
});

describe('isSplunkSavedSearchEditorPage', () => {
    it('matches saved-search editor URLs', () => {
        assert.equal(
            isSplunkSavedSearchEditorPage('https://splunk/app/search/saved/searches?action=edit'),
            true
        );
        assert.equal(
            isSplunkSearchRunnerPage('https://splunk/app/search/saved/searches?action=edit'),
            false
        );
    });
});

describe('isSplunkSearchRunnerPage', () => {
    it('matches search-bar saved-search URLs', () => {
        assert.equal(
            isSplunkSearchRunnerPage('https://splunk/en-US/app/search/search?earliest=0&s=%2FservicesNS%2Fnobody%2Fsearch%2Fsaved%2Fsearches%2Ferror-rate'),
            true
        );
        assert.equal(
            isSplunkSearchRunnerPage('file:///tmp/splunk-saved-search-mock.html?s=%5Bnobody%3Asearch%3AError%20Rate%5D'),
            true
        );
        assert.equal(isSplunkSearchRunnerPage('https://splunk/en-US/app/search/search'), false);
    });
});

describe('isSavedSearchPage', () => {
    it('matches editor or runner saved-search URLs', () => {
        assert.equal(
            isSavedSearchPage('https://splunk/app/search/saved/searches?action=edit'),
            true
        );
        assert.equal(
            isSavedSearchPage('https://splunk/en-US/app/search/search?earliest=0&s=%2FservicesNS%2Fnobody%2Fsearch%2Fsaved%2Fsearches%2Ferror-rate'),
            true
        );
    });
});

describe('isSplunkSaveButton', () => {
    function mockButton({ text = '', ariaLabel = '', title = '', className = '' } = {}) {
        const el = {
            getAttribute(name) {
                if (name === 'aria-label') {
                    return ariaLabel;
                }
                if (name === 'title') {
                    return title;
                }
                return null;
            },
            textContent: text,
            className,
        };
        return {
            closest() {
                return el;
            },
        };
    }

    it('matches save controls by label', () => {
        assert.equal(isSplunkSaveButton(mockButton({ text: 'Save' })), true);
        assert.equal(isSplunkSaveButton(mockButton({ ariaLabel: 'Save search' })), true);
        assert.equal(isSplunkSaveButton(mockButton({ title: 'Save' })), true);
        assert.equal(isSplunkSaveButton(mockButton({ className: 'save-search nav-btn' })), true);
        assert.equal(isSplunkSaveButton(mockButton({ text: 'Cancel' })), false);
        assert.equal(isSplunkSaveButton({ closest: () => null }), false);
    });
});

describe('notifyHostSplunkSave', () => {
    it('prefers the exposed preload bridge', () => {
        const calls = [];
        const win = {
            top: {
                __splunkIdeHost: {
                    splunkSave() {
                        calls.push('bridge');
                    },
                },
                document: {
                    dispatchEvent() {
                        calls.push('event');
                    },
                },
            },
        };
        assert.equal(notifyHostSplunkSave(win), true);
        assert.deepEqual(calls, ['bridge']);
    });
});

describe('shouldNotifyOnSave', () => {
    it('uses top window URL for iframe saves on search runner', () => {
        const runnerHref = 'https://splunk/en-US/app/search/search?s=%2FservicesNS%2Fnobody%2Fsearch%2Fsaved%2Fsearches%2Ferror-rate';
        const win = {
            location: { href: 'about:blank' },
            top: { location: { href: runnerHref } },
        };
        assert.equal(shouldNotifyOnSave(win), true);
    });
});

describe('attachSplunkSaveHooks', () => {
    it('notifies host after saved-search fetch succeeds', async () => {
        const sent = [];
        const win = {
            location: { href: 'file:///tmp/splunk-saved-search-mock.html?s=%5Bnobody%3Asearch%3AError%20Rate%5D' },
            setTimeout(fn, ms) {
                return setTimeout(fn, ms);
            },
            clearTimeout,
            addEventListener() {},
            document: { documentElement: {}, querySelectorAll: () => [] },
            MutationObserver: class {
                observe() {}
            },
            fetch() {
                return Promise.resolve({ ok: true });
            },
            XMLHttpRequest: {
                prototype: {
                    open() {},
                    send() {},
                    addEventListener() {},
                },
            },
        };
        win.XMLHttpRequest.prototype.open = function open() {};
        win.XMLHttpRequest.prototype.send = function send() {};

        attachSplunkSaveHooks(win, {
            onSave() {
                sent.push('splunk-save');
            },
            debounceMs: 10,
        });

        await win.fetch('/servicesNS/nobody/search/saved/searches/error-rate', { method: 'POST' });
        await new Promise((resolve) => setTimeout(resolve, 50));

        assert.deepEqual(sent, ['splunk-save']);
    });

    it('does not notify when saved-search fetch fails', async () => {
        const sent = [];
        const win = {
            location: { href: 'file:///tmp/splunk-saved-search-mock.html?s=%5Bnobody%3Asearch%3AError%20Rate%5D' },
            setTimeout(fn, ms) {
                return setTimeout(fn, ms);
            },
            clearTimeout,
            document: { documentElement: {}, querySelectorAll: () => [] },
            MutationObserver: class {
                observe() {}
            },
            fetch() {
                return Promise.resolve({ ok: false });
            },
            XMLHttpRequest: {
                prototype: { open() {}, send() {}, addEventListener() {} },
            },
        };
        win.XMLHttpRequest.prototype.open = function open() {};
        win.XMLHttpRequest.prototype.send = function send() {};

        attachSplunkSaveHooks(win, {
            onSave() {
                sent.push('splunk-save');
            },
            debounceMs: 10,
        });

        await win.fetch('/servicesNS/nobody/search/saved/searches/error-rate', { method: 'POST' });
        await new Promise((resolve) => setTimeout(resolve, 50));

        assert.deepEqual(sent, []);
    });

    it('does not notify on Save button click before REST completes', async () => {
        const sent = [];
        const saveBtn = {
            getAttribute() {
                return null;
            },
            textContent: 'Save',
            className: '',
            closest() {
                return this;
            },
        };
        const win = {
            location: { href: 'file:///tmp/splunk-saved-search-mock.html?s=%5Bnobody%3Asearch%3AError%20Rate%5D' },
            setTimeout(fn, ms) {
                return setTimeout(fn, ms);
            },
            clearTimeout,
            document: { documentElement: {}, querySelectorAll: () => [] },
            MutationObserver: class {
                observe() {}
            },
            fetch() {
                return new Promise(() => {});
            },
            XMLHttpRequest: {
                prototype: { open() {}, send() {}, addEventListener() {} },
            },
        };
        win.XMLHttpRequest.prototype.open = function open() {};
        win.XMLHttpRequest.prototype.send = function send() {};

        attachSplunkSaveHooks(win, {
            onSave() {
                sent.push('splunk-save');
            },
            debounceMs: 10,
        });

        assert.equal(isSplunkSaveButton(saveBtn), true);
        await new Promise((resolve) => setTimeout(resolve, 50));
        assert.deepEqual(sent, []);
    });
});

describe('buildSplunkSaveInjectorSource', () => {
    it('returns injectable guest-page hook source', () => {
        const source = buildSplunkSaveInjectorSource();
        assert.match(source, /__splunkIdeSaveHooks/);
        assert.match(source, /notifyHostSplunkSave/);
        assert.match(source, /__splunkIdeHost/);
        assert.match(source, /XMLHttpRequest\.prototype\.open/);
        assert.match(source, /splunk-ide-splunk-save/);
        assert.doesNotMatch(source, /SPLUNK_SAVE_EVENT/);
    });
});
