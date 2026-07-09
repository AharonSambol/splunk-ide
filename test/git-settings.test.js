const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
    DEFAULT_GIT_SYNC_SETTINGS,
    getSettingsFilePath,
    normalizeGitSyncSettings,
    readGitSyncSettings,
    writeGitSyncSettings
} = require('../lib/git-settings');

describe('normalizeGitSyncSettings', () => {
    it('returns defaults for empty input', () => {
        assert.deepEqual(normalizeGitSyncSettings(), { ...DEFAULT_GIT_SYNC_SETTINGS });
    });

    it('trims string fields and ignores unknown keys', () => {
        assert.deepEqual(
            normalizeGitSyncSettings({
                remoteUrl: ' https://example.com/repo.git ',
                remoteName: ' upstream ',
                sharedBranch: ' develop ',
                gitUserName: ' Ada ',
                gitUserEmail: ' ada@example.com ',
                password: 'secret',
                token: 'abc'
            }),
            {
                remoteUrl: 'https://example.com/repo.git',
                remoteName: 'upstream',
                sharedBranch: 'develop',
                gitUserName: 'Ada',
                gitUserEmail: 'ada@example.com'
            }
        );
    });

    it('restores default remote name and shared branch when blank', () => {
        assert.deepEqual(
            normalizeGitSyncSettings({ remoteName: '   ', sharedBranch: '' }),
            { ...DEFAULT_GIT_SYNC_SETTINGS }
        );
    });
});

describe('readGitSyncSettings / writeGitSyncSettings', () => {
    let userDataPath;

    beforeEach(() => {
        userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'splunk-ide-settings-'));
    });

    afterEach(() => {
        fs.rmSync(userDataPath, { recursive: true, force: true });
    });

    it('returns defaults when settings file is missing', () => {
        assert.deepEqual(readGitSyncSettings(userDataPath), { ...DEFAULT_GIT_SYNC_SETTINGS });
    });

    it('writes and reads settings from userData', () => {
        const input = {
            remoteUrl: 'https://git.example.com/team/history.git',
            remoteName: 'origin',
            sharedBranch: 'main',
            gitUserName: 'Splunk User',
            gitUserEmail: 'user@example.com'
        };

        const writeResult = writeGitSyncSettings(userDataPath, input);
        assert.deepEqual(writeResult, { ok: true });

        const filePath = getSettingsFilePath(userDataPath);
        assert.equal(fs.existsSync(filePath), true);
        assert.deepEqual(JSON.parse(fs.readFileSync(filePath, 'utf8')), input);
        assert.deepEqual(readGitSyncSettings(userDataPath), input);
    });

    it('treats blank remoteUrl as local-only', () => {
        const writeResult = writeGitSyncSettings(userDataPath, {
            remoteUrl: '',
            gitUserName: 'Local User'
        });
        assert.equal(writeResult.ok, true);
        assert.deepEqual(readGitSyncSettings(userDataPath), {
            ...DEFAULT_GIT_SYNC_SETTINGS,
            gitUserName: 'Local User'
        });
    });

    it('returns defaults when stored JSON is invalid', () => {
        const filePath = getSettingsFilePath(userDataPath);
        fs.writeFileSync(filePath, '{not json', 'utf8');
        assert.deepEqual(readGitSyncSettings(userDataPath), { ...DEFAULT_GIT_SYNC_SETTINGS });
    });

    it('rejects invalid write input', () => {
        assert.deepEqual(writeGitSyncSettings(userDataPath, null), {
            ok: false,
            message: 'settings must be an object'
        });
    });
});
