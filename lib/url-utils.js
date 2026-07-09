function decodeSearchText(rawText) {
    const normalized = rawText.replaceAll('+', ' ');
    try {
        return decodeURIComponent(normalized);
    } catch {
        return normalized;
    }
}

function extractQueryFromUrl(rawText) {
    const cleaned = rawText.trim();
    if (!cleaned) {
        return '';
    }

    try {
        const parsed = new URL(cleaned);
        const q = parsed.searchParams.get('q');
        if (q !== null) {
            return decodeSearchText(q).replace(/^search /, '');
        }
    } catch {
        // Fallback for non-absolute or malformed URLs
    }

    const queryMatch = cleaned.match(/[?&]q=([^&]+)/);
    if (queryMatch) {
        return decodeSearchText(queryMatch[1]).replace(/^search /, '');
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

    const pathMatch = parsed.pathname.match(/\/app\/([^/]+)\//);
    const appFromPath = pathMatch ? decodeURIComponent(pathMatch[1]).trim() : '';

    return {
        instance: slugHostname(parsed.hostname),
        app: app || appFromPath || 'search',
        owner,
        name
    };
}

module.exports = { decodeSearchText, extractQueryFromUrl, getFileFolder, parseSavedSearchFromUrl };
