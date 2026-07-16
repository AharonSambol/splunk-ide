'use strict';

const path = require('node:path');
const { test, expect } = require('@playwright/test');
const { _electron: electron } = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');

const HARNESS_ROOT = path.join(__dirname, '../harness');

test.describe('Splunk save webview harness', () => {
    let electronApp;
    let userDataDir;

    test.afterEach(async () => {
        if (electronApp) {
            await electronApp.close();
        }
        if (userDataDir && fs.existsSync(userDataDir)) {
            fs.rmSync(userDataDir, { recursive: true, force: true });
        }
    });

    async function launchHarness() {
        userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'splunk-ide-save-harness-'));
        electronApp = await electron.launch({
            executablePath: require('electron'),
            args: [
                path.join(HARNESS_ROOT, 'splunk-save-main.js'),
                `--user-data-dir=${userDataDir}`,
            ],
            cwd: path.join(HARNESS_ROOT, '../..'),
        });
        const window = await electronApp.firstWindow();
        await window.waitForFunction(() => window.__harnessReady);
        return window;
    }

    test('guest bridge receives Cmd+S and forwards splunk-save IPC', async () => {
        const window = await launchHarness();

        await expect.poll(async () => window.evaluate(async () => {
            const view = document.getElementById('guest');
            return view.executeJavaScript(
                'Boolean(window.__splunkIdeHost?.splunkSave && window.__splunkIdeSaveHooks)'
            );
        })).toBe(true);

        await window.evaluate(async () => {
            const view = document.getElementById('guest');
            await view.executeJavaScript(`
                window.dispatchEvent(new KeyboardEvent('keydown', {
                    key: 's',
                    metaKey: ${process.platform === 'darwin'},
                    ctrlKey: ${process.platform !== 'darwin'},
                    bubbles: true
                }));
            `);
        });

        await expect.poll(async () => window.evaluate(() => window.__splunkSaveEvents)).toContain('splunk-save');
    });

    test('guest Save button forwards splunk-save IPC', async () => {
        const window = await launchHarness();

        await window.evaluate(async () => {
            const view = document.getElementById('guest');
            await view.executeJavaScript('window.__testClickSave()');
        });

        await expect.poll(async () => window.evaluate(() => window.__splunkSaveEvents), {
            timeout: 5_000,
        }).toContain('splunk-save');
    });
});
