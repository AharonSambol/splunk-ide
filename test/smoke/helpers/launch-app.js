'use strict';

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { _electron: electron } = require('@playwright/test');

const REPO_ROOT = path.resolve(__dirname, '../../..');

async function launchApp(options = {}) {
    const electronApp = await electron.launch({
        executablePath: require('electron'),
        args: [path.join(REPO_ROOT, 'main.js')],
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

    return { electronApp, window };
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

async function closeApp(electronApp) {
    await electronApp.close();
}

module.exports = {
    REPO_ROOT,
    launchApp,
    createTempProjectDir,
    removeTempDir,
    mockProjectFolderDialog,
    closeApp,
};
