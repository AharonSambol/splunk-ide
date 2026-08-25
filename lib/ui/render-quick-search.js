'use strict';

function renderQuickSearchResults(container, { results, selectedIndex, mode, emptyMessage }, handlers = {}) {
    const document = container.ownerDocument;
    container.innerHTML = '';

    if (results.length === 0) {
        const empty = document.createElement('div');
        empty.id = 'quick-search-empty';
        empty.textContent = emptyMessage;
        container.appendChild(empty);
        return;
    }

    results.forEach((file, index) => {
        const item = document.createElement('div');
        item.className = 'quick-search-item';
        item.dataset.fileId = file.id;

        const title = document.createElement('div');
        title.textContent = file.name;
        item.appendChild(title);

        if (mode === 'content' && file.snippet) {
            const snippet = document.createElement('div');
            snippet.className = 'quick-search-snippet';
            snippet.textContent = file.snippet;
            item.appendChild(snippet);
        }

        if (index === selectedIndex) {
            item.classList.add('selected');
        }

        item.addEventListener('click', () => handlers.onSelect?.(file.id));

        container.appendChild(item);
    });
}

module.exports = {
    renderQuickSearchResults,
};
