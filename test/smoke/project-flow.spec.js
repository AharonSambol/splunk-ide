'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('@playwright/test');
const {
    launchApp,
    closeApp,
    workspacePath,
    waitForAutoLoad,
} = require('./helpers/launch-app');

test.describe('Project and sidebar flows', () => {
    let electronApp;
    let userDataDir;

    test.afterEach(async () => {
        if (electronApp) {
            await closeApp(electronApp, userDataDir);
            electronApp = undefined;
            userDataDir = undefined;
        }
    });

    // The app auto-loads <userData>/searches and seeds 'Search 1' when empty;
    // the project header buttons are hidden UI, so flows run on that workspace.
    test('auto-loads the default workspace and seeds Search 1', async () => {
        ({ electronApp, userDataDir } = await launchApp());
        const window = await electronApp.firstWindow();

        await waitForAutoLoad(window);
        await expect(window.locator('#project-name')).toHaveText('searches');
        await expect(window.locator('.explorer-item .file-name', { hasText: 'Search 1' })).toBeVisible();
        expect(fs.existsSync(path.join(workspacePath(userDataDir), 'Search 1.spl'))).toBe(true);
        await expect(window.locator('#new-file-btn')).toBeEnabled();
    });

    test('creates a file that appears in the explorer', async () => {
        ({ electronApp, userDataDir } = await launchApp());
        const window = await electronApp.firstWindow();
        await waitForAutoLoad(window);
        await expect(window.locator('#new-file-btn')).toBeEnabled();

        await window.click('#new-file-btn');
        await window.click('#new-search-choice');
        await expect(window.locator('#new-file-modal.visible')).toBeVisible();
        await window.fill('#new-file-modal-input', 'smoke-search');
        await window.click('#new-file-create');

        await expect(window.locator('.explorer-item .file-name', { hasText: 'smoke-search' })).toBeVisible();

        const createdFilePath = path.join(workspacePath(userDataDir), 'smoke-search.spl');
        expect(fs.existsSync(createdFilePath)).toBe(true);
    });

    test('opens quick search overlay with double-shift', async () => {
        ({ electronApp, userDataDir } = await launchApp());
        const window = await electronApp.firstWindow();
        await waitForAutoLoad(window);
        await expect(window.locator('.explorer-item .file-name', { hasText: 'Search 1' })).toBeVisible();

        // Real Shift keypresses are forwarded via before-input-event ->
        // 'app-keydown' IPC, but only while the main frame (not a webview)
        // holds focus — which is unreliable under test. Send the same IPC
        // directly; the input filtering itself is unit-tested.
        await electronApp.evaluate(({ BrowserWindow }) => {
            const win = BrowserWindow.getAllWindows()[0];
            win.webContents.send('app-keydown', { key: 'Shift', code: 'ShiftLeft' });
            win.webContents.send('app-keydown', { key: 'Shift', code: 'ShiftRight' });
        });

        await expect(window.locator('#quick-search-overlay.visible')).toBeVisible();
        await window.fill('#quick-search-input', 'Search 1');
        await expect(window.locator('.quick-search-item', { hasText: 'Search 1' })).toBeVisible();
    });

    test('opens the git sync settings modal', async () => {
        ({ electronApp, userDataDir } = await launchApp());
        const window = await electronApp.firstWindow();
        await waitForAutoLoad(window);

        await window.click('#git-sync-settings-btn');

        await expect(window.locator('#git-sync-settings-modal.visible')).toBeVisible();
        await expect(window.locator('#git-sync-settings-modal-box input').first()).toBeVisible();
    });
});
