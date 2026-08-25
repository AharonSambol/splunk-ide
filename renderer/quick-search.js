'use strict';

const fs = require('node:fs');
const state = require('./state');
const {
    quickSearchOverlay,
    quickSearchHint,
    quickSearchInput,
    quickSearchResults,
} = require('./dom');
const {
    filterQuickSearchResults,
    getQuickSearchEmptyMessage,
    moveQuickSearchSelection,
} = require('../lib/ui/quick-search');
const { renderQuickSearchResults } = require('../lib/ui/render-quick-search');
const { extractQueryFromUrl } = require('../lib/url-utils');

let openFile;

function openQuickSearch(mode = 'file') {
    state.quickSearchMode = mode;
    quickSearchOverlay.classList.add('visible');
    quickSearchInput.value = '';
    state.quickSearchSelectedIndex = 0;
    quickSearchInput.placeholder = mode === 'content' ? 'Search file contents...' : 'Search files...';
    quickSearchHint.textContent = mode === 'content'
        ? 'Type to search all file contents. Use arrow keys and Enter to open.'
        : 'Type to search open files. Use arrow keys and Enter to open.';
    updateQuickSearchResults();
    quickSearchInput.focus();
}

function closeQuickSearch() {
    quickSearchOverlay.classList.remove('visible');
}

function updateQuickSearchResults() {
    const query = quickSearchInput.value;
    const { results, awaitingQuery } = filterQuickSearchResults(
        state.files,
        state.folders,
        query,
        state.quickSearchMode,
        file => {
            try {
                const rawText = fs.readFileSync(file.path, 'utf8');
                return extractQueryFromUrl(rawText);
            } catch {
                return '';
            }
        }
    );

    renderQuickSearchResults(quickSearchResults, {
        results,
        selectedIndex: state.quickSearchSelectedIndex,
        mode: state.quickSearchMode,
        emptyMessage: getQuickSearchEmptyMessage(state.quickSearchMode, awaitingQuery),
    }, {
        onSelect: activateFileFromQuickSearch,
    });
}

function handleQuickSearchKeydown(event) {
    const visibleItems = Array.from(document.querySelectorAll('.quick-search-item'));
    if (event.key === 'ArrowDown') {
        event.preventDefault();
        state.quickSearchSelectedIndex = moveQuickSearchSelection(
            state.quickSearchSelectedIndex,
            'down',
            visibleItems.length
        );
        updateQuickSearchResults();
    }

    if (event.key === 'ArrowUp') {
        event.preventDefault();
        state.quickSearchSelectedIndex = moveQuickSearchSelection(
            state.quickSearchSelectedIndex,
            'up',
            visibleItems.length
        );
        updateQuickSearchResults();
    }

    if (event.key === 'Enter') {
        event.preventDefault();
        const selectedItem = visibleItems[state.quickSearchSelectedIndex];
        if (selectedItem) {
            activateFileFromQuickSearch(selectedItem.dataset.fileId);
        }
    }

    if (event.key === 'Escape') {
        event.preventDefault();
        closeQuickSearch();
    }
}

function activateFileFromQuickSearch(fileId) {
    closeQuickSearch();
    openFile(fileId);
}

function attachQuickSearch({ openFile: openFileFn }) {
    openFile = openFileFn;
    quickSearchInput.addEventListener('input', updateQuickSearchResults);
    quickSearchInput.addEventListener('keydown', handleQuickSearchKeydown);
}

module.exports = {
    openQuickSearch,
    closeQuickSearch,
    updateQuickSearchResults,
    handleQuickSearchKeydown,
    activateFileFromQuickSearch,
    attachQuickSearch,
};
