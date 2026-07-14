const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { parseDashboardFromUrl } = require('../lib/url-utils');

describe('parseDashboardFromUrl', () => {
    it('extracts dashboard metadata from app view path', () => {
        const url = 'http://localhost:8010/en-US/app/search/error_dashboard';
        assert.deepEqual(parseDashboardFromUrl(url), {
            instance: 'localhost',
            app: 'search',
            owner: 'nobody',
            name: 'error_dashboard'
        });
    });

    it('extracts dashboard metadata from servicesNS s param', () => {
        const url = 'http://localhost:8010/en-US/app/search/search?s=%2FservicesNS%2Fnobody%2Fsearch%2Fdata%2Fui%2Fviews%2Fops-board';
        assert.deepEqual(parseDashboardFromUrl(url), {
            instance: 'localhost',
            app: 'search',
            owner: 'nobody',
            name: 'ops-board'
        });
    });

    it('returns null for saved-search URLs', () => {
        const url = 'http://localhost:8010/en-US/app/search/search?s=%5Bnobody%3Asearch%3AError%20Rate%5D';
        assert.equal(parseDashboardFromUrl(url), null);
    });

    it('returns null for ad-hoc search page', () => {
        const url = 'http://localhost:8010/en-US/app/search/search?q=search%20index%3Dmain';
        assert.equal(parseDashboardFromUrl(url), null);
    });

    it('returns null for blank input', () => {
        assert.equal(parseDashboardFromUrl(''), null);
    });
});
