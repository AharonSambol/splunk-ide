const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { resolveSavedSearchDraftPreviewText } = require('../lib/saved-search-preview');

const DRAFT_STANZA = `[Error Rate]
search = index=main | stats count
disabled = 0
`;

const HEAD_STANZA = `[Error Rate]
search = index=main
disabled = 0
`;

describe('resolveSavedSearchDraftPreviewText', () => {
    it('prefers extracted search from draft stanza over head', () => {
        assert.equal(
            resolveSavedSearchDraftPreviewText({
                draftStanzaText: DRAFT_STANZA,
                headStanzaText: HEAD_STANZA
            }),
            'index=main | stats count'
        );
    });

    it('falls back to head stanza search when no draft exists', () => {
        assert.equal(
            resolveSavedSearchDraftPreviewText({ headStanzaText: HEAD_STANZA }),
            'index=main'
        );
    });
});
