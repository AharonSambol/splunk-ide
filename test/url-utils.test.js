const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { decodeSearchText, extractQueryFromUrl, getFileFolder, parseSavedSearchFromUrl } = require('../lib/url-utils');

describe('decodeSearchText', () => {
    it('decodes percent-encoded text', () => {
        assert.equal(decodeSearchText('index%3Dmain'), 'index=main');
    });

    it('replaces plus signs with spaces', () => {
        assert.equal(decodeSearchText('search+index%3Dmain'), 'search index=main');
    });

    it('returns normalized text when decoding fails', () => {
        assert.equal(decodeSearchText('%E0%A4%A'), '%E0%A4%A');
    });
});

describe('extractQueryFromUrl', () => {
    it('extracts q param from absolute URLs', () => {
        const url = 'http://localhost:8010/en-US/app/search/search?q=search%20index%3Dmain';
        assert.equal(extractQueryFromUrl(url), 'index=main');
    });

    it('extracts q param from partial URLs', () => {
        assert.equal(extractQueryFromUrl('/app/search/search?q=search%20error'), 'error');
    });

    it('strips leading search prefix from plain text', () => {
        assert.equal(extractQueryFromUrl('search index=main'), 'index=main');
    });

    it('returns empty string for blank input', () => {
        assert.equal(extractQueryFromUrl('   '), '');
    });
});

describe('parseSavedSearchFromUrl', () => {
    it('extracts saved-search metadata from Splunk search URLs', () => {
        const url = 'http://localhost:8010/en-US/app/search/search?s=%5Bnobody%3Asearch%3AError%20Rate%5D';
        assert.deepEqual(parseSavedSearchFromUrl(url), {
            instance: 'localhost',
            app: 'search',
            owner: 'nobody',
            name: 'Error Rate'
        });
    });

    it('returns null for ad-hoc search URLs without s param', () => {
        const url = 'http://localhost:8010/en-US/app/search/search?q=search%20index%3Dmain';
        assert.equal(parseSavedSearchFromUrl(url), null);
    });

    it('returns null for blank input', () => {
        assert.equal(parseSavedSearchFromUrl(''), null);
    });
});

describe('getFileFolder', () => {
    it('returns parent folder path', () => {
        assert.equal(getFileFolder('queries/main.spl'), 'queries');
    });

    it('returns empty string for root-level files', () => {
        assert.equal(getFileFolder('main.spl'), '');
    });
});
