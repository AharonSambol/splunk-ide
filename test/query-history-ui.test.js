const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
    formatQueryHistoryStatus,
    getQueryHistoryEmptyMessage,
    isStaleSplunkImportSyncStatus
} = require('../lib/query-history-ui');

describe('formatQueryHistoryStatus', () => {
    it('matches plain .spl copy for non-saved-search files', () => {
        assert.equal(formatQueryHistoryStatus({}, { hasUnsavedChanges: true }), 'Unsaved changes');
        assert.equal(formatQueryHistoryStatus({}, { hasUnsavedChanges: false }), 'Up to date');
    });

    it('uses Unsaved changes for saved search dirty state', () => {
        const file = { savedSearch: { name: 'Error Rate' } };
        assert.equal(
            formatQueryHistoryStatus(file, { hasUnsavedChanges: true }),
            'Unsaved changes'
        );
    });

    it('keeps stale draft and sync status as separate parts', () => {
        const file = { savedSearch: { name: 'Error Rate' } };
        assert.equal(
            formatQueryHistoryStatus(file, {
                hasUnsavedChanges: true,
                draftStatus: { stale: true, status: 'Stale draft base' },
                syncStatus: 'Remote changed'
            }),
            'Unsaved changes · Stale draft base · Remote changed'
        );
    });

    it('shows sync warning without Up to date when stanza is missing', () => {
        const file = { savedSearch: { name: 'Error Rate' } };
        const warning = 'saved search missing from git and no REST config for import';
        assert.equal(
            formatQueryHistoryStatus(file, { hasUnsavedChanges: false, syncStatus: warning }),
            warning
        );
    });

    it('includes dashboard sync status', () => {
        const file = { dashboard: { name: 'alerts' } };
        assert.equal(
            formatQueryHistoryStatus(file, {
                hasUnsavedChanges: true,
                syncStatus: 'fetch failed'
            }),
            'Unsaved changes · fetch failed'
        );
    });
});

describe('isStaleSplunkImportSyncStatus', () => {
    it('detects browser and REST import failures', () => {
        assert.equal(isStaleSplunkImportSyncStatus('Failed to fetch'), true);
        assert.equal(isStaleSplunkImportSyncStatus('fetch failed'), true);
        assert.equal(isStaleSplunkImportSyncStatus('Push failed'), false);
    });
});

describe('getQueryHistoryEmptyMessage', () => {
    it('uses generic copy for plain queries', () => {
        assert.equal(getQueryHistoryEmptyMessage({}), 'No saved versions yet.');
    });

    it('uses saved-search guidance when stanza is missing from git', () => {
        const file = {
            savedSearch: { name: 'Error Rate' },
            savedSearchStanzaSource: 'missing'
        };
        assert.equal(
            getQueryHistoryEmptyMessage(file),
            'Not in git yet. Run a search, then Save Version.'
        );
    });

    it('uses generic copy when saved search has a git stanza', () => {
        const file = {
            savedSearch: { name: 'Error Rate' },
            savedSearchStanzaSource: 'head'
        };
        assert.equal(getQueryHistoryEmptyMessage(file), 'No saved versions yet.');
    });
});
