'use strict';

function createContextMenuTemplate({ info, clipboard, webContents, sender }) {
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

    let clipText = '';
    try {
        clipText = clipboard.readText();
    } catch (err) {
        // ignore clipboard read errors
    }

    if (clipText && clipText.length > 0) {
        template.push({
            label: 'Paste',
            click: () => {
                try {
                    if (info && info.webContentsId) {
                        const wc = webContents.fromId(info.webContentsId);
                        if (wc && typeof wc.paste === 'function') {
                            wc.paste();
                            return;
                        }
                    }
                    sender.send('context-menu-command', { command: 'paste', text: clipText });
                } catch (err) {
                    console.error('Paste error', err);
                }
            }
        });
    }

    template.push({
        label: 'Select All',
        click: () => {
            try {
                if (info && info.webContentsId) {
                    const wc = webContents.fromId(info.webContentsId);
                    if (wc && typeof wc.selectAll === 'function') {
                        wc.selectAll();
                        return;
                    }
                }
                sender.send('context-menu-command', { command: 'selectAll' });
            } catch (err) {
                console.error('Select All error', err);
            }
        }
    });

    return template;
}

module.exports = { createContextMenuTemplate };
