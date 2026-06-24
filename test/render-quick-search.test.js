const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { getQuickSearchEmptyMessage } = require('../lib/quick-search');
const { renderQuickSearchResults } = require('../lib/render-quick-search');
const { createDocument, createContainer } = require('./helpers/dom');

const sampleResults = [
    { id: '1', name: 'queries/main' },
    { id: '2', name: 'archive/old', snippet: 'index=main error' },
];

describe('renderQuickSearchResults', () => {
    it('renders result list with selected item class', () => {
        const document = createDocument();
        const container = createContainer(document, 'quick-search-results');

        renderQuickSearchResults(container, {
            results: sampleResults,
            selectedIndex: 1,
            mode: 'file',
            emptyMessage: 'No matching files.',
        });

        const items = container.querySelectorAll('.quick-search-item');
        assert.equal(items.length, 2);
        assert.equal(items[0].dataset.fileId, '1');
        assert.equal(items[1].dataset.fileId, '2');
        assert.ok(items[1].classList.contains('selected'));
        assert.ok(!items[0].classList.contains('selected'));
    });

    it('renders empty state message', () => {
        const document = createDocument();
        const container = createContainer(document, 'quick-search-results');

        renderQuickSearchResults(container, {
            results: [],
            selectedIndex: 0,
            mode: 'file',
            emptyMessage: 'No matching files.',
        });

        const empty = container.querySelector('#quick-search-empty');
        assert.ok(empty);
        assert.equal(empty.textContent, 'No matching files.');
    });

    it('renders content mode snippet details', () => {
        const document = createDocument();
        const container = createContainer(document, 'quick-search-results');

        renderQuickSearchResults(container, {
            results: [sampleResults[1]],
            selectedIndex: 0,
            mode: 'content',
            emptyMessage: 'No matching text found.',
        });

        const snippet = container.querySelector('.quick-search-snippet');
        assert.ok(snippet);
        assert.equal(snippet.textContent, 'index=main error');
    });

    it('shows awaiting-query empty message for content mode', () => {
        const document = createDocument();
        const container = createContainer(document, 'quick-search-results');
        const message = getQuickSearchEmptyMessage('content', true);

        renderQuickSearchResults(container, {
            results: [],
            selectedIndex: 0,
            mode: 'content',
            emptyMessage: message,
        });

        assert.equal(container.textContent, 'Start typing to search file contents.');
    });

    it('calls select handler when result is clicked', () => {
        const document = createDocument();
        const container = createContainer(document, 'quick-search-results');
        let selectedId = null;

        renderQuickSearchResults(container, {
            results: sampleResults,
            selectedIndex: 0,
            mode: 'file',
            emptyMessage: 'No matching files.',
        }, {
            onSelect: id => { selectedId = id; },
        });

        container.querySelector('.quick-search-item[data-file-id="2"]').click();
        assert.equal(selectedId, '2');
    });
});
