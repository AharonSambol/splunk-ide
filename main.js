const { app, BrowserWindow, ipcMain, dialog, Menu, clipboard } = require('electron');
const path = require('node:path');

ipcMain.handle('select-project-folder', async (event, options) => {
    return dialog.showOpenDialog(options);
});

ipcMain.handle('show-context-menu', async (event, info) => {
    const template = [];
    if (info.selection && info.selection.length > 0) {
        template.push({
            label: 'Copy',
            click: () => {
                try { 
                    
                    console.log('Copying to clipboard:', info.selection, info.selection.length);
                    clipboard.writeText(info.selection);
                } catch (err) {
                    console.error('Copy error', err);
                }
            }
        });
    }

    // Paste option (only if clipboard has text)
    try {
        const clipText = clipboard.readText();
        if (clipText && clipText.length > 0) {
            template.push({
                label: 'Paste',
                click: () => {
                    try {
                        if (info && info.webContentsId) {
                            const wc = require('electron').webContents.fromId(info.webContentsId);
                            if (wc && typeof wc.paste === 'function') {
                                wc.paste();
                                return;
                            }
                        }
                        // Fallback: ask renderer to paste provided text into active webview
                        event.sender.send('context-menu-command', { command: 'paste', text: clipText });
                    } catch (err) {
                        console.error('Paste error', err);
                    }
                }
            });
        }
    } catch (err) {
        // ignore clipboard read errors
    }

    template.push({
        label: 'Select All',
        click: () => {
            try {
                if (info && info.webContentsId) {
                    const wc = require('electron').webContents.fromId(info.webContentsId);
                    if (wc && typeof wc.selectAll === 'function') {
                        wc.selectAll();
                        return;
                    }
                }
                event.sender.send('context-menu-command', { command: 'selectAll' });
            } catch (err) {
                console.error('Select All error', err);
            }
        }
    });
    
    const menu = Menu.buildFromTemplate(template);
    const win = BrowserWindow.fromWebContents(event.sender);
    menu.popup({ window: win });
});

// Find in page for webview (renderer will pass webContentsId)
ipcMain.handle('find-in-page', (event, args) => {
    try {
        const { webContentsId, text, options } = args || {};
        const targetId = webContentsId || event.sender.id;
        const wc = require('electron').webContents.fromId(targetId);
        if (wc) {
            wc.findInPage(text || '', options || {});
            return { ok: true };
        }
    } catch (err) {
        console.error('find-in-page error', err);
    }
    return { ok: false };
});

ipcMain.handle('stop-find-in-page', (event, args) => {
    try {
        const { webContentsId, action } = args || {};
        const targetId = webContentsId || event.sender.id;
        const wc = require('electron').webContents.fromId(targetId);
        if (wc) {
            wc.stopFindInPage(action || 'clearSelection');
            return { ok: true };
        }
    } catch (err) {
        console.error('stop-find-in-page error', err);
    }
    return { ok: false };
});

function createWindow() {
    const mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
            webviewTag: true,
            nodeIntegration: true,
            contextIsolation: false
        },
        icon: path.join(__dirname, "build", "icon.ico"),
    });
    mainWindow.webContents.openDevTools();
    mainWindow.maximize();
    mainWindow.removeMenu();
    mainWindow.loadFile('index.html');
}

app.whenReady().then(() => {
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});