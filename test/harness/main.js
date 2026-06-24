const { app, BrowserWindow } = require('electron');
const path = require('node:path');

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
    mainWindow.loadFile(path.join(__dirname, 'index.html'));
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    app.quit();
});
