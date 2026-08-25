'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { getSavedSearchId } = require('../../lib/objects/saved-search-id');
const {
    IDE_FOLDERS_FILE,
    sanitizeFolderName,
    explorerIdForFile,
    normalizeIdeFolders,
    folderForId,
    createFolder,
    deleteFolder,
    setItemFolder,
    replaceItemId,
    pruneIdeFolders,
    toExplorerInput,
    readIdeFolders,
    writeIdeFolders,
} = require('../../lib/explorer/ide-folders');

const SEARCH = { instance: 'prod', app: 'search', owner: 'nobody', name: 'Error Rate' };
const SEARCH_ID = getSavedSearchId(SEARCH);

describe('sanitizeFolderName', () => {
    it('flattens slashes so folders stay one level', () => {
        assert.equal(sanitizeFolderName('  Alerts/on-call  '), 'Alerts-on-call');
    });
});

describe('explorerIdForFile', () => {
    it('uses saved-search identity when present', () => {
        assert.equal(explorerIdForFile({ name: 'bookmark', savedSearch: SEARCH }), SEARCH_ID);
    });

    it('falls back to the bookmark name', () => {
        assert.equal(explorerIdForFile({ name: 'adhoc' }), 'file:adhoc');
    });
});

describe('normalizeIdeFolders', () => {
    it('trims names, uniques ids, and keeps empty folders', () => {
        assert.deepEqual(
            normalizeIdeFolders({
                ' Alerts ': [' prod|search|nobody|Error Rate ', 'prod|search|nobody|Error Rate', ''],
                'On-call': [],
                '': ['x'],
            }),
            {
                Alerts: [SEARCH_ID],
                'On-call': [],
            }
        );
    });
});

describe('folder membership', () => {
    it('creates, assigns, moves to root, and deletes without dropping other folders', () => {
        let folders = createFolder({}, 'Alerts');
        folders = createFolder(folders, 'On-call');
        folders = setItemFolder(folders, SEARCH_ID, 'Alerts');
        assert.equal(folderForId(folders, SEARCH_ID), 'Alerts');

        folders = setItemFolder(folders, SEARCH_ID, '');
        assert.equal(folderForId(folders, SEARCH_ID), '');
        assert.deepEqual(folders.Alerts, []);
        assert.deepEqual(folders['On-call'], []);

        folders = deleteFolder(folders, 'Alerts');
        assert.deepEqual(folders, { 'On-call': [] });
    });

    it('rewrites a bookmark id after it becomes a saved search', () => {
        const folders = replaceItemId(
            { Alerts: ['file:bookmark'] },
            'file:bookmark',
            SEARCH_ID
        );
        assert.deepEqual(folders, { Alerts: [SEARCH_ID] });
    });

    it('drops ids that are no longer in the explorer', () => {
        assert.deepEqual(
            pruneIdeFolders({ Alerts: [SEARCH_ID, 'gone'], Empty: [] }, [SEARCH_ID]),
            { Alerts: [SEARCH_ID], Empty: [] }
        );
    });
});

describe('toExplorerInput', () => {
    it('groups by the map, not the .spl path', () => {
        const files = [
            { id: '1', name: 'saved-searches/prod/error-rate', savedSearch: SEARCH },
            { id: '2', name: 'adhoc' },
        ];
        const { fileList, folderList } = toExplorerInput(files, { Alerts: [SEARCH_ID] });
        assert.deepEqual(folderList, ['Alerts']);
        assert.equal(fileList[0].name, 'Alerts/error-rate');
        assert.equal(fileList[1].name, 'adhoc');
    });
});

describe('readIdeFolders / writeIdeFolders', () => {
    let dir;

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ide-folders-'));
    });

    afterEach(() => {
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('round-trips json in the project root', () => {
        writeIdeFolders(dir, { Alerts: [SEARCH_ID] });
        assert.equal(fs.existsSync(path.join(dir, IDE_FOLDERS_FILE)), true);
        assert.deepEqual(readIdeFolders(dir), { Alerts: [SEARCH_ID] });
    });

    it('returns empty map when the file is missing', () => {
        assert.deepEqual(readIdeFolders(dir), {});
    });
});
