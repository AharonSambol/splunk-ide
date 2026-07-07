const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { diffLines, renderDiffHtml } = require('../lib/diff-lines');

describe('diffLines', () => {
    it('returns same lines for identical text', () => {
        const result = diffLines('index=main\n| stats count', 'index=main\n| stats count');
        assert.deepEqual(result, [
            { type: 'same', text: 'index=main' },
            { type: 'same', text: '| stats count' }
        ]);
    });

    it('detects added and removed lines', () => {
        const result = diffLines('index=main', 'index=main error');
        assert.deepEqual(result, [
            { type: 'removed', text: 'index=main' },
            { type: 'added', text: 'index=main error' }
        ]);
    });

    it('handles empty to non-empty text', () => {
        const result = diffLines('', 'index=main');
        assert.deepEqual(result, [
            { type: 'removed', text: '' },
            { type: 'added', text: 'index=main' }
        ]);
    });
});

describe('renderDiffHtml', () => {
    it('escapes HTML and marks added lines', () => {
        const html = renderDiffHtml([{ type: 'added', text: '<script>' }]);
        assert.match(html, /diff-added/);
        assert.match(html, /&lt;script&gt;/);
        assert.doesNotMatch(html, /<script>/);
    });
});
