const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
    shouldScheduleLiveDraftRefresh,
    savedSearchLiveDiffersFromHead,
    resolveSavedSearchDirtyOnNavigate
} = require('../lib/saved-search-dirty');

describe('saved-search run-only dirty', () => {
    it('does not schedule live draft refresh while typing in a saved search', () => {
        assert.equal(shouldScheduleLiveDraftRefresh({ savedSearch: { name: 'Error Rate' } }), false);
        assert.equal(shouldScheduleLiveDraftRefresh({ path: 'queries/error-rate.spl' }), true);
    });

    it('detects live query drift from HEAD stanza search', () => {
        assert.equal(savedSearchLiveDiffersFromHead('index=main | stats count', 'index=main'), true);
        assert.equal(savedSearchLiveDiffersFromHead(' index=main ', 'index=main'), false);
    });

    it('drafts on navigate when live differs from HEAD', () => {
        assert.equal(
            resolveSavedSearchDirtyOnNavigate({
                liveQuery: 'index=main | stats count',
                headSearchQuery: 'index=main'
            }),
            'draft'
        );
    });

    it('clears ephemeral dirty on navigate when live matches HEAD', () => {
        assert.equal(
            resolveSavedSearchDirtyOnNavigate({
                liveQuery: 'index=main',
                headSearchQuery: 'index=main'
            }),
            'clear'
        );
        assert.equal(
            resolveSavedSearchDirtyOnNavigate({
                liveQuery: 'index=main',
                headSearchQuery: 'index=main',
                hasDurableDraft: true
            }),
            'keep'
        );
    });
});
