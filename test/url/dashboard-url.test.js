const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { parseDashboardFromUrl, shouldClearTabObjectOnNavigate } = require('../lib/splunk-url');

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

    it('returns null for Splunk list and chrome pages', () => {
        assert.equal(parseDashboardFromUrl('http://localhost:8010/en-US/app/search/dashboards'), null);
        assert.equal(parseDashboardFromUrl('http://localhost:8010/en-US/app/search/alerts'), null);
        assert.equal(parseDashboardFromUrl('http://localhost:8010/en-US/app/search/alert'), null);
        assert.equal(parseDashboardFromUrl('http://localhost:8010/en-US/app/search/reports'), null);
    });
});

describe('shouldClearTabObjectOnNavigate', () => {
    it('keeps the current object on Dashboards and Alerts lists', () => {
        assert.equal(shouldClearTabObjectOnNavigate('http://localhost:8010/en-US/app/search/dashboards'), false);
        assert.equal(shouldClearTabObjectOnNavigate('http://localhost:8010/en-US/app/search/alerts'), false);
    });

    it('clears on the ad-hoc Search page', () => {
        assert.equal(
            shouldClearTabObjectOnNavigate('http://localhost:8010/en-US/app/search/search?q=search%20index%3Dmain'),
            true
        );
    });

    it('does not clear when the URL is a saved search or dashboard', () => {
        assert.equal(
            shouldClearTabObjectOnNavigate('http://localhost:8010/en-US/app/search/search?s=%5Bnobody%3Asearch%3AError%20Rate%5D'),
            false
        );
        assert.equal(
            shouldClearTabObjectOnNavigate('http://localhost:8010/en-US/app/search/error_dashboard'),
            false
        );
    });
});
