const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { renderTabs, setActiveTab, updateTabTitle } = require('../lib/render-tabs');
const { createDocument, createContainer } = require('./helpers/dom');

const sampleFiles = [
    { id: 'a', name: 'queries/main' },
    { id: 'b', name: 'archive/old' },
    { id: 'c', name: 'root' },
];

describe('renderTabs', () => {
    it('renders tabs in provided order', () => {
        const document = createDocument();
        const container = createContainer(document, 'tab-bar');

        renderTabs(container, sampleFiles, 'b');

        const tabs = Array.from(container.querySelectorAll('.tab'));
        assert.deepEqual(tabs.map(tab => tab.dataset.targetId), ['a', 'b', 'c']);
        assert.deepEqual(
            tabs.map(tab => tab.querySelector('.tab-title').textContent),
            ['main', 'old', 'root']
        );
    });

    it('marks active tab with active class', () => {
        const document = createDocument();
        const container = createContainer(document, 'tab-bar');

        renderTabs(container, sampleFiles, 'b');

        const activeTabs = container.querySelectorAll('.tab.active');
        assert.equal(activeTabs.length, 1);
        assert.equal(activeTabs[0].dataset.targetId, 'b');
    });

    it('calls switch handler when tab is clicked', () => {
        const document = createDocument();
        const container = createContainer(document, 'tab-bar');
        let switchedId = null;

        renderTabs(container, sampleFiles, 'a', {
            onSwitch: id => { switchedId = id; },
        });

        container.querySelector('.tab[data-target-id="c"]').click();
        assert.equal(switchedId, 'c');
    });

    it('calls close handler when close button is clicked', () => {
        const document = createDocument();
        const container = createContainer(document, 'tab-bar');
        let closedId = null;

        renderTabs(container, sampleFiles, 'a', {
            onClose: id => { closedId = id; },
        });

        const closeButton = container.querySelector('.tab[data-target-id="b"] .tab-close');
        closeButton.click();
        assert.equal(closedId, 'b');
    });
});

describe('setActiveTab', () => {
    it('updates active class on existing tabs', () => {
        const document = createDocument();
        const container = createContainer(document, 'tab-bar');
        renderTabs(container, sampleFiles, 'a');

        setActiveTab(container, 'c');

        const activeTab = container.querySelector('.tab.active');
        assert.equal(activeTab.dataset.targetId, 'c');
    });
});

describe('updateTabTitle', () => {
    it('updates tab title text', () => {
        const document = createDocument();
        const container = createContainer(document, 'tab-bar');
        renderTabs(container, sampleFiles, 'a');

        updateTabTitle(container, 'a', 'renamed/path');

        const title = container.querySelector('.tab[data-target-id="a"] .tab-title');
        assert.equal(title.textContent, 'path');
    });
});
