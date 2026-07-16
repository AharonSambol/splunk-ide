function isStaleSplunkImportSyncStatus(syncStatus) {
    return /splunk rest get failed|failed to fetch|fetch failed|rest import failed/i.test(String(syncStatus || ''));
}

function formatQueryHistoryStatus(file, { hasUnsavedChanges, syncStatus, draftStatus } = {}) {
    if (!file?.savedSearch && !file?.dashboard) {
        return hasUnsavedChanges ? 'Unsaved changes' : 'Up to date';
    }

    if (!file?.savedSearch) {
        const parts = [];
        if (hasUnsavedChanges) {
            parts.push('Unsaved changes');
        } else if (!syncStatus) {
            parts.push('Up to date');
        }
        if (syncStatus) {
            parts.push(syncStatus);
        }
        return parts.join(' · ') || 'Up to date';
    }

    const parts = [];
    if (hasUnsavedChanges) {
        parts.push('Unsaved changes');
    } else if (!syncStatus && !(draftStatus?.stale && draftStatus?.status)) {
        parts.push('Up to date');
    }
    if (draftStatus?.stale && draftStatus.status) {
        parts.push(draftStatus.status);
    }
    if (syncStatus) {
        parts.push(syncStatus);
    }
    return parts.join(' · ') || 'Up to date';
}

function getQueryHistoryEmptyMessage(file) {
    if (file?.savedSearch && file.savedSearchStanzaSource === 'missing') {
        return 'Not in git yet. Run a search, then Save Version.';
    }
    return 'No saved versions yet.';
}

module.exports = {
    formatQueryHistoryStatus,
    getQueryHistoryEmptyMessage,
    isStaleSplunkImportSyncStatus
};
