'use strict';

const { JSDOM } = require('jsdom');

function createDocument(html = '<!DOCTYPE html><html><body></body></html>') {
    const dom = new JSDOM(html);
    return dom.window.document;
}

function createContainer(document, id) {
    const container = document.createElement('div');
    if (id) {
        container.id = id;
    }
    document.body.appendChild(container);
    return container;
}

module.exports = {
    createDocument,
    createContainer,
};
