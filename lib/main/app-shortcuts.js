'use strict';

function keyName(input) {
    return String(input && input.key || '').toLowerCase();
}

function shouldForwardKey(input) {
    if (!input || input.type !== 'keyDown' || input.isComposing) {
        return false;
    }
    if (input.control || input.meta || input.alt) {
        return true;
    }
    const key = keyName(input);
    return key === 'shift' || key === 'escape';
}

function shouldInterceptShortcut(input) {
    if (!shouldForwardKey(input)) {
        return false;
    }
    const key = keyName(input);
    const ctrlOrMeta = !!(input.control || input.meta);
    if (ctrlOrMeta && (key === 'n' || key === 'f' || key === 'tab')) {
        return true;
    }
    if (ctrlOrMeta && input.shift && key === 'h') {
        return true;
    }
    return !!(input.alt && (key === 'arrowleft' || key === 'arrowright'));
}

function toKeyInfo(input) {
    return {
        key: input.key,
        code: input.code,
        ctrl: !!input.control,
        meta: !!input.meta,
        alt: !!input.alt,
        shift: !!input.shift
    };
}

function windowForContents(contents, BrowserWindow) {
    let current = contents;
    for (let n = 0; current && n < 8; n += 1) {
        const owner = typeof current.getOwnerBrowserWindow === 'function'
            ? current.getOwnerBrowserWindow()
            : null;
        const win = owner || BrowserWindow.fromWebContents(current);
        if (win && !win.isDestroyed()) {
            return win;
        }
        current = current.hostWebContents;
    }
    const focused = BrowserWindow.getFocusedWindow();
    if (focused && !focused.isDestroyed()) {
        return focused;
    }
    return BrowserWindow.getAllWindows().find(win => !win.isDestroyed()) || null;
}

function attachAppShortcuts({ app, BrowserWindow }) {
    app.on('web-contents-created', (_event, contents) => {
        contents.on('before-input-event', (event, input) => {
            if (!shouldForwardKey(input)) {
                return;
            }
            const type = typeof contents.getType === 'function' ? contents.getType() : '';
            if (type === 'remote') {
                return;
            }
            const win = windowForContents(contents, BrowserWindow);
            if (!win || win.isDestroyed() || !win.webContents || win.webContents.isDestroyed()) {
                return;
            }
            if (shouldInterceptShortcut(input)) {
                event.preventDefault();
            }
            win.webContents.send('app-keydown', toKeyInfo(input));
        });
    });
}

module.exports = {
    shouldForwardKey,
    shouldInterceptShortcut,
    toKeyInfo,
    windowForContents,
    attachAppShortcuts
};
