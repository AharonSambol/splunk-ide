'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { parseDashboardFromUrl } = require('../../lib/splunk-url');
const { listVersions } = require('../../lib/git/query-versions');
const { openDashboardHistory } = require('../../lib/objects/dashboard-open');
const { getGitAuthorFromSettings, getGitRemoteSettings } = require('../git-settings');
const state = require('../state');

let getSplunkRestSettings;
let renderEmptySavedSearchHistory;
let onQueryFileChanged;
let getRelativePath;
let getDashboardViewRelativePath;
let ensureDirectoryExists;
let updateTabLabel;
let updateExplorer;

function attachHistorySyncDashboard(deps) {
    ({
        getSplunkRestSettings = getSplunkRestSettings,
        renderEmptySavedSearchHistory = renderEmptySavedSearchHistory,
        onQueryFileChanged = onQueryFileChanged,
        getRelativePath = getRelativePath,
        getDashboardViewRelativePath = getDashboardViewRelativePath,
        ensureDirectoryExists = ensureDirectoryExists,
        updateTabLabel = updateTabLabel,
        updateExplorer = updateExplorer,
    } = deps);
}

function clearDashboardContext(file, url) {
    delete file.dashboard;
    state.forcedDraftByFileId.delete(file.id);
    state.userDraftByFileId.delete(file.id);
    state.restoreParentByFileId.delete(file.id);
    if (url && url !== file.url) {
        file.url = url;
        if (fs.existsSync(file.path)) {
            fs.writeFileSync(file.path, url, 'utf8');
        }
        state.userDraftByFileId.add(file.id);
    }
    state.selectedVersionHashes = [];
    if (file.id === state.activeFileId) {
        renderEmptySavedSearchHistory();
    }
    onQueryFileChanged(file.id);
}

function resolveDashboardFromFile(file, currentUrl) {
    if (file?.dashboard) {
        return file.dashboard;
    }
    const rawUrl = currentUrl
        || file?.url
        || (file?.path && fs.existsSync(file.path) ? fs.readFileSync(file.path, 'utf8').trim() : '');
    const dashboard = parseDashboardFromUrl(rawUrl);
    if (dashboard && file) {
        file.dashboard = dashboard;
    }
    return dashboard || null;
}

async function syncDashboardTrackedBase(file) {
    if (!file?.dashboard || !state.currentGit) {
        return;
    }

    const relativePath = getRelativePath(file);
    const versions = await listVersions(state.currentGit, relativePath, 1);
    if (versions.length === 0) {
        return;
    }

    const latestHash = versions[0].hash;
    state.restoreParentByFileId.set(file.id, latestHash);
    if (!state.userDraftByFileId.has(file.id) && !state.forcedDraftByFileId.has(file.id)) {
        state.userDraftByFileId.delete(file.id);
        state.forcedDraftByFileId.delete(file.id);
    }
}

async function enterDashboardHistory(file, currentUrl) {
    resolveDashboardFromFile(file, currentUrl);
    if (!file?.dashboard || !state.currentGit || !state.currentProjectPath) {
        return;
    }

    const url = currentUrl
        || file.url
        || (fs.existsSync(file.path) ? fs.readFileSync(file.path, 'utf8').trim() : '');

    try {
        const result = await openDashboardHistory({
            git: state.currentGit,
            workspaceRoot: state.currentProjectPath,
            metadata: file.dashboard,
            restSettings: getSplunkRestSettings(url),
            remoteSettings: getGitRemoteSettings(),
            author: getGitAuthorFromSettings()
        });
        if (result.dashboard) {
            file.dashboard = result.dashboard;
        }
        if (result.warning) {
            file.dashboardSyncStatus = result.warning;
        } else {
            file.dashboardSyncStatus = '';
        }
    } catch (err) {
        file.dashboardSyncStatus = err.message || 'dashboard open failed';
        return;
    }

    await syncDashboardTrackedBase(file);
}

async function applyDashboardToFile(file, dashboard, url) {
    if (!state.currentGit || !state.currentProjectPath) {
        file.dashboard = dashboard;
        file.url = url;
        return;
    }

    file.dashboard = dashboard;
    delete file.savedSearch;
    file.savedSearchSyncStatus = '';

    const result = await openDashboardHistory({
        git: state.currentGit,
        workspaceRoot: state.currentProjectPath,
        metadata: dashboard,
        restSettings: getSplunkRestSettings(url),
        remoteSettings: getGitRemoteSettings(),
        author: getGitAuthorFromSettings()
    });
    if (result.dashboard) {
        file.dashboard = result.dashboard;
    }
    if (result.warning) {
        file.dashboardSyncStatus = result.warning;
    }

    const viewPath = result.viewPath || getDashboardViewRelativePath(file.dashboard);
    const absoluteViewPath = path.join(state.currentProjectPath, viewPath);

    if (file.path !== absoluteViewPath) {
        ensureDirectoryExists(path.dirname(absoluteViewPath));
        if (fs.existsSync(file.path) && file.path !== absoluteViewPath) {
            try {
                fs.unlinkSync(file.path);
            } catch {
                // Best-effort cleanup of old URL pointer file.
            }
        }
        if (!fs.existsSync(absoluteViewPath) && result.viewSource === 'missing') {
            fs.writeFileSync(absoluteViewPath, '', 'utf8');
        }
        file.path = absoluteViewPath;
    }

    file.name = viewPath;
    file.url = url;
    updateTabLabel(file);
    updateExplorer();
    await syncDashboardTrackedBase(file);
    onQueryFileChanged(file.id, { refreshHistory: true });
}

module.exports = {
    attachHistorySyncDashboard,
    clearDashboardContext,
    resolveDashboardFromFile,
    syncDashboardTrackedBase,
    enterDashboardHistory,
    applyDashboardToFile,
};
