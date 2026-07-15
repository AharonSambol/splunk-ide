function normalizeSavedSearchQuery(query) {
    return String(query ?? '').trim();
}

function savedSearchLiveDiffersFromHead(liveQuery, headSearchQuery) {
    return normalizeSavedSearchQuery(liveQuery) !== normalizeSavedSearchQuery(headSearchQuery);
}

/** Saved-search drafts persist on run/navigate only, not Ace keystrokes. */
function shouldScheduleLiveDraftRefresh(file) {
    return !file?.savedSearch;
}

/**
 * @param {{ liveQuery: string, headSearchQuery: string, hasForcedDraft?: boolean, hasDurableDraft?: boolean }} opts
 * @returns {'draft'|'clear'|'keep'}
 */
function resolveSavedSearchDirtyOnNavigate({
    liveQuery,
    headSearchQuery,
    hasForcedDraft = false,
    hasDurableDraft = false
}) {
    if (!savedSearchLiveDiffersFromHead(liveQuery, headSearchQuery)) {
        if (hasForcedDraft || hasDurableDraft) {
            return 'keep';
        }
        return 'clear';
    }
    return 'draft';
}

module.exports = {
    normalizeSavedSearchQuery,
    savedSearchLiveDiffersFromHead,
    shouldScheduleLiveDraftRefresh,
    resolveSavedSearchDirtyOnNavigate
};
