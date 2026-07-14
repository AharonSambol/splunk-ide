const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { upsertStanza, extractStanza } = require('../lib/conf-stanza');
const {
    fetchSavedSearchStanza,
    fetchDashboardView,
    serializeSavedSearchStanza,
    buildAuthHeader
} = require('../lib/splunk-rest');

const BASE = 'https://splunk.example.com:8089';

function mockFetch(handler) {
    return async (url, options = {}) => handler(url, options);
}

describe('buildAuthHeader', () => {
    it('builds Basic auth from username and password', () => {
        const header = buildAuthHeader({ username: 'admin', password: 'secret' });
        assert.equal(header, `Basic ${Buffer.from('admin:secret', 'utf8').toString('base64')}`);
    });

    it('builds Splunk token auth', () => {
        assert.equal(buildAuthHeader({ token: 'abc123' }), 'Splunk abc123');
        assert.equal(buildAuthHeader('abc123'), 'Splunk abc123');
    });
});

describe('serializeSavedSearchStanza', () => {
    it('sorts keys, normalizes disabled, and drops eai metadata', () => {
        const stanza = serializeSavedSearchStanza('Error Rate', {
            search: 'index=main',
            disabled: true,
            description: 'rate',
            'eai:acl': null,
            links: {},
            'dispatch.earliest_time': '0'
        });
        assert.equal(stanza, `[Error Rate]
description = rate
disabled = 1
dispatch.earliest_time = 0
search = index=main

`);
    });
});

describe('fetchSavedSearchStanza', () => {
    it('returns stanza text usable by upsertStanza', async () => {
        const fetchFn = mockFetch((url, options) => {
            assert.match(url, /\/servicesNS\/nobody\/search\/saved\/searches\/Error%20Rate\?output_mode=json$/);
            assert.equal(options.headers.Authorization, buildAuthHeader({ username: 'admin', password: 'pw' }));
            return {
                ok: true,
                status: 200,
                statusText: 'OK',
                json: async () => ({
                    entry: [{
                        name: 'Error Rate',
                        content: {
                            search: 'index=main | stats count',
                            disabled: '0',
                            'eai:acl': null
                        }
                    }]
                })
            };
        });

        const stanza = await fetchSavedSearchStanza({
            baseUrl: BASE,
            auth: { username: 'admin', password: 'pw' },
            app: 'search',
            owner: 'nobody',
            name: 'Error Rate',
            fetch: fetchFn
        });

        const conf = upsertStanza('', 'Error Rate', stanza);
        assert.equal(extractStanza(conf, 'Error Rate'), stanza);
        assert.match(stanza, /search = index=main \| stats count/);
    });

    it('throws on auth failure', async () => {
        const fetchFn = mockFetch(() => ({
            ok: false,
            status: 401,
            statusText: 'Unauthorized'
        }));

        await assert.rejects(
            () => fetchSavedSearchStanza({
                baseUrl: BASE,
                auth: { token: 'bad' },
                app: 'search',
                owner: 'nobody',
                name: 'Error Rate',
                fetch: fetchFn
            }),
            (err) => {
                assert.equal(err.status, 401);
                assert.equal(err.authFailure, true);
                return true;
            }
        );
    });
});

describe('fetchDashboardView', () => {
    it('returns raw eai:data body', async () => {
        const viewXml = '<dashboard><label>Errors</label></dashboard>';
        const fetchFn = mockFetch((url) => {
            assert.match(url, /\/servicesNS\/nobody\/search\/data\/ui\/views\/error-dashboard\?output_mode=json$/);
            return {
                ok: true,
                status: 200,
                statusText: 'OK',
                json: async () => ({
                    entry: [{
                        name: 'error-dashboard',
                        content: {
                            'eai:data': viewXml,
                            'eai:type': 'views'
                        }
                    }]
                })
            };
        });

        const body = await fetchDashboardView({
            baseUrl: BASE,
            auth: { token: 'session' },
            app: 'search',
            owner: 'nobody',
            name: 'error-dashboard',
            fetch: fetchFn
        });

        assert.equal(body, viewXml);
    });

    it('throws on auth failure', async () => {
        const fetchFn = mockFetch(() => ({
            ok: false,
            status: 403,
            statusText: 'Forbidden'
        }));

        await assert.rejects(
            () => fetchDashboardView({
                baseUrl: BASE,
                auth: { username: 'x', password: 'y' },
                app: 'search',
                owner: 'nobody',
                name: 'error-dashboard',
                fetch: fetchFn
            }),
            (err) => {
                assert.equal(err.status, 403);
                assert.equal(err.authFailure, true);
                return true;
            }
        );
    });
});
