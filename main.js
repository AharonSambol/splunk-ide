if (require('electron-squirrel-startup')) return;

const { app, BrowserWindow, ipcMain, dialog, Menu, clipboard, webContents } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { createContextMenuTemplate } = require('./lib/main/context-menu');
const { findInPage, stopFindInPage } = require('./lib/main/find-in-page');
const { attachAppShortcuts } = require('./lib/main/app-shortcuts');
const { readGitSyncSettings, writeGitSyncSettings } = require('./lib/git-settings');

attachAppShortcuts({ app, BrowserWindow });

// app.whenReady().then(() => {
//   // Set your App User Model ID
//     app.setAppUserModelId("com.yourcompany.yourapp");
    
//     createWindow();
// });

ipcMain.handle('select-project-folder', async (event, options) => {
    return dialog.showOpenDialog(options);
});

ipcMain.handle('get-default-workspace', () => {
    const workspacePath = path.join(app.getPath('userData'), 'searches');
    fs.mkdirSync(workspacePath, { recursive: true });
    return workspacePath;
});

ipcMain.handle('get-git-sync-settings', () => {
    return readGitSyncSettings(app.getPath('userData'));
});

ipcMain.handle('set-git-sync-settings', (event, settings) => {
    return writeGitSyncSettings(app.getPath('userData'), settings);
});

ipcMain.handle('show-context-menu', async (event, info) => {
    const template = createContextMenuTemplate({
        info,
        clipboard,
        webContents,
        sender: event.sender
    });
    const menu = Menu.buildFromTemplate(template);
    const win = BrowserWindow.fromWebContents(event.sender);
    menu.popup({ window: win });
});

// Find in page for webview (renderer will pass webContentsId)
ipcMain.handle('find-in-page', (event, args) => {
    return findInPage({
        webContents,
        senderId: event.sender.id,
        args
    });
});

ipcMain.handle('stop-find-in-page', (event, args) => {
    return stopFindInPage({
        webContents,
        senderId: event.sender.id,
        args
    });
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
    // mainWindow.webContents.openDevTools();
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
