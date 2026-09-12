'use strict';

function getFallbackActiveTab(openTabs, closedFileId) {
    const remaining = openTabs.filter(id => id !== closedFileId);
    return remaining.length > 0 ? remaining[0] : null;
}

function closeFileState(files, openTabs, activeFileId, fileId, fileMru = []) {
    const newOpenTabs = openTabs.filter(id => id !== fileId);
    const newFileMru = fileMru.filter(id => id !== fileId);
    let newActiveFileId = activeFileId;
    if (activeFileId === fileId) {
        newActiveFileId = getFallbackActiveTab(openTabs, fileId);
    }
    return {
        files,
        openTabs: newOpenTabs,
        activeFileId: newActiveFileId,
        fileMru: newFileMru,
    };
}

function reorderTabs(openTabs, draggedFileId, targetFileId, position) {
    if (draggedFileId === targetFileId) {
        return [...openTabs];
    }

    const withoutDragged = openTabs.filter(id => id !== draggedFileId);
    const targetIndex = withoutDragged.indexOf(targetFileId);
    if (targetIndex === -1) {
        return [...openTabs];
    }

    const insertIndex = position === 'before' ? targetIndex : targetIndex + 1;
    const result = [...withoutDragged];
    result.splice(insertIndex, 0, draggedFileId);
    return result;
}

function getPreviousTab(openTabs, activeFileId) {
    const activeIndex = openTabs.indexOf(activeFileId);
    if (activeIndex > 0) {
        return openTabs[activeIndex - 1];
    }
    return null;
}

function getNextTab(openTabs, activeFileId) {
    const activeIndex = openTabs.indexOf(activeFileId);
    if (activeIndex >= 0 && activeIndex < openTabs.length - 1) {
        return openTabs[activeIndex + 1];
    }
    return null;
}

function createDuplicateFileName(existingFiles, baseName) {
    const names = new Set(existingFiles.map(file => file.name.split('/').pop()));
    let candidate = `${baseName} (2)`;
    if (!names.has(candidate)) {
        return candidate;
    }
    let counter = 3;
    while (names.has(`${baseName} (${counter})`)) {
        counter += 1;
    }
    return `${baseName} (${counter})`;
}

module.exports = {
    closeFileState,
    reorderTabs,
    getPreviousTab,
    getNextTab,
    getFallbackActiveTab,
    createDuplicateFileName,
};
