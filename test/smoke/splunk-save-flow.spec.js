'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('@playwright/test');
const { simpleGit } = require('simple-git');
const {
    REPO_ROOT,
    launchApp,
    closeApp,
    createTempProjectDir,
    removeTempDir,
    mockProjectFolderDialog,
} = require('./helpers/launch-app');

const CONF_PATH = 'unknown-instance/apps/search/local/savedsearches.conf';
const HEAD_CONF = `[Error Rate]
search = index=main
disabled = 0

`;

function savedSearchFixtureUrl(fixturePath) {
    const sParam = encodeURIComponent('[nobody:search:Error Rate]');
    return `file://${fixturePath}?s=${sParam}`;
}

async function setupSavedSearchProject(projectPath) {
    const confAbsolute = path.join(projectPath, CONF_PATH);
    fs.mkdirSync(path.dirname(confAbsolute), { recursive: true });
    fs.writeFileSync(confAbsolute, HEAD_CONF, 'utf8');

    const git = simpleGit(projectPath);
    await git.init();
    await git.addConfig('user.name', 'Smoke Test');
    await git.addConfig('user.email', 'smoke@example.com');
    await git.add('.');
    await git.commit('Initial conf');

    const fixturePath = path.join(REPO_ROOT, 'test/fixtures/splunk-saved-search-mock.html');
    const splUrl = savedSearchFixtureUrl(fixturePath);
    fs.writeFileSync(path.join(projectPath, 'error-rate.spl'), splUrl, 'utf8');

    return git;
}

async function openProject(window, electronApp, projectPath) {
    await mockProjectFolderDialog(electronApp, projectPath);
    await window.evaluate(() => {
        const header = document.getElementById('header');
        if (header) {
            header.hidden = false;
        }
        document.getElementById('open-project-btn').click();
    });
    await expect(window.locator('#project-name')).toHaveText(path.basename(projectPath));
}

async function waitForGuestHooks(window) {
    await expect.poll(async () => window.evaluate(async () => {
        const view = document.querySelector('webview.active');
        if (!view?.executeJavaScript) {
            return false;
        }
        return view.executeJavaScript(
            'Boolean(window.__splunkIdeHost?.splunkSave && window.__splunkIdeSaveHooks)'
        );
    }), { timeout: 15_000 }).toBe(true);
}

async function openSavedSearchTab(window) {
    await window.locator('.explorer-item .file-name', { hasText: 'error-rate' }).click();
    await window.waitForFunction(() => {
        const view = document.querySelector('webview.active');
        return Boolean(view?.getURL?.());
    }, undefined, { timeout: 15_000 });
    await waitForGuestHooks(window);
}

async function editGuestQuery(window, suffix) {
    await window.evaluate(async (editSuffix) => {
        const view = document.querySelector('webview.active');
        await view.executeJavaScript(`window.__testType(${JSON.stringify(editSuffix)})`);
    }, suffix);
}

test.describe('Splunk save IPC and git commit', () => {
    let electronApp;
    let tempProjectPath;
    let userDataDir;

    test.afterEach(async () => {
        if (electronApp) {
            await closeApp(electronApp, userDataDir);
            electronApp = undefined;
            userDataDir = undefined;
        }
        removeTempDir(tempProjectPath);
        tempProjectPath = undefined;
    });

    test('guest Cmd+S commits and tags saved-search stanza', async () => {
        tempProjectPath = createTempProjectDir();
        const git = await setupSavedSearchProject(tempProjectPath);
        const commitsBefore = Number((await git.raw(['rev-list', '--count', 'HEAD'])).trim());

        ({ electronApp, userDataDir } = await launchApp());
        const window = await electronApp.firstWindow();

        await openProject(window, electronApp, tempProjectPath);
        await openSavedSearchTab(window);
        await editGuestQuery(window, ' | stats count');

        await window.evaluate(async () => {
            const view = document.querySelector('webview.active');
            await view.executeJavaScript(`
                window.dispatchEvent(new KeyboardEvent('keydown', {
                    key: 's',
                    metaKey: ${process.platform === 'darwin'},
                    ctrlKey: ${process.platform !== 'darwin'},
                    bubbles: true
                }));
            `);
        });

        await expect.poll(async () => {
            const count = Number((await git.raw(['rev-list', '--count', 'HEAD'])).trim());
            return count;
        }, { timeout: 15_000 }).toBeGreaterThan(commitsBefore);

        const latestMessage = (await git.log({ maxCount: 1 })).latest?.message || '';
        expect(latestMessage).toContain('Splunk save');

        const tags = await git.tags();
        expect(tags.all.length).toBeGreaterThan(0);
    });

    test('Save button in webview commits saved-search stanza', async () => {
        tempProjectPath = createTempProjectDir();
        const git = await setupSavedSearchProject(tempProjectPath);
        const commitsBefore = Number((await git.raw(['rev-list', '--count', 'HEAD'])).trim());

        ({ electronApp, userDataDir } = await launchApp());
        const window = await electronApp.firstWindow();

        await openProject(window, electronApp, tempProjectPath);
        await openSavedSearchTab(window);
        await editGuestQuery(window, ' | stats count');
        await window.evaluate(async () => {
            const view = document.querySelector('webview.active');
            await view.executeJavaScript('window.__testClickSave()');
        });

        await expect.poll(async () => {
            const count = Number((await git.raw(['rev-list', '--count', 'HEAD'])).trim());
            return count;
        }, { timeout: 15_000 }).toBeGreaterThan(commitsBefore);
    });
});
