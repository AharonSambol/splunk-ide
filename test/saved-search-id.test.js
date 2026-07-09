const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { getSavedSearchId, getSavedSearchPath } = require('../lib/saved-search-id');

function expectedSha12(canonicalId) {
    return crypto.createHash('sha256').update(canonicalId, 'utf8').digest('hex').slice(0, 12);
}

describe('getSavedSearchId', () => {
    it('builds canonical id from metadata', () => {
        assert.equal(
            getSavedSearchId({ instance: 'prod', app: 'search', owner: 'nobody', name: 'Error Rate' }),
            'prod|search|nobody|Error Rate'
        );
    });

    it('uses fallbacks for missing fields', () => {
        assert.equal(
            getSavedSearchId({}),
            'unknown-instance|unknown-app|unknown-owner|untitled-search'
        );
    });
});

describe('getSavedSearchPath', () => {
    it('returns stable path for same metadata', () => {
        const meta = { instance: 'prod', app: 'search', owner: 'nobody', name: 'Error Rate' };
        const path1 = getSavedSearchPath(meta);
        const path2 = getSavedSearchPath(meta);
        assert.equal(path1, path2);
        const id = getSavedSearchId(meta);
        assert.equal(path1, `saved-searches/prod/search/nobody/error-rate-${expectedSha12(id)}.spl`);
    });

    it('uses different hash when canonical metadata differs but name slug matches', () => {
        const metaA = { instance: 'prod', app: 'search', owner: 'nobody', name: 'Error Rate' };
        const metaB = { instance: 'staging', app: 'search', owner: 'nobody', name: 'Error Rate' };
        const pathA = getSavedSearchPath(metaA);
        const pathB = getSavedSearchPath(metaB);
        assert.match(pathA, /error-rate-[a-f0-9]{12}\.spl$/);
        assert.match(pathB, /error-rate-[a-f0-9]{12}\.spl$/);
        assert.notEqual(pathA, pathB);
        assert.notEqual(expectedSha12(getSavedSearchId(metaA)), expectedSha12(getSavedSearchId(metaB)));
    });

    it('slugs unsafe characters in path segments', () => {
        const meta = {
            instance: 'Prod Server!',
            app: 'my app',
            owner: 'user@corp',
            name: '  Error..Rate  ',
        };
        const id = getSavedSearchId(meta);
        const path = getSavedSearchPath(meta);
        assert.equal(path, `saved-searches/prod-server/my-app/user-corp/error..rate-${expectedSha12(id)}.spl`);
    });

    it('uses fallback segments for blank fields', () => {
        const meta = { instance: '', app: '   ', owner: null, name: undefined };
        const id = getSavedSearchId(meta);
        const path = getSavedSearchPath(meta);
        assert.equal(id, 'unknown-instance|unknown-app|unknown-owner|untitled-search');
        assert.equal(
            path,
            `saved-searches/unknown-instance/unknown-app/unknown-owner/untitled-search-${expectedSha12(id)}.spl`
        );
    });
});
