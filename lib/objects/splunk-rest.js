/**
 * Splunk REST GET helpers for mirroring objects into native git paths.
 *
 * Normalization (saved search stanzas → conf text):
 * - Conf keys only: drops `eai:*`, `acl`, and `links` from REST entry content.
 * - Keys sorted lexicographically (ASCII) for stable bytes across fetches.
 * - `disabled` normalized to `0` or `1`.
 * - Lines use LF; stanza block ends with one trailing blank line.
 * - Values stringified as Splunk assigns them (no re-quoting).
 *
 * Views return the raw `eai:data` body (XML or JSON dashboard definition).
 *
 * @exports fetchSavedSearchStanza
 * @exports fetchDashboardView
 * @exports serializeSavedSearchStanza
 * @exports buildAuthHeader
 */

const SKIP_CONTENT_KEYS = new Set(['acl', 'links']);

function buildAuthHeader(auth) {
    if (!auth) {
        return '';
    }
    if (typeof auth === 'string') {
        return auth.startsWith('Splunk ') || auth.startsWith('Basic ') ? auth : `Splunk ${auth}`;
    }
    if (auth.token && !auth.username) {
        const token = String(auth.token);
        return token.startsWith('Splunk ') ? token : `Splunk ${token}`;
    }
    if (auth.username != null) {
        const credentials = `${auth.username}:${auth.password ?? ''}`;
        return `Basic ${Buffer.from(credentials, 'utf8').toString('base64')}`;
    }
    return '';
}

function isConfKey(key) {
    return !key.startsWith('eai:') && !SKIP_CONTENT_KEYS.has(key);
}

function normalizeConfValue(key, value) {
    if (key === 'disabled') {
        if (value === true || value === 1 || value === '1' || value === 'true') {
            return '1';
        }
        if (value === false || value === 0 || value === '0' || value === 'false') {
            return '0';
        }
    }
    if (value === null || value === undefined) {
        return '';
    }
    return String(value);
}

/**
 * @param {string} name exact stanza name
 * @param {Record<string, unknown>} content REST entry content object
 * @returns {string}
 */
function serializeSavedSearchStanza(name, content) {
    const keys = Object.keys(content)
        .filter(isConfKey)
        .sort();
    const lines = [`[${name}]`];
    for (const key of keys) {
        lines.push(`${key} = ${normalizeConfValue(key, content[key])}`);
    }
    return `${lines.join('\n')}\n\n`;
}

function buildServicesNsUrl(baseUrl, owner, app, resourcePath) {
    const base = String(baseUrl).replace(/\/$/, '');
    const segments = [owner, app, ...resourcePath.split('/')]
        .map((segment) => encodeURIComponent(segment));
    return `${base}/servicesNS/${segments.join('/')}`;
}

function buildSavedSearchUrl({ baseUrl, owner, app, name }) {
    return `${buildServicesNsUrl(baseUrl, owner, app, `saved/searches/${name}`)}?output_mode=json`;
}

function buildViewUrl({ baseUrl, owner, app, name }) {
    return `${buildServicesNsUrl(baseUrl, owner, app, `data/ui/views/${name}`)}?output_mode=json`;
}

function splunkRestError(status, detail) {
    const err = new Error(detail || `Splunk REST GET failed: ${status}`);
    err.status = status;
    err.authFailure = status === 401 || status === 403;
    return err;
}

/**
 * @param {string} url
 * @param {{ auth?: object | string, fetch?: typeof fetch }} options
 * @returns {Promise<unknown>}
 */
async function splunkGetJson(url, { auth, fetch: fetchFn = globalThis.fetch } = {}) {
    const headers = { Accept: 'application/json' };
    const authorization = buildAuthHeader(auth);
    if (authorization) {
        headers.Authorization = authorization;
    }

    const response = await fetchFn(url, { method: 'GET', headers });
    if (!response.ok) {
        throw splunkRestError(response.status, `Splunk REST GET failed: ${response.status} ${response.statusText}`);
    }
    return response.json();
}

function firstEntryContent(payload) {
    const entry = payload?.entry?.[0];
    if (!entry?.content) {
        throw new Error('Splunk REST response missing entry content');
    }
    return entry.content;
}

/**
 * @param {{
 *   baseUrl: string,
 *   auth?: object | string,
 *   app: string,
 *   owner: string,
 *   name: string,
 *   fetch?: typeof fetch
 * }} options
 * @returns {Promise<string>}
 */
async function fetchSavedSearchStanza({ baseUrl, auth, app, owner, name, fetch: fetchFn }) {
    const url = buildSavedSearchUrl({ baseUrl, owner, app, name });
    const payload = await splunkGetJson(url, { auth, fetch: fetchFn });
    const content = firstEntryContent(payload);
    return serializeSavedSearchStanza(name, content);
}

/**
 * @param {{
 *   baseUrl: string,
 *   auth?: object | string,
 *   app: string,
 *   owner: string,
 *   name: string,
 *   fetch?: typeof fetch
 * }} options
 * @returns {Promise<string>}
 */
async function fetchDashboardView({ baseUrl, auth, app, owner, name, fetch: fetchFn }) {
    const url = buildViewUrl({ baseUrl, owner, app, name });
    const payload = await splunkGetJson(url, { auth, fetch: fetchFn });
    const content = firstEntryContent(payload);
    if (content['eai:data'] == null) {
        throw new Error('Splunk REST view response missing eai:data');
    }
    return String(content['eai:data']);
}

module.exports = {
    fetchSavedSearchStanza,
    fetchDashboardView,
    serializeSavedSearchStanza,
    buildAuthHeader
};
