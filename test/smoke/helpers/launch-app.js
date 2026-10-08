'use strict';

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { _electron: electron } = require('@playwright/test');

const REPO_ROOT = path.resolve(__dirname, '../../..');

async function launchApp(options = {}) {
    const userDataDir = options.userDataDir
        || fs.mkdtempSync(path.join(os.tmpdir(), 'splunk-ide-smoke-user-'));
    const electronApp = await electron.launch({
        executablePath: require('electron'),
        args: [
            path.join(REPO_ROOT, 'main.js'),
            `--user-data-dir=${userDataDir}`,
        ],
        cwd: REPO_ROOT,
        env: {
            ...process.env,
            ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
            ...(options.env || {}),
        },
        ...options.launchOptions,
    });

    const window = await electronApp.firstWindow();
    await window.waitForLoadState('domcontentloaded');

    return { electronApp, window, userDataDir };
}

function createTempProjectDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'splunk-ide-smoke-'));
}

function removeTempDir(dirPath) {
    if (dirPath && fs.existsSync(dirPath)) {
        fs.rmSync(dirPath, { recursive: true, force: true });
    }
}

async function mockProjectFolderDialog(electronApp, folderPath) {
    await electronApp.evaluate(({ dialog }, projectPath) => {
        dialog.showOpenDialog = async () => ({
            canceled: false,
            filePaths: [projectPath],
        });
    }, folderPath);
}

async function closeApp(electronApp, userDataDir) {
    await electronApp.close();
    if (userDataDir && fs.existsSync(userDataDir)) {
        fs.rmSync(userDataDir, { recursive: true, force: true });
    }
}

// The app always auto-loads <userDataDir>/searches at startup and creates
// 'Search 1' when the workspace is empty. Seed files there before launch.
function workspacePath(userDataDir) {
    return path.join(userDataDir, 'searches');
}

function writeGitSyncSettings(userDataDir, settings) {
    fs.writeFileSync(
        path.join(userDataDir, 'git-sync-settings.json'),
        JSON.stringify(settings)
    );
}

async function waitForAutoLoad(window) {
    await window.waitForFunction(
        () => document.getElementById('project-name').textContent !== 'No project loaded',
        undefined,
        { timeout: 15_000 }
    );
}

module.exports = {
    REPO_ROOT,
    launchApp,
    createTempProjectDir,
    removeTempDir,
    mockProjectFolderDialog,
    workspacePath,
    writeGitSyncSettings,
    waitForAutoLoad,
    closeApp,
};
