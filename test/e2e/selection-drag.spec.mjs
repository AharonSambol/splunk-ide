import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, _electron as electron } from '@playwright/test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '../..');
const harnessMain = path.join(repoRoot, 'test/harness/main.js');

test.describe('selection drag regression', () => {
    let app;

    test.afterEach(async () => {
        if (app) {
            await app.close();
            app = undefined;
        }
    });

    test('typing after mouseleave does not keep replacing selection', async () => {
        app = await electron.launch({ args: [harnessMain] });
        const page = await app.firstWindow();
        await page.waitForFunction(() => window.__harnessReady);

        const result = await page.evaluate(async () => {
            const view = document.getElementById('guest');
            await window.__harnessReady;

            await view.executeJavaScript(`window.__testResetEditor('index=sourcetype')`);
            await view.executeJavaScript(`window.__testSimulateStuckSelection(0, 6)`);

            const beforeCleanup = await view.executeJavaScript(`
                (() => {
                    window.__testType('xyz');
                    return {
                        text: window.__testGetEditorText(),
                        state: window.__testGetMouseHandlerState(),
                    };
                })()
            `);

            await view.executeJavaScript(`window.__testResetEditor('index=sourcetype')`);
            await view.executeJavaScript(`window.__testSimulateStuckSelection(0, 6)`);
            window.__harnessTriggerSelectionDragCleanup();

            const waitForCleanup = async () => {
                for (let attempt = 0; attempt < 50; attempt += 1) {
                    const state = await view.executeJavaScript('window.__testGetMouseHandlerState()');
                    if (state === '') return;
                    await new Promise((resolve) => setTimeout(resolve, 50));
                }
                throw new Error('selection drag cleanup did not run');
            };
            await waitForCleanup();

            const afterCleanup = await view.executeJavaScript(`
                (() => {
                    window.__testType('abc');
                    return {
                        text: window.__testGetEditorText(),
                        state: window.__testGetMouseHandlerState(),
                        selection: window.__testGetSelection(),
                    };
                })()
            `);

            return { beforeCleanup, afterCleanup };
        });

        expect(result.beforeCleanup.text).toBe('zsourcetype');
        expect(result.beforeCleanup.state).toBe('select');

        expect(result.afterCleanup.state).toBe('');
        expect(result.afterCleanup.selection.selectedText).toBe('');
        expect(result.afterCleanup.text).toBe('index=abcsourcetype');
    });
});
