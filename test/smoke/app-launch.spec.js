'use strict';

const { test, expect } = require('@playwright/test');
const { launchApp, closeApp, waitForAutoLoad } = require('./helpers/launch-app');

test.describe('Electron app launch', () => {
    let electronApp;

    test.afterEach(async () => {
        if (electronApp) {
            await closeApp(electronApp);
            electronApp = undefined;
        }
    });

    test('launches, opens main window, and loads index.html shell', async () => {
        ({ electronApp } = await launchApp());
        const window = await electronApp.firstWindow();

        await expect(window).toHaveTitle('Splunk IDE');
        await expect(window.locator('#app-shell')).toBeVisible();
        await expect(window.locator('#sidebar')).toBeVisible();
        await expect(window.locator('#main-area')).toBeVisible();
        await expect(window.locator('#explorer')).toBeVisible();
    });

    test('shows core project and explorer controls', async () => {
        ({ electronApp } = await launchApp());
        const window = await electronApp.firstWindow();

        // The project header is hidden by design; the project buttons exist but are not shown.
        await expect(window.locator('#header')).toBeHidden();
        await expect(window.locator('#new-project-btn')).toHaveText('New Project');
        await expect(window.locator('#open-project-btn')).toHaveText('Open Project');
        await expect(window.locator('#new-file-btn')).toBeVisible();
        await expect(window.locator('#new-folder-btn')).toBeAttached();
        await expect(window.locator('#git-sync-settings-btn')).toBeAttached();
    });

    test('auto-loads the default workspace', async () => {
        ({ electronApp } = await launchApp());
        const window = await electronApp.firstWindow();

        // window.onload loads <userData>/searches and seeds 'Search 1' when empty.
        await waitForAutoLoad(window);
        await expect(window.locator('#project-name')).toHaveText('searches');
        await expect(window.locator('#new-file-btn')).toBeEnabled();
        await expect(window.locator('.explorer-item .file-name', { hasText: 'Search 1' })).toBeVisible();
    });
});
