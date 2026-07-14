const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { getSavedSearchConfPath, getDashboardViewPath } = require('../lib/object-paths');
const { getSavedSearchId } = require('../lib/saved-search-id');

describe('getSavedSearchConfPath', () => {
    it('uses apps path for shared nobody owner', () => {
        assert.equal(
            getSavedSearchConfPath({ instance: 'prod', app: 'search', owner: 'nobody' }),
            'prod/apps/search/local/savedsearches.conf'
        );
    });

    it('treats Nobody as shared apps path', () => {
        assert.equal(
            getSavedSearchConfPath({ instance: 'prod', app: 'search', owner: 'Nobody' }),
            'prod/apps/search/local/savedsearches.conf'
        );
    });

    it('uses users path for private owner', () => {
        assert.equal(
            getSavedSearchConfPath({ instance: 'prod', app: 'search', owner: 'alice' }),
            'prod/users/alice/search/local/savedsearches.conf'
        );
    });

    it('includes instance prefix', () => {
        assert.equal(
            getSavedSearchConfPath({ instance: 'staging', app: 'search', owner: 'nobody' }),
            'staging/apps/search/local/savedsearches.conf'
        );
    });
});

describe('getDashboardViewPath', () => {
    it('places slugged view under local data/ui/views with extension', () => {
        assert.equal(
            getDashboardViewPath({
                instance: 'prod',
                app: 'search',
                owner: 'nobody',
                name: 'Error Rate',
                ext: 'xml',
            }),
            'prod/apps/search/local/data/ui/views/error-rate.xml'
        );
    });

    it('supports json extension', () => {
        assert.equal(
            getDashboardViewPath({
                instance: 'prod',
                app: 'search',
                owner: 'alice',
                name: 'Ops Board',
                ext: 'json',
            }),
            'prod/users/alice/search/local/data/ui/views/ops-board.json'
        );
    });

    it('strips leading dot from extension', () => {
        assert.equal(
            getDashboardViewPath({
                instance: 'prod',
                app: 'search',
                owner: 'nobody',
                name: 'dash',
                ext: '.xml',
            }),
            'prod/apps/search/local/data/ui/views/dash.xml'
        );
    });

    it('slug is for path segments only, not stanza or object identity', () => {
        const metaA = { instance: 'prod', app: 'search', owner: 'nobody', name: 'Error Rate' };
        const metaB = { instance: 'prod', app: 'search', owner: 'nobody', name: 'error rate' };
        assert.notEqual(getSavedSearchId(metaA), getSavedSearchId(metaB));
        const path = getDashboardViewPath({ ...metaA, ext: 'xml' });
        assert.match(path, /\/error-rate\.xml$/);
        assert.doesNotMatch(path, /Error Rate/);
    });
});
