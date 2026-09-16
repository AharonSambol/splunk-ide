'use strict';

const { DEFAULT_SPLUNK_URL } = require('../lib/splunk-url');

module.exports = {
    // --- explorer / project (renderer/explorer*, explorer/project.js) ---
    fileCounter: 1,
    SPLUNK_URL: DEFAULT_SPLUNK_URL,
    files: [],
    folders: [],
    ideFolders: {},
    collapsedExplorerFolders: new Set(),
    activeFileId: null,
    fileMru: [],
    currentProjectPath: null,
    currentProjectName: 'No project loaded',
    // --- quick search + modals (quick-search.js, explorer/modals.js) ---
    shiftTapCount: 0,
    shiftTimer: null,
    quickSearchSelectedIndex: 0,
    quickSearchMode: 'file',
    modalMode: 'create',
    modalTargetFileId: null,
    // --- git sync (git-settings.js) ---
    currentGit: null,
    gitSyncSettings: {
        splunkUrl: '',
        remoteUrl: '',
        remoteName: 'origin',
        sharedBranch: 'main',
        gitUserName: '',
        gitUserEmail: '',
    },
    // --- history panel (renderer/history/*) ---
    queryVersions: [],
    queryHasUnsavedChanges: false,
    selectedVersionHashes: [],
    queryRefreshGeneration: 0,
    currentQueryText: '',
    previewMode: 'preview',
    historySidebarMode: 'history',
    versionTags: [],
    tagPopupTargetHash: null,
    tagPopupClearMode: false,
    confirmResolve: null,
    restoreParentByFileId: new Map(),
    forcedDraftByFileId: new Set(),
    userDraftByFileId: new Set(),
    liveAceQueryByFileId: new Map(),
    liveDraftDebounceByFileId: new Map(),
    // --- find overlay + confirm modal ---
    _findOverlay: null,
    _lastFindQuery: '',
    _findWasActive: false,
};
