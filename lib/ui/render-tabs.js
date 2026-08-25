'use strict';

function createTabElement(document, file, activeFileId, handlers = {}) {
    const tab = document.createElement('div');
    tab.className = 'tab';
    tab.dataset.targetId = file.id;
    tab.draggable = true;

    if (file.id === activeFileId) {
        tab.classList.add('active');
    }

    const title = document.createElement('span');
    title.className = 'tab-title';
    title.textContent = file.name.split('/').pop();

    const closeButton = document.createElement('button');
    closeButton.className = 'tab-close';
    closeButton.type = 'button';
    closeButton.innerText = '×';
    closeButton.addEventListener('click', event => {
        event.stopPropagation();
        handlers.onClose?.(file.id);
    });

    tab.appendChild(title);
    tab.appendChild(closeButton);
    tab.addEventListener('click', () => handlers.onSwitch?.(file.id));

    return tab;
}

function renderTabs(container, files, activeFileId, handlers = {}) {
    const document = container.ownerDocument;
    container.innerHTML = '';
    files.forEach(file => {
        container.appendChild(createTabElement(document, file, activeFileId, handlers));
    });
}

function setActiveTab(container, activeFileId) {
    container.querySelectorAll('.tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.targetId === activeFileId);
    });
}

function updateTabTitle(container, fileId, fileName) {
    const tab = container.querySelector(`.tab[data-target-id="${fileId}"]`);
    if (!tab) {
        return;
    }
    const title = tab.querySelector('.tab-title');
    if (title) {
        title.textContent = fileName.split('/').pop();
    }
}

module.exports = {
    createTabElement,
    renderTabs,
    setActiveTab,
    updateTabTitle,
};
