'use strict';

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const os = require('node:os');
const { test, expect } = require('@playwright/test');
const { simpleGit } = require('simple-git');
const {
    REPO_ROOT,
    launchApp,
    closeApp,
    workspacePath,
    writeGitSyncSettings,
    waitForAutoLoad,
} = require('./helpers/launch-app');

// Saved-search .spl files get their URL rewritten onto the configured
// splunkUrl origin (withSplunkOrigin), so the webview can only ever reach a
// real http(s) endpoint. This suite points splunkUrl at a local HTTP server
// that serves the saved-search mock fixture for every GET.
// slugHostname keeps dots, so instance dir = '127.0.0.1'.
const CONF_PATH = '127.0.0.1/apps/search/local/savedsearches.conf';
const HEAD_CONF = `[Error Rate]
search = index=main
disabled = 0

`;

const FIXTURE_PATH = path.join(REPO_ROOT, 'test/fixtures/splunk-saved-search-mock.html');
const FIXTURE_HTML = fs.readFileSync(FIXTURE_PATH, 'utf8');

async function startFixtureServer() {
    const server = http.createServer((req, res) => {
        if (req.method === 'GET') {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(FIXTURE_HTML);
        } else {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end('{}');
        }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    return { server, splunkUrl: `http://127.0.0.1:${port}` };
}

async function seedWorkspaceProject(projectDir, splunkUrl) {
    const confAbsolute = path.join(projectDir, CONF_PATH);
    fs.mkdirSync(path.dirname(confAbsolute), { recursive: true });
    fs.writeFileSync(confAbsolute, HEAD_CONF, 'utf8');

    const git = simpleGit(projectDir);
    await git.init();
    await git.addConfig('user.name', 'Smoke Test');
    await git.addConfig('user.email', 'smoke@example.com');
    await git.add('.');
    await git.commit('Initial conf');

    // servicesNS form: isSplunkSearchRunnerPage matches s=%2FservicesNS%2F...
    const sParam = encodeURIComponent('/servicesNS/nobody/search/saved/searches/Error Rate');
    const splUrl = `${splunkUrl}/en-US/app/search/search?s=${sParam}`;
    fs.writeFileSync(path.join(projectDir, 'error-rate.spl'), `${splUrl}\n`);

    return git;
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
    let userDataDir;
    let server;

    test.afterEach(async () => {
        if (electronApp) {
            await closeApp(electronApp, userDataDir);
            electronApp = undefined;
            userDataDir = undefined;
        }
        if (server) {
            await new Promise(resolve => server.close(resolve));
            server = undefined;
        }
    });

    async function launchWithSeededWorkspace() {
        userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'splunk-ide-smoke-user-'));
        ({ server, splunkUrl } = await startFixtureServer());
        const ws = workspacePath(userDataDir);
        fs.mkdirSync(ws, { recursive: true });
        const git = await seedWorkspaceProject(ws, splunkUrl);
        writeGitSyncSettings(userDataDir, { splunkUrl });
        ({ electronApp } = await launchApp({ userDataDir }));
        const window = await electronApp.firstWindow();
        await waitForAutoLoad(window);
        return { window, git };
    }
    let splunkUrl;

    test('guest Cmd+S does not commit until Splunk REST save succeeds', async () => {
        const { window, git } = await launchWithSeededWorkspace();
        const commitsBefore = Number((await git.raw(['rev-list', '--count', 'HEAD'])).trim());

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

        await new Promise((resolve) => setTimeout(resolve, 1500));
        expect(Number((await git.raw(['rev-list', '--count', 'HEAD'])).trim())).toBe(commitsBefore);

        await window.evaluate(async () => {
            const view = document.querySelector('webview.active');
            await view.executeJavaScript('window.__testPressSaveShortcut()');
        });

        await expect.poll(async () => {
            const count = Number((await git.raw(['rev-list', '--count', 'HEAD'])).trim());
            return count;
        }, { timeout: 15_000 }).toBeGreaterThan(commitsBefore);

        const latestMessage = (await git.log({ maxCount: 1 })).latest?.message || '';
        expect(latestMessage).toContain('Splunk save');

        await expect.poll(async () => (await git.tags()).all.length, {
            timeout: 5_000,
        }).toBeGreaterThan(0);
    });

    test('Save dialog confirm in webview commits saved-search stanza', async () => {
        const { window, git } = await launchWithSeededWorkspace();
        const commitsBefore = Number((await git.raw(['rev-list', '--count', 'HEAD'])).trim());

        await openSavedSearchTab(window);
        await editGuestQuery(window, ' | stats count');
        await window.evaluate(async () => {
            const view = document.querySelector('webview.active');
            await view.executeJavaScript('window.__testConfirmSave()');
        });

        await expect.poll(async () => {
            const count = Number((await git.raw(['rev-list', '--count', 'HEAD'])).trim());
            return count;
        }, { timeout: 15_000 }).toBeGreaterThan(commitsBefore);
    });

    test('toolbar Save without dialog confirm does not commit', async () => {
        const { window, git } = await launchWithSeededWorkspace();
        const commitsBefore = Number((await git.raw(['rev-list', '--count', 'HEAD'])).trim());

        await openSavedSearchTab(window);
        await editGuestQuery(window, ' | stats count');
        await window.evaluate(async () => {
            const view = document.querySelector('webview.active');
            await view.executeJavaScript('window.__testClickSave()');
        });

        await new Promise((resolve) => setTimeout(resolve, 1500));
        expect(Number((await git.raw(['rev-list', '--count', 'HEAD'])).trim())).toBe(commitsBefore);
    });
});
