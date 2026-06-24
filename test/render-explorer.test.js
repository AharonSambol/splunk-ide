const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { buildFileTree } = require('../lib/file-tree');
const { renderExplorer, EMPTY_MESSAGE } = require('../lib/render-explorer');
const { createDocument, createContainer } = require('./helpers/dom');

const sampleFiles = [
    { id: 'f1', name: 'root-file' },
    { id: 'f2', name: 'queries/main' },
    { id: 'f3', name: 'queries/archive/old' },
];
const sampleFolders = ['queries', 'queries/archive'];

describe('renderExplorer', () => {
    it('renders empty state when tree is empty', () => {
        const document = createDocument();
        const container = createContainer(document, 'explorer');

        renderExplorer(container, { files: [], children: [] }, { activeFileId: null, isEmpty: true });

        assert.equal(container.children.length, 1);
        assert.equal(container.textContent, EMPTY_MESSAGE);
    });

    it('renders root files', () => {
        const document = createDocument();
        const container = createContainer(document, 'explorer');
        const tree = buildFileTree([{ id: 'f1', name: 'readme' }], []);

        renderExplorer(container, tree, { activeFileId: null, isEmpty: false });

        const rootLabel = container.querySelector('.folder-root');
        assert.ok(rootLabel);
        assert.equal(rootLabel.textContent, 'Search Files');

        const items = container.querySelectorAll('.explorer-item');
        assert.equal(items.length, 1);
        assert.equal(items[0].dataset.fileId, 'f1');
        assert.equal(items[0].querySelector('.file-name').textContent, 'readme');
    });

    it('renders nested folders', () => {
        const document = createDocument();
        const container = createContainer(document, 'explorer');
        const tree = buildFileTree(sampleFiles, sampleFolders);

        renderExplorer(container, tree, { activeFileId: null, isEmpty: false });

        const folders = container.querySelectorAll('details.folder');
        assert.equal(folders.length, 2);

        const queriesFolder = folders[0];
        assert.equal(queriesFolder.querySelector('summary span').textContent, 'queries');
        assert.equal(queriesFolder.querySelector('.explorer-item').dataset.fileId, 'f2');

        const archiveFolder = folders[1];
        assert.equal(archiveFolder.querySelector('summary span').textContent, 'archive');
        assert.equal(archiveFolder.querySelector('.explorer-item').dataset.fileId, 'f3');
    });

    it('marks active file', () => {
        const document = createDocument();
        const container = createContainer(document, 'explorer');
        const tree = buildFileTree(sampleFiles, sampleFolders);

        renderExplorer(container, tree, { activeFileId: 'f2', isEmpty: false });

        const activeItem = container.querySelector('.explorer-item.active');
        assert.ok(activeItem);
        assert.equal(activeItem.dataset.fileId, 'f2');
    });

    it('calls file click handler', () => {
        const document = createDocument();
        const container = createContainer(document, 'explorer');
        const tree = buildFileTree([{ id: 'f1', name: 'readme' }], []);
        let clickedId = null;

        renderExplorer(container, tree, { activeFileId: null, isEmpty: false }, {
            onFileClick: id => { clickedId = id; },
        });

        container.querySelector('.explorer-item').click();
        assert.equal(clickedId, 'f1');
    });

    it('calls delete and move handlers from action buttons', () => {
        const document = createDocument();
        const container = createContainer(document, 'explorer');
        const file = { id: 'f1', name: 'readme' };
        const tree = buildFileTree([file], []);
        const events = [];

        renderExplorer(container, tree, { activeFileId: null, isEmpty: false }, {
            onFileMove: f => events.push(['move', f.id]),
            onFileDelete: id => events.push(['delete', id]),
        });

        container.querySelector('.file-move').click();
        container.querySelector('.file-delete').click();
        assert.deepEqual(events, [['move', 'f1'], ['delete', 'f1']]);
    });

    it('calls folder delete handler', () => {
        const document = createDocument();
        const container = createContainer(document, 'explorer');
        const tree = buildFileTree([], ['queries']);
        let deletedPath = null;

        renderExplorer(container, tree, { activeFileId: null, isEmpty: false }, {
            onFolderDelete: path => { deletedPath = path; },
        });

        container.querySelector('.folder-actions button').click();
        assert.equal(deletedPath, 'queries');
    });
});
