'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('@playwright/test');
const {
    launchApp,
    closeApp,
    createTempProjectDir,
    removeTempDir,
    mockProjectFolderDialog,
} = require('./helpers/launch-app');

test.describe('Project and sidebar flows', () => {
    let electronApp;
    let tempProjectPath;

    test.afterEach(async () => {
        if (electronApp) {
            await closeApp(electronApp);
            electronApp = undefined;
        }
        removeTempDir(tempProjectPath);
        tempProjectPath = undefined;
    });

    test('creates a temp project via mocked folder dialog', async () => {
        tempProjectPath = createTempProjectDir();
        ({ electronApp } = await launchApp());
        const window = await electronApp.firstWindow();

        await mockProjectFolderDialog(electronApp, tempProjectPath);
        await window.click('#new-project-btn');

        await expect(window.locator('#project-name')).toHaveText(path.basename(tempProjectPath));
        await expect(window.locator('#new-file-btn')).toBeEnabled();
        await expect(window.locator('#new-folder-btn')).toBeEnabled();
    });

    test('creates a file that appears in the explorer', async () => {
        tempProjectPath = createTempProjectDir();
        ({ electronApp } = await launchApp());
        const window = await electronApp.firstWindow();

        await mockProjectFolderDialog(electronApp, tempProjectPath);
        await window.click('#new-project-btn');
        await expect(window.locator('#new-file-btn')).toBeEnabled();

        await window.click('#new-file-btn');
        await expect(window.locator('#new-file-modal.visible')).toBeVisible();
        await window.fill('#new-file-modal-input', 'smoke-search');
        await window.click('#new-file-create');

        await expect(window.locator('.explorer-item .file-name', { hasText: 'smoke-search' })).toBeVisible();

        const createdFilePath = path.join(tempProjectPath, 'smoke-search.spl');
        expect(fs.existsSync(createdFilePath)).toBe(true);
    });

    test('opens quick search overlay with double-shift', async () => {
        tempProjectPath = createTempProjectDir();
        ({ electronApp } = await launchApp());
        const window = await electronApp.firstWindow();

        await mockProjectFolderDialog(electronApp, tempProjectPath);
        await window.click('#new-project-btn');
        await window.click('#new-file-btn');
        await window.fill('#new-file-modal-input', 'quick-search-target');
        await window.click('#new-file-create');
        await expect(window.locator('.explorer-item .file-name', { hasText: 'quick-search-target' })).toBeVisible();

        await window.keyboard.press('Shift');
        await window.keyboard.press('Shift');

        await expect(window.locator('#quick-search-overlay.visible')).toBeVisible();
        await window.fill('#quick-search-input', 'quick-search-target');
        await expect(window.locator('.quick-search-item', { hasText: 'quick-search-target' })).toBeVisible();
    });

    test('loads the git panel without crashing', async () => {
        tempProjectPath = createTempProjectDir();
        ({ electronApp } = await launchApp());
        const window = await electronApp.firstWindow();

        await mockProjectFolderDialog(electronApp, tempProjectPath);
        await window.click('#new-project-btn');
        await window.click('.sidebar-tab[data-view="git"]');

        await expect(window.locator('#git-view.active')).toBeVisible();
        await expect(window.locator('#git-changes-tab.active')).toBeVisible();
        await expect(window.locator('#git-commit')).toBeVisible();
        await expect(window.locator('#git-status')).toBeVisible();
        await expect(window.locator('#git-status .git-file-item, #git-status div')).toHaveCount(1, {
            timeout: 15_000,
        });
    });
});
