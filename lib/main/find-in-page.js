'use strict';

function findInPage({ webContents, senderId, args }) {
    try {
        const { webContentsId, text, options } = args || {};
        const targetId = webContentsId || senderId;
        const wc = webContents.fromId(targetId);
        if (wc) {
            wc.findInPage(text || '', options || {});
            return { ok: true };
        }
    } catch (err) {
        console.error('find-in-page error', err);
    }
    return { ok: false };
}

function stopFindInPage({ webContents, senderId, args }) {
    try {
        const { webContentsId, action } = args || {};
        const targetId = webContentsId || senderId;
        const wc = webContents.fromId(targetId);
        if (wc) {
            wc.stopFindInPage(action || 'clearSelection');
            return { ok: true };
        }
    } catch (err) {
        console.error('stop-find-in-page error', err);
    }
    return { ok: false };
}

module.exports = { findInPage, stopFindInPage };
