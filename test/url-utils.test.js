const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { decodeSearchText, extractQueryFromUrl, getFileFolder, getSearchText, parseSavedSearchFromUrl, splunkUiUrlToRestBase, urlsMatchForDraft } = require('../lib/url-utils');

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

    it('returns empty string for saved-search URL without q param', () => {
        const url = 'http://localhost:8010/en-US/app/search/search?s=%5Bnobody%3Asearch%3AError%20Rate%5D';
        assert.equal(extractQueryFromUrl(url), '');
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

    it('extracts saved-search metadata from servicesNS s param', () => {
        const url = 'http://localhost:8010/en-US/app/search/search?s=%2FservicesNS%2Fnobody%2Fsearch%2Fsaved%2Fsearches%2Fmy%2520saved%2520search%2520a&q=search%20index%3Dmain';
        assert.deepEqual(parseSavedSearchFromUrl(url), {
            instance: 'localhost',
            app: 'search',
            owner: 'nobody',
            name: 'my saved search a'
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

describe('urlsMatchForDraft', () => {
    it('treats same query and saved search as equal despite sid differences', () => {
        const base = 'http://localhost:8010/en-US/app/search/search?q=search%20index%3Dmain&s=%2FservicesNS%2Fnobody%2Fsearch%2Fsaved%2Fsearches%2Fnicolas&sid=1';
        const live = 'http://localhost:8010/en-US/app/search/search?s=%2FservicesNS%2Fnobody%2Fsearch%2Fsaved%2Fsearches%2Fnicolas&q=search%20index%3Dmain&sid=2';
        assert.equal(urlsMatchForDraft(base, live), true);
    });

    it('detects real query changes', () => {
        const base = 'http://localhost:8010/en-US/app/search/search?q=search%20index%3Dmain&s=%2FservicesNS%2Fnobody%2Fsearch%2Fsaved%2Fsearches%2Fnicolas';
        const changed = 'http://localhost:8010/en-US/app/search/search?q=search%20index%3Dmain%20nicolas%3D8&s=%2FservicesNS%2Fnobody%2Fsearch%2Fsaved%2Fsearches%2Fnicolas';
        assert.equal(urlsMatchForDraft(base, changed), false);
    });
});

describe('getSearchText', () => {
    it('extracts query text from URL content', () => {
        const url = 'http://localhost:8010/en-US/app/search/search?q=search%20index%3Dmain';
        assert.equal(getSearchText(url), 'index=main');
    });

    it('extracts search= from stanza-shaped content', () => {
        const stanza = `[Error Rate]
search = index=main | stats count
disabled = 0
`;
        assert.equal(getSearchText(stanza), 'index=main | stats count');
    });

    it('returns empty string for unrelated content', () => {
        assert.equal(getSearchText('just some notes'), '');
        assert.equal(getSearchText(''), '');
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

describe('splunkUiUrlToRestBase', () => {
    it('keeps the UI host and port for REST', () => {
        const url = 'http://localhost:8010/en-US/app/search/search?q=search%20index%3Dmain';
        assert.equal(splunkUiUrlToRestBase(url), 'http://localhost:8010');
    });

    it('returns empty string for invalid input', () => {
        assert.equal(splunkUiUrlToRestBase(''), '');
    });
});
