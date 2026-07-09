const fs = require('node:fs');
const path = require('node:path');

const SETTINGS_FILE_NAME = 'git-sync-settings.json';

const DEFAULT_GIT_SYNC_SETTINGS = Object.freeze({
    remoteUrl: '',
    remoteName: 'origin',
    sharedBranch: 'main',
    gitUserName: '',
    gitUserEmail: ''
});

function getSettingsFilePath(userDataPath) {
    return path.join(userDataPath, SETTINGS_FILE_NAME);
}

function normalizeGitSyncSettings(input = {}) {
    const settings = {};
    for (const key of Object.keys(DEFAULT_GIT_SYNC_SETTINGS)) {
        const value = input[key];
        settings[key] = value == null ? DEFAULT_GIT_SYNC_SETTINGS[key] : String(value).trim();
    }
    if (!settings.remoteName) {
        settings.remoteName = DEFAULT_GIT_SYNC_SETTINGS.remoteName;
    }
    if (!settings.sharedBranch) {
        settings.sharedBranch = DEFAULT_GIT_SYNC_SETTINGS.sharedBranch;
    }
    return settings;
}

function readGitSyncSettings(userDataPath) {
    const filePath = getSettingsFilePath(userDataPath);
    if (!fs.existsSync(filePath)) {
        return { ...DEFAULT_GIT_SYNC_SETTINGS };
    }

    try {
        const raw = fs.readFileSync(filePath, 'utf8');
        const parsed = JSON.parse(raw);
        return normalizeGitSyncSettings(parsed);
    } catch {
        return { ...DEFAULT_GIT_SYNC_SETTINGS };
    }
}

function writeGitSyncSettings(userDataPath, input) {
    if (!userDataPath) {
        return { ok: false, message: 'user data path is required' };
    }
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
        return { ok: false, message: 'settings must be an object' };
    }

    const settings = normalizeGitSyncSettings(input);
    const filePath = getSettingsFilePath(userDataPath);

    try {
        fs.mkdirSync(userDataPath, { recursive: true });
        fs.writeFileSync(filePath, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
        return { ok: true };
    } catch (error) {
        return { ok: false, message: error.message || String(error) };
    }
}

module.exports = {
    SETTINGS_FILE_NAME,
    DEFAULT_GIT_SYNC_SETTINGS,
    getSettingsFilePath,
    normalizeGitSyncSettings,
    readGitSyncSettings,
    writeGitSyncSettings
};
