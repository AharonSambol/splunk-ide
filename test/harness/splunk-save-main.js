const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { buildSplunkSaveInjectorSource } = require('../../lib/webview-splunk-save-hooks');

function createWindow() {
    const mainWindow = new BrowserWindow({
        width: 900,
        height: 700,
        webPreferences: {
            webviewTag: true,
            nodeIntegration: true,
            contextIsolation: false,
        },
    });

    mainWindow.removeMenu();
    mainWindow.loadFile(path.join(__dirname, 'splunk-save.html'));
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    app.quit();
});
