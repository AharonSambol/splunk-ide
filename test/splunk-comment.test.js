const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
    isCommentedLine,
    shouldAddComment,
    toggleCommentLine,
    toggleCommentLines,
} = require('../lib/splunk-comment');

describe('isCommentedLine', () => {
    it('treats blank lines as commented', () => {
        assert.equal(isCommentedLine('   '), true);
    });

    it('detects Splunk comment markers', () => {
        assert.equal(isCommentedLine('``` index=main ```'), true);
    });
});

describe('shouldAddComment', () => {
    it('adds comments when any line is uncommented', () => {
        assert.equal(shouldAddComment(['index=main', '``` already ```']), true);
    });

    it('removes comments when all lines are commented or blank', () => {
        assert.equal(shouldAddComment(['``` index=main ```', '']), false);
    });
});

describe('toggleCommentLine', () => {
    it('wraps uncommented lines', () => {
        assert.equal(toggleCommentLine('index=main', true), '``` index=main ```');
    });

    it('unwraps commented lines', () => {
        assert.equal(toggleCommentLine('``` index=main ```', false), 'index=main');
    });

    it('escapes existing backticks when commenting', () => {
        assert.equal(toggleCommentLine('has ``` backticks', true), '``` has `````` backticks ```');
    });
});

describe('toggleCommentLines', () => {
    it('comments all lines in a selection', () => {
        assert.deepEqual(toggleCommentLines(['index=main', '| stats count']), [
            '``` index=main ```',
            '``` | stats count ```',
        ]);
    });

    it('uncomments all lines in a selection', () => {
        assert.deepEqual(toggleCommentLines(['``` index=main ```', '``` | stats count ```']), [
            'index=main',
            '| stats count',
        ]);
    });
});
