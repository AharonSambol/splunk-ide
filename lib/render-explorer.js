'use strict';

const EMPTY_MESSAGE = 'No files yet. Create a new search file or folder.';

function renderFileNode(document, file, activeFileId, handlers) {
    const item = document.createElement('div');
    item.className = 'explorer-item';
    item.dataset.fileId = file.id;

    const label = document.createElement('span');
    label.className = 'file-name';
    label.textContent = file.displayName || file.name;

    const actions = document.createElement('span');
    actions.className = 'file-actions';

    const moveButton = document.createElement('button');
    moveButton.className = 'file-action file-move';
    moveButton.type = 'button';
    moveButton.textContent = 'Move';
    moveButton.addEventListener('click', event => {
        event.stopPropagation();
        handlers.onFileMove?.(file);
    });

    const deleteButton = document.createElement('button');
    deleteButton.className = 'file-action file-delete';
    deleteButton.type = 'button';
    deleteButton.textContent = 'Delete';
    deleteButton.addEventListener('click', event => {
        event.stopPropagation();
        handlers.onFileDelete?.(file.id);
    });

    actions.appendChild(moveButton);
    actions.appendChild(deleteButton);

    item.appendChild(label);
    item.appendChild(actions);
    item.addEventListener('click', () => handlers.onFileClick?.(file.id));
    item.addEventListener('dblclick', () => handlers.onFileDblClick?.(file));
    if (file.id === activeFileId) {
        item.classList.add('active');
    }
    return item;
}

function renderFolderNode(document, folder, activeFileId, handlers) {
    const details = document.createElement('details');
    details.className = 'folder';
    details.open = true;

    const summary = document.createElement('summary');

    const title = document.createElement('span');
    title.textContent = folder.name;
    summary.appendChild(title);

    const folderActions = document.createElement('span');
    folderActions.className = 'folder-actions';

    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.textContent = 'Delete';
    deleteButton.addEventListener('click', event => {
        event.stopPropagation();
        handlers.onFolderDelete?.(folder.path);
    });

    folderActions.appendChild(deleteButton);
    summary.appendChild(folderActions);
    details.appendChild(summary);

    const folderContents = document.createElement('div');
    folderContents.className = 'folder-contents';

    folder.files.forEach(file => {
        folderContents.appendChild(renderFileNode(document, file, activeFileId, handlers));
    });

    folder.children.forEach(child => {
        folderContents.appendChild(renderFolderNode(document, child, activeFileId, handlers));
    });

    details.appendChild(folderContents);
    return details;
}

function renderExplorer(container, tree, { activeFileId, isEmpty }, handlers = {}) {
    const document = container.ownerDocument;
    container.innerHTML = '';

    if (isEmpty) {
        const empty = document.createElement('div');
        empty.className = 'explorer-item';
        empty.textContent = EMPTY_MESSAGE;
        container.appendChild(empty);
        return;
    }

    const rootLabel = document.createElement('div');
    rootLabel.className = 'folder-root';
    rootLabel.textContent = 'Search Files';
    container.appendChild(rootLabel);

    tree.files.forEach(file => {
        container.appendChild(renderFileNode(document, file, activeFileId, handlers));
    });

    tree.children.forEach(folder => {
        container.appendChild(renderFolderNode(document, folder, activeFileId, handlers));
    });
}

module.exports = {
    renderExplorer,
    renderFileNode,
    renderFolderNode,
    EMPTY_MESSAGE,
};
