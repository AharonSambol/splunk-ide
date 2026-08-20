function decodeSearchText(rawText) {
    const normalized = rawText.replaceAll('+', ' ');
    try {
        return decodeURIComponent(normalized);
    } catch {
        return normalized;
    }
}

function getSearchText(content) {
    const cleaned = String(content ?? '').trim();
    if (!cleaned) {
        return '';
    }
    if (/^https?:\/\//i.test(cleaned) || cleaned.startsWith('/') || /[?&]q=/.test(cleaned)) {
        return extractQueryFromUrl(cleaned);
    }
    const stanzaMatch = cleaned.match(/^search\s*=\s*(.*)$/m);
    return stanzaMatch ? stanzaMatch[1].trim() : '';
}

function extractQueryFromUrl(rawText) {
    const cleaned = rawText.trim();
    if (!cleaned) {
        return '';
    }

    const looksLikeUrl = /^https?:\/\//i.test(cleaned) || cleaned.startsWith('/');

    try {
        const parsed = new URL(cleaned);
        const q = parsed.searchParams.get('q');
        if (q !== null) {
            return decodeSearchText(q).replace(/^search /, '');
        }
        if (looksLikeUrl) {
            return '';
        }
    } catch {
        // Fallback for non-absolute or malformed URLs
    }

    const queryMatch = cleaned.match(/[?&]q=([^&]+)/);
    if (queryMatch) {
        return decodeSearchText(queryMatch[1]).replace(/^search /, '');
    }

    if (looksLikeUrl) {
        return '';
    }

    return decodeSearchText(cleaned).replace(/^search /, '');
}

function getFileFolder(fileName) {
    const lastSlash = fileName.lastIndexOf('/');
    return lastSlash === -1 ? '' : fileName.slice(0, lastSlash);
}

function slugHostname(hostname) {
    const normalized = String(hostname || '').trim().toLowerCase();
    if (!normalized) {
        return 'unknown-instance';
    }
    const slugged = normalized
        .replace(/[^a-z0-9._-]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^[.\-\s]+|[.\-\s]+$/g, '');
    return slugged || 'unknown-instance';
}

function parseSavedSearchFromServicesNsPath(sParam) {
    const decoded = decodeSearchText(sParam).trim();
    const match = decoded.match(/^\/servicesNS\/([^/]+)\/([^/]+)\/saved\/searches\/(.+)$/i);
    if (!match) {
        return null;
    }

    const owner = decodeSearchText(match[1]).trim();
    const app = decodeSearchText(match[2]).trim();
    const name = decodeSearchText(match[3]).trim();
    if (!owner || !app || !name) {
        return null;
    }
    return { owner, app, name };
}

function parseSavedSearchFromColonParam(sParam) {
    let inner = sParam.trim();
    if (inner.startsWith('[')) {
        inner = inner.slice(1);
    }
    if (inner.endsWith(']')) {
        inner = inner.slice(0, -1);
    }
    inner = inner.replace(/^["']|["']$/g, '');

    const firstColon = inner.indexOf(':');
    const secondColon = inner.indexOf(':', firstColon + 1);
    if (firstColon === -1 || secondColon === -1) {
        return null;
    }

    const owner = decodeSearchText(inner.slice(0, firstColon)).trim();
    const app = decodeSearchText(inner.slice(firstColon + 1, secondColon)).trim();
    const name = decodeSearchText(inner.slice(secondColon + 1)).trim();
    if (!owner || !app || !name) {
        return null;
    }
    return { owner, app, name };
}

function savedSearchIdentityKey(rawUrl) {
    const metadata = parseSavedSearchFromUrl(rawUrl);
    if (!metadata) {
        return '';
    }
    return `${metadata.instance}|${metadata.app}|${metadata.owner}|${metadata.name}`;
}

/**
 * Compare Splunk search URLs by saved-search identity + query text, not raw URL.
 * Ignores sid and param order differences from live Splunk reloads.
 */
function urlsMatchForDraft(leftUrl, rightUrl) {
    const left = String(leftUrl || '').trim();
    const right = String(rightUrl || '').trim();
    if (!left || !right) {
        return left === right;
    }
    if (extractQueryFromUrl(left) !== extractQueryFromUrl(right)) {
        return false;
    }
    const leftIdentity = savedSearchIdentityKey(left);
    const rightIdentity = savedSearchIdentityKey(right);
    if (leftIdentity || rightIdentity) {
        return leftIdentity === rightIdentity;
    }
    return left === right;
}

const RESERVED_APP_VIEWS = new Set([
    'search',
    'manager',
    'launcher',
    'account',
    'xml',
    'dashboards',
    'alerts',
    'alert',
    'reports',
    'datasets',
    'pivot',
    'home',
    'job'
]);

function parseSplunkAppViewName(rawUrl) {
    let parsed;
    try {
        parsed = new URL(String(rawUrl || '').trim());
    } catch {
        try {
            parsed = new URL(String(rawUrl || '').trim(), 'http://localhost');
        } catch {
            return '';
        }
    }
    const pathMatch = parsed.pathname.match(/\/app\/[^/]+\/([^/?#]+)\/?$/);
    if (!pathMatch) {
        return '';
    }
    try {
        return decodeURIComponent(pathMatch[1]).trim();
    } catch {
        return pathMatch[1].trim();
    }
}

/** Ad-hoc Search page (no saved-search s=). List/chrome pages keep the current tab object. */
function shouldClearTabObjectOnNavigate(rawUrl) {
    if (parseSavedSearchFromUrl(rawUrl) || parseDashboardFromUrl(rawUrl)) {
        return false;
    }
    return parseSplunkAppViewName(rawUrl).toLowerCase() === 'search';
}

function parseDashboardFromServicesNsPath(sParam) {
    const decoded = decodeSearchText(sParam).trim();
    const match = decoded.match(/^\/servicesNS\/([^/]+)\/([^/]+)\/data\/ui\/views\/(.+)$/i);
    if (!match) {
        return null;
    }

    const owner = decodeSearchText(match[1]).trim();
    const app = decodeSearchText(match[2]).trim();
    const name = decodeSearchText(match[3]).trim();
    if (!owner || !app || !name) {
        return null;
    }
    return { owner, app, name };
}

function parseDashboardFromUrl(rawUrl) {
    const cleaned = String(rawUrl || '').trim();
    if (!cleaned || parseSavedSearchFromUrl(cleaned)) {
        return null;
    }

    let parsed;
    try {
        parsed = new URL(cleaned);
    } catch {
        try {
            parsed = new URL(cleaned, 'http://localhost');
        } catch {
            return null;
        }
    }

    const sParam = parsed.searchParams.get('s');
    if (sParam) {
        const fromServices = parseDashboardFromServicesNsPath(sParam);
        if (fromServices) {
            const pathMatch = parsed.pathname.match(/\/app\/([^/]+)\//);
            const appFromPath = pathMatch ? decodeURIComponent(pathMatch[1]).trim() : '';
            return {
                instance: slugHostname(parsed.hostname),
                app: fromServices.app || appFromPath || 'search',
                owner: fromServices.owner,
                name: fromServices.name
            };
        }
    }

    const pathMatch = parsed.pathname.match(/\/app\/([^/]+)\/([^/?#]+)\/?$/);
    if (!pathMatch) {
        return null;
    }

    const app = decodeURIComponent(pathMatch[1]).trim();
    const name = decodeURIComponent(pathMatch[2]).trim();
    if (!app || !name || RESERVED_APP_VIEWS.has(name.toLowerCase())) {
        return null;
    }

    return {
        instance: slugHostname(parsed.hostname),
        app,
        owner: 'nobody',
        name
    };
}

function parseSavedSearchFromUrl(rawUrl) {
    const cleaned = String(rawUrl || '').trim();
    if (!cleaned) {
        return null;
    }

    let parsed;
    try {
        parsed = new URL(cleaned);
    } catch {
        try {
            parsed = new URL(cleaned, 'http://localhost');
        } catch {
            return null;
        }
    }

    const sParam = parsed.searchParams.get('s');
    if (!sParam) {
        return null;
    }

    const pathMatch = parsed.pathname.match(/\/app\/([^/]+)\//);
    const appFromPath = pathMatch ? decodeURIComponent(pathMatch[1]).trim() : '';
    const parsedSearch = parseSavedSearchFromServicesNsPath(sParam)
        || parseSavedSearchFromColonParam(sParam);
    if (!parsedSearch) {
        return null;
    }

    return {
        instance: slugHostname(parsed.hostname),
        app: parsedSearch.app || appFromPath || 'search',
        owner: parsedSearch.owner,
        name: parsedSearch.name
    };
}

function splunkUiUrlToRestBase(uiUrl) {
    try {
        const parsed = new URL(String(uiUrl));
        parsed.pathname = '';
        parsed.search = '';
        parsed.hash = '';
        return parsed.origin;
    } catch {
        return '';
    }
}

const DEFAULT_SPLUNK_SEARCH_PATH = '/en-US/app/search/search';
const DEFAULT_SPLUNK_URL = `http://localhost:8010${DEFAULT_SPLUNK_SEARCH_PATH}`;

function normalizeSplunkAddress(input) {
    const raw = String(input ?? '').trim();
    if (!raw) {
        return DEFAULT_SPLUNK_URL;
    }
    const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(raw) ? raw : `http://${raw}`;
    try {
        const url = new URL(withScheme);
        if (!url.pathname || url.pathname === '/') {
            url.pathname = DEFAULT_SPLUNK_SEARCH_PATH;
        }
        return url.href;
    } catch {
        return DEFAULT_SPLUNK_URL;
    }
}

function withSplunkOrigin(href, originUrl) {
    const origin = normalizeSplunkAddress(originUrl);
    try {
        const current = new URL(href);
        const next = new URL(origin);
        return new URL(`${current.pathname}${current.search}${current.hash}`, next.origin).href;
    } catch {
        return origin;
    }
}

module.exports = {
    DEFAULT_SPLUNK_URL,
    decodeSearchText,
    extractQueryFromUrl,
    getFileFolder,
    getSearchText,
    normalizeSplunkAddress,
    parseDashboardFromUrl,
    parseSavedSearchFromUrl,
    shouldClearTabObjectOnNavigate,
    splunkUiUrlToRestBase,
    urlsMatchForDraft,
    withSplunkOrigin
};
