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

function shouldNotifyOnSave(win) {
    try {
        const topHref = win?.top?.location?.href;
        if (topHref && isSplunkSearchRunnerPage(topHref)) {
            return true;
        }
    } catch {
        // cross-origin frame
    }
    return isSplunkSearchRunnerPage(win?.location?.href || '');
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

function patchSaveNetworking(win, notifySplunkSave) {
    if (!win || win.__splunkIdeNetworkPatched) {
        return;
    }
    win.__splunkIdeNetworkPatched = true;

    const maybeNotify = (url, method, ok) => {
        if (!ok || !shouldNotifyOnSave(win) || !isSavedSearchSaveRequest(url, method)) {
            return;
        }
        notifySplunkSave();
    };

    const origFetch = win.fetch;
    if (typeof origFetch === 'function') {
        win.fetch = function patchedFetch(input, init) {
            const result = origFetch.apply(this, arguments);
            try {
                const url = typeof input === 'string' ? input : input?.url || '';
                const method = init?.method || 'GET';
                result.then((res) => {
                    maybeNotify(url, method, res.ok);
                }).catch(() => {});
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
                maybeNotify(
                    this.__splunkIdeUrl,
                    this.__splunkIdeMethod,
                    this.status >= 200 && this.status < 300
                );
            } catch {
                // ignore
            }
        });
        return origSend.apply(this, args);
    };
}

function attachNetworkingToFrames(win, notifySplunkSave) {
    patchSaveNetworking(win, notifySplunkSave);
    try {
        for (const iframe of win.document.querySelectorAll('iframe')) {
            try {
                patchSaveNetworking(iframe.contentWindow, notifySplunkSave);
            } catch {
                // cross-origin iframe
            }
        }
    } catch {
        // ignore
    }
}

/**
 * Notify host after Splunk persists a saved search (successful REST write).
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

    attachNetworkingToFrames(win, notifySplunkSave);
    try {
        const observer = new win.MutationObserver(() => {
            attachNetworkingToFrames(win, notifySplunkSave);
        });
        observer.observe(win.document.documentElement, { childList: true, subtree: true });
    } catch {
        // ignore
    }
}

function buildSplunkSaveInjectorSource() {
    const helpers = [
        normalizeSavedSearchUrl,
        pagePath,
        isSplunkSavedSearchEditorPage,
        isSplunkSearchRunnerPage,
        isSavedSearchSaveRequest,
        shouldNotifyOnSave,
        notifyHostSplunkSave,
        patchSaveNetworking,
        attachNetworkingToFrames,
        attachSplunkSaveHooks
    ].map((fn) => fn.toString()).join('\n');
    return `(function() {
    if (window.__splunkIdeSaveHooks) {
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
    shouldNotifyOnSave,
    notifyHostSplunkSave,
    patchSaveNetworking,
    attachSplunkSaveHooks,
    buildSplunkSaveInjectorSource,
};
