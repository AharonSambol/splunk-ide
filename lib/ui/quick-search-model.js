'use strict';

function normalizeQuickSearchQuery(query) {
    return query.trim().toLowerCase();
}

function getFileSearchLabel(fileName) {
    return fileName.split('/').pop();
}

function matchesFileQuery(file, query) {
    const normalizedQuery = normalizeQuickSearchQuery(query);
    if (!normalizedQuery) {
        return true;
    }
    const searchLabel = getFileSearchLabel(file.name);
    return file.name.toLowerCase().includes(normalizedQuery)
        || searchLabel.toLowerCase().includes(normalizedQuery);
}

function filterFileModeResults(files, query) {
    return files
        .map(file => ({
            ...file,
            searchLabel: getFileSearchLabel(file.name),
        }))
        .filter(file => matchesFileQuery(file, query));
}

function matchesContentQuery(queryText, query) {
    const normalizedQuery = normalizeQuickSearchQuery(query);
    if (!normalizedQuery) {
        return false;
    }
    return queryText.toLowerCase().indexOf(normalizedQuery) !== -1;
}

function buildContentSearchResult(file, queryText) {
    return {
        ...file,
        snippet: queryText.replace(/\s+/g, ' '),
    };
}

function filterContentModeResults(files, query, getQueryText) {
    const normalizedQuery = normalizeQuickSearchQuery(query);
    if (!normalizedQuery) {
        return { results: [], awaitingQuery: true };
    }

    const results = files
        .map(file => {
            const queryText = getQueryText(file);
            if (!matchesContentQuery(queryText, query)) {
                return null;
            }
            return buildContentSearchResult(file, queryText);
        })
        .filter(Boolean);

    return { results, awaitingQuery: false };
}

function filterQuickSearchResults(files, folders, query, mode, getQueryText) {
    if (mode === 'content') {
        return filterContentModeResults(files, query, getQueryText);
    }

    return {
        results: filterFileModeResults(files, query),
        awaitingQuery: false,
    };
}

function getQuickSearchEmptyMessage(mode, awaitingQuery) {
    if (mode === 'content' && awaitingQuery) {
        return 'Start typing to search file contents.';
    }
    return mode === 'content' ? 'No matching text found.' : 'No matching files.';
}

function moveQuickSearchSelection(currentIndex, direction, resultCount) {
    if (resultCount <= 0) {
        return 0;
    }
    if (direction === 'down') {
        return Math.min(currentIndex + 1, resultCount - 1);
    }
    if (direction === 'up') {
        return Math.max(currentIndex - 1, 0);
    }
    return currentIndex;
}

module.exports = {
    normalizeQuickSearchQuery,
    getFileSearchLabel,
    matchesFileQuery,
    filterFileModeResults,
    matchesContentQuery,
    buildContentSearchResult,
    filterContentModeResults,
    filterQuickSearchResults,
    getQuickSearchEmptyMessage,
    moveQuickSearchSelection,
};
