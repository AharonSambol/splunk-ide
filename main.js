const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('node:path');

ipcMain.handle('select-project-folder', async (event, options) => {
    return dialog.showOpenDialog(options);
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