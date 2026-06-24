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

module.exports = { decodeSearchText, extractQueryFromUrl, getFileFolder };
