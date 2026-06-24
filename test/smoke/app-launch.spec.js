'use strict';

const { test, expect } = require('@playwright/test');
const { launchApp, closeApp } = require('./helpers/launch-app');

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

        await expect(window.locator('#new-project-btn')).toBeVisible();
        await expect(window.locator('#new-project-btn')).toHaveText('New Project');
        await expect(window.locator('#open-project-btn')).toBeVisible();
        await expect(window.locator('#open-project-btn')).toHaveText('Open Project');
        await expect(window.locator('#new-file-btn')).toBeVisible();
        await expect(window.locator('#new-folder-btn')).toBeVisible();
        await expect(window.locator('.sidebar-tab[data-view="git"]')).toHaveText('Source Control');
    });

    test('starts with no project loaded', async () => {
        ({ electronApp } = await launchApp());
        const window = await electronApp.firstWindow();

        await expect(window.locator('#project-name')).toHaveText('No project loaded');
        await expect(window.locator('#new-file-btn')).toBeDisabled();
        await expect(window.locator('#new-folder-btn')).toBeDisabled();
    });
});
