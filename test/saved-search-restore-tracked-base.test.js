const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const RENDERER_PATH = path.join(__dirname, '..', 'renderer.js');

describe('saved-search restore tracked base', () => {
    it('discards draft instead of restoreStanzaVersion when restoring tracked base with draft', () => {
        const source = fs.readFileSync(RENDERER_PATH, 'utf8');
        const branchStart = source.indexOf('if (trackedHash === hash) {');
        assert.ok(branchStart >= 0, 'tracked-base branch missing');

        const branchEnd = source.indexOf('const restored = await restoreStanzaVersion', branchStart);
        assert.ok(branchEnd > branchStart, 'older-hash restore path missing');

        const trackedBaseBranch = source.slice(branchStart, branchEnd);
        assert.match(trackedBaseBranch, /discardStanzaDraft\(/);
        assert.match(trackedBaseBranch, /forcedDraftByFileId\.delete\(file\.id\)/);
        assert.match(trackedBaseBranch, /userDraftByFileId\.delete\(file\.id\)/);
        assert.match(trackedBaseBranch, /selectedVersionHashes = \[hash\]/);
        assert.match(trackedBaseBranch, /applySavedSearchAceFromStanza\(file, stanza\)/);
        assert.doesNotMatch(trackedBaseBranch, /restoreStanzaVersion\(/);
        assert.doesNotMatch(trackedBaseBranch, /DRAFT_VERSION_HASH/);
    });
});
