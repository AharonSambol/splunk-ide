const SPLUNK_SAVE_EVENT = 'splunk-ide-splunk-save';

function normalizeSavedSearchUrl(url) {
    try {
        return decodeURIComponent(String(url || ''));
    } catch {
        return String(url || '');
    }
}

function isSavedSearchSaveRequest(url, method) {
    const normalizedMethod = String(method || 'GET').toUpperCase();
    if (normalizedMethod !== 'POST' && normalizedMethod !== 'PUT') {
        return false;
    }
    const normalizedUrl = normalizeSavedSearchUrl(url);
    return /\/saved(?:\/|%2F)searches(?:\/|$|%2F)/i.test(normalizedUrl)
        || /\/savedsearches(?:\/|$)/i.test(normalizedUrl)
        || /\/api\/search\/v\d+\/savedsearches(?:\/|$)/i.test(normalizedUrl);
}

function pagePath(href = '') {
    try {
        return new URL(String(href || '')).pathname;
    } catch {
        return String(href || '').split('?')[0];
    }
}

function isSplunkSavedSearchEditorPage(href = '') {
    return /\/saved(?:\/|%2F)searches/i.test(pagePath(href));
}

/** Search bar / job view where Splunk's top-right Save updates the saved search. */
function isSplunkSearchRunnerPage(href = '') {
    const location = String(href || '');
    if (isSplunkSavedSearchEditorPage(href)) {
        return false;
    }
    if (/splunk-saved-search-mock/i.test(location)) {
        return true;
    }
    if (!/\/search\/search/i.test(pagePath(href))) {
        return false;
    }
    return /s=%2FservicesNS%2F/i.test(location)
        || /\[nobody:/i.test(location)
        || /servicesNS%2F[^&]*saved/i.test(location);
}

function isSavedSearchPage(href = '') {
    return isSplunkSavedSearchEditorPage(href) || isSplunkSearchRunnerPage(href);
}

function isSplunkSaveButton(target) {
    const el = target?.closest?.(
        'button, a, [role="button"], input[type="submit"], .save-search, [class*="save-search"]'
    );
    if (!el) {
        return false;
    }
    const label = [
        el.getAttribute('aria-label'),
        el.getAttribute('title'),
        el.getAttribute('value'),
        el.textContent,
        el.className
    ].filter(Boolean).join(' ').trim().toLowerCase();
    return /\bsave\b/.test(label) && !/\bsave as\b/.test(label);
}

function notifyHostSplunkSave(win) {
    const top = win?.top || win;
    try {
        if (top?.__splunkIdeHost?.splunkSave) {
            top.__splunkIdeHost.splunkSave();
            return true;
        }
    } catch {
        // cross-origin frame
    }
    try {
        top?.document?.dispatchEvent(new CustomEvent('splunk-ide-splunk-save'));
        return true;
    } catch {
        return false;
    }
}

function attachSaveShortcut(win, onSave) {
    if (!win || win.__splunkIdeSaveShortcut) {
        return;
    }
    win.__splunkIdeSaveShortcut = true;
    win.addEventListener('keydown', (event) => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
            if (onSave) {
                onSave();
            } else {
                notifyHostSplunkSave(win);
            }
        }
    }, true);

    const attachChildFrames = () => {
        try {
            for (const iframe of win.document.querySelectorAll('iframe')) {
                try {
                    attachSaveShortcut(iframe.contentWindow);
                } catch {
                    // cross-origin iframe
                }
            }
        } catch {
            // ignore
        }
    };

    attachChildFrames();
    try {
        const observer = new win.MutationObserver(attachChildFrames);
        observer.observe(win.document.documentElement, { childList: true, subtree: true });
    } catch {
        // ignore
    }
}

/**
 * Patch guest-page network + Save UI. Runs in page context (via executeJavaScript).
 *
 * @param {Window} win
 * @param {{ onSave?: () => void, debounceMs?: number }} [options]
 */
function attachSplunkSaveHooks(win, { onSave, debounceMs = 600 } = {}) {
    if (!onSave) {
        return;
    }
    let timer = null;
    const notifySplunkSave = () => {
        clearTimeout(timer);
        timer = win.setTimeout(() => {
            timer = null;
            try {
                onSave();
            } catch {
                // ignore
            }
        }, debounceMs);
    };

    attachSaveShortcut(win, () => notifyHostSplunkSave(win));

    const origFetch = win.fetch;
    if (typeof origFetch === 'function') {
        win.fetch = function patchedFetch(input, init) {
            const result = origFetch.apply(this, arguments);
            try {
                const url = typeof input === 'string' ? input : input?.url || '';
                const method = init?.method || 'GET';
                if (isSplunkSearchRunnerPage(win.location.href)
                    && isSavedSearchSaveRequest(url, method)) {
                    result.then((res) => {
                        if (res.ok) {
                            notifySplunkSave();
                        }
                    }).catch(() => {});
                }
            } catch {
                // ignore
            }
            return result;
        };
    }

    const origOpen = win.XMLHttpRequest.prototype.open;
    const origSend = win.XMLHttpRequest.prototype.send;
    win.XMLHttpRequest.prototype.open = function open(method, url, ...rest) {
        this.__splunkIdeMethod = method;
        this.__splunkIdeUrl = url;
        return origOpen.call(this, method, url, ...rest);
    };
    win.XMLHttpRequest.prototype.send = function send(...args) {
        this.addEventListener('load', () => {
            try {
                if (this.status >= 200 && this.status < 300
                    && isSplunkSearchRunnerPage(win.location.href)
                    && isSavedSearchSaveRequest(this.__splunkIdeUrl, this.__splunkIdeMethod)) {
                    notifySplunkSave();
                }
            } catch {
                // ignore
            }
        });
        return origSend.apply(this, args);
    };

    win.addEventListener('click', (event) => {
        try {
            if (!isSplunkSearchRunnerPage(win.location.href)) {
                return;
            }
            if (!isSplunkSaveButton(event.target)) {
                return;
            }
            notifySplunkSave();
        } catch {
            // ignore
        }
    }, true);
}

function buildSplunkSaveInjectorSource() {
    const helpers = [
        normalizeSavedSearchUrl,
        pagePath,
        isSplunkSavedSearchEditorPage,
        isSplunkSearchRunnerPage,
        isSavedSearchSaveRequest,
        isSplunkSaveButton,
        notifyHostSplunkSave,
        attachSaveShortcut,
        attachSplunkSaveHooks
    ].map((fn) => fn.toString()).join('\n');
    return `(function() {
    if (window.__splunkIdeSaveHooks) {
        attachSaveShortcut(window, () => notifyHostSplunkSave(window));
        return;
    }
    window.__splunkIdeSaveHooks = true;
    ${helpers}
    attachSplunkSaveHooks(window, {
        onSave() {
            notifyHostSplunkSave(window);
        }
    });
})();`;
}

module.exports = {
    SPLUNK_SAVE_EVENT,
    isSavedSearchSaveRequest,
    isSplunkSavedSearchEditorPage,
    isSplunkSearchRunnerPage,
    isSavedSearchPage,
    isSplunkSaveButton,
    notifyHostSplunkSave,
    attachSaveShortcut,
    attachSplunkSaveHooks,
    buildSplunkSaveInjectorSource,
};
