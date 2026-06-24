const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
    closeFileState,
    reorderTabs,
    getPreviousTab,
    getNextTab,
    getFallbackActiveTab,
    createDuplicateFileName,
} = require('../lib/tabs');

describe('getFallbackActiveTab', () => {
    it('returns the first remaining tab after close', () => {
        assert.equal(getFallbackActiveTab(['a', 'b', 'c'], 'b'), 'a');
    });

    it('returns null when no tabs remain', () => {
        assert.equal(getFallbackActiveTab(['a'], 'a'), null);
    });
});

describe('closeFileState', () => {
    const files = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

    it('removes closed tab and keeps active tab when another tab is active', () => {
        const result = closeFileState(files, ['a', 'b', 'c'], 'a', 'b', ['a', 'b', 'c']);
        assert.deepEqual(result.openTabs, ['a', 'c']);
        assert.equal(result.activeFileId, 'a');
        assert.deepEqual(result.fileMru, ['a', 'c']);
    });

    it('activates fallback tab when closing the active tab', () => {
        const result = closeFileState(files, ['a', 'b', 'c'], 'b', 'b', ['b', 'a', 'c']);
        assert.deepEqual(result.openTabs, ['a', 'c']);
        assert.equal(result.activeFileId, 'a');
        assert.deepEqual(result.fileMru, ['a', 'c']);
    });

    it('clears active tab when closing the last tab', () => {
        const result = closeFileState(files, ['a'], 'a', 'a', ['a']);
        assert.deepEqual(result.openTabs, []);
        assert.equal(result.activeFileId, null);
    });
});

describe('reorderTabs', () => {
    it('inserts dragged tab before target', () => {
        assert.deepEqual(
            reorderTabs(['a', 'b', 'c'], 'c', 'a', 'before'),
            ['c', 'a', 'b']
        );
    });

    it('inserts dragged tab after target', () => {
        assert.deepEqual(
            reorderTabs(['a', 'b', 'c'], 'a', 'c', 'after'),
            ['b', 'c', 'a']
        );
    });

    it('returns unchanged order when target is missing', () => {
        assert.deepEqual(
            reorderTabs(['a', 'b'], 'a', 'missing', 'before'),
            ['a', 'b']
        );
    });
});

describe('getPreviousTab', () => {
    it('returns previous tab id', () => {
        assert.equal(getPreviousTab(['a', 'b', 'c'], 'b'), 'a');
    });

    it('returns null for first tab', () => {
        assert.equal(getPreviousTab(['a', 'b'], 'a'), null);
    });
});

describe('getNextTab', () => {
    it('returns next tab id', () => {
        assert.equal(getNextTab(['a', 'b', 'c'], 'b'), 'c');
    });

    it('returns null for last tab', () => {
        assert.equal(getNextTab(['a', 'b'], 'b'), null);
    });
});

describe('createDuplicateFileName', () => {
    it('appends (2) for first duplicate', () => {
        const files = [{ name: 'Search 1.spl' }];
        assert.equal(createDuplicateFileName(files, 'Search 1.spl'), 'Search 1.spl (2)');
    });

    it('increments suffix when duplicates already exist', () => {
        const files = [
            { name: 'Search 1.spl' },
            { name: 'Search 1.spl (2)' },
        ];
        assert.equal(createDuplicateFileName(files, 'Search 1.spl'), 'Search 1.spl (3)');
    });
});
