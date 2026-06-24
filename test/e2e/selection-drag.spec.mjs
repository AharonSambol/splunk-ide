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

    test('clicking outside the webview clears Ace selection', async () => {
        app = await electron.launch({ args: [harnessMain] });
        const page = await app.firstWindow();

        await page.waitForFunction(() => window.__harnessReady);

        const afterOutsideClick = await page.evaluate(async () => {
            const guest = document.getElementById('guest');
            await window.__harnessReady;
            await guest.executeJavaScript(`window.__testResetEditor('index=sourcetype')`);
            await guest.executeJavaScript(`window.__testSetIdleSelection(0, 6)`);

            const before = await guest.executeJavaScript(`window.__testGetSelection()`);
            document.getElementById('outside').dispatchEvent(new MouseEvent('mousedown', {
                bubbles: true,
                cancelable: true,
            }));

            await new Promise((resolve) => setTimeout(resolve, 50));
            const after = await guest.executeJavaScript(`window.__testGetSelection()`);
            return { before, after };
        });

        expect(afterOutsideClick.before.selectedText).toBe('index=');
        expect(afterOutsideClick.after.selectedText).toBe('');
    });

    test('clicking Ace collapses an existing selection', async () => {
        app = await electron.launch({ args: [harnessMain] });
        const page = await app.firstWindow();

        await page.waitForFunction(() => window.__harnessReady);
        const view = page.locator('#guest');

        const selection = await view.evaluate(async () => {
            await window.__harnessReady;
            const guest = document.getElementById('guest');
            await guest.executeJavaScript(`window.__testResetEditor('index=sourcetype')`);
            await guest.executeJavaScript(`window.__testSetIdleSelection(0, 6)`);
            return guest.executeJavaScript(`window.__testGetSelection()`);
        });

        expect(selection.selectedText).toBe('index=');

        const afterClick = await view.evaluate(async () => {
            const guest = document.getElementById('guest');
            return guest.executeJavaScript(`window.__testSimulateClickAt(10)`);
        });

        expect(afterClick.selectedText).toBe('');
        expect(afterClick.start).toBe(10);
        expect(afterClick.end).toBe(10);
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
            await view.executeJavaScript(`
                window.__testSimulateStuckSelection(0, 6);
                window.__splunkIdeDragInProgress = true;
            `);
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
