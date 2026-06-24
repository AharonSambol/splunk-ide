if (require('electron-squirrel-startup')) return;

// const squirrel_app = require('app');

// if (handleSquirrelEvent()) {
//     // squirrel event handled and app will exit in 1000ms, so don't do anything else
//     return;
// }

// function handleSquirrelEvent() {
//     if (process.argv.length === 1) {
//         return false;
//     }

//     const ChildProcess = require('child_process');
//     const path = require('path');

//     const appFolder = path.resolve(process.execPath, '..');
//     const rootAtomFolder = path.resolve(appFolder, '..');
//     const updateDotExe = path.resolve(path.join(rootAtomFolder, 'Update.exe'));
//     const exeName = path.basename(process.execPath);

//     const spawn = function (command, args) {
//         let spawnedProcess, error;

//         try {
//             spawnedProcess = ChildProcess.spawn(command, args, { detached: true });
//         } catch (error) { }

//         return spawnedProcess;
//     };

//     const spawnUpdate = function (args) {
//         return spawn(updateDotExe, args);
//     };

//     const squirrelEvent = process.argv[1];
//     switch (squirrelEvent) {
//         case '--squirrel-install':
//         case '--squirrel-updated':
//             // Optionally do things such as:
//             // - Add your .exe to the PATH
//             // - Write to the registry for things like file associations and
//             //   explorer context menus

//             // Install desktop and start menu shortcuts
//             spawnUpdate(['--createShortcut', exeName]);

//             setTimeout(squirrel_app.quit, 1000);
//             return true;

//         case '--squirrel-uninstall':
//             // Undo anything you did in the --squirrel-install and
//             // --squirrel-updated handlers

//             // Remove desktop and start menu shortcuts
//             spawnUpdate(['--removeShortcut', exeName]);

//             setTimeout(squirrel_app.quit, 1000);
//             return true;

//         case '--squirrel-obsolete':
//             // This is called on the outgoing version of your app before
//             // we update to the new version - it's the opposite of
//             // --squirrel-updated

//             squirrel_app.quit();
//             return true;
//     }
// };



const { app, BrowserWindow, ipcMain, dialog, Menu, clipboard, webContents } = require('electron');
const path = require('node:path');
const { createContextMenuTemplate } = require('./lib/main/context-menu');
const { findInPage, stopFindInPage } = require('./lib/main/find-in-page');

// app.whenReady().then(() => {
//   // Set your App User Model ID
//     app.setAppUserModelId("com.yourcompany.yourapp");
    
//     createWindow();
// });

ipcMain.handle('select-project-folder', async (event, options) => {
    return dialog.showOpenDialog(options);
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