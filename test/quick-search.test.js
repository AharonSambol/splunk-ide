const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
    normalizeQuickSearchQuery,
    getFileSearchLabel,
    matchesFileQuery,
    filterFileModeResults,
    matchesContentQuery,
    buildContentSearchResult,
    filterQuickSearchResults,
    getQuickSearchEmptyMessage,
    moveQuickSearchSelection,
} = require('../lib/quick-search');

const sampleFiles = [
    { id: '1', name: 'queries/main', path: '/p/queries/main.spl' },
    { id: '2', name: 'archive/old', path: '/p/archive/old.spl' },
    { id: '3', name: 'root', path: '/p/root.spl' },
];

describe('normalizeQuickSearchQuery', () => {
    it('trims and lowercases query text', () => {
        assert.equal(normalizeQuickSearchQuery('  Main  '), 'main');
    });
});

describe('getFileSearchLabel', () => {
    it('returns the basename of a nested file path', () => {
        assert.equal(getFileSearchLabel('queries/main'), 'main');
    });
});

describe('matchesFileQuery', () => {
    it('matches on full path', () => {
        assert.equal(matchesFileQuery(sampleFiles[0], 'queries'), true);
    });

    it('matches on basename', () => {
        assert.equal(matchesFileQuery(sampleFiles[0], 'main'), true);
    });

    it('returns all files for an empty query', () => {
        assert.equal(matchesFileQuery(sampleFiles[0], ''), true);
    });

    it('returns false when nothing matches', () => {
        assert.equal(matchesFileQuery(sampleFiles[0], 'missing'), false);
    });
});

describe('filterFileModeResults', () => {
    it('adds search labels and filters by query', () => {
        const results = filterFileModeResults(sampleFiles, 'main');
        assert.deepEqual(results.map(file => file.id), ['1']);
        assert.equal(results[0].searchLabel, 'main');
    });

    it('returns all files when query is empty', () => {
        assert.equal(filterFileModeResults(sampleFiles, '').length, 3);
    });
});

describe('matchesContentQuery', () => {
    it('finds query text case-insensitively', () => {
        assert.equal(matchesContentQuery('index=main ERROR', 'error'), true);
    });

    it('returns false for empty query', () => {
        assert.equal(matchesContentQuery('index=main', ''), false);
    });
});

describe('buildContentSearchResult', () => {
    it('collapses whitespace in snippet', () => {
        const result = buildContentSearchResult(sampleFiles[0], 'index=main\n  | stats count');
        assert.equal(result.snippet, 'index=main | stats count');
    });
});

describe('filterQuickSearchResults', () => {
    it('filters file mode results', () => {
        const { results, awaitingQuery } = filterQuickSearchResults(sampleFiles, [], 'archive', 'file');
        assert.equal(awaitingQuery, false);
        assert.deepEqual(results.map(file => file.id), ['2']);
    });

    it('waits for query input in content mode', () => {
        const { results, awaitingQuery } = filterQuickSearchResults(
            sampleFiles,
            [],
            '   ',
            'content',
            () => 'index=main'
        );
        assert.equal(awaitingQuery, true);
        assert.deepEqual(results, []);
    });

    it('filters content mode results via query text callback', () => {
        const getQueryText = file => (file.id === '1' ? 'index=main error' : 'index=other');
        const { results, awaitingQuery } = filterQuickSearchResults(
            sampleFiles,
            [],
            'error',
            'content',
            getQueryText
        );
        assert.equal(awaitingQuery, false);
        assert.deepEqual(results.map(file => file.id), ['1']);
        assert.equal(results[0].snippet, 'index=main error');
    });
});

describe('getQuickSearchEmptyMessage', () => {
    it('returns prompt text before content search starts', () => {
        assert.equal(
            getQuickSearchEmptyMessage('content', true),
            'Start typing to search file contents.'
        );
    });

    it('returns mode-specific no-match text', () => {
        assert.equal(getQuickSearchEmptyMessage('file', false), 'No matching files.');
        assert.equal(getQuickSearchEmptyMessage('content', false), 'No matching text found.');
    });
});

describe('moveQuickSearchSelection', () => {
    it('moves selection down within bounds', () => {
        assert.equal(moveQuickSearchSelection(0, 'down', 3), 1);
        assert.equal(moveQuickSearchSelection(2, 'down', 3), 2);
    });

    it('moves selection up within bounds', () => {
        assert.equal(moveQuickSearchSelection(2, 'up', 3), 1);
        assert.equal(moveQuickSearchSelection(0, 'up', 3), 0);
    });

    it('returns zero when there are no results', () => {
        assert.equal(moveQuickSearchSelection(0, 'down', 0), 0);
    });
});
