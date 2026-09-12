'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { getSavedSearchConfPath } = require('../../lib/objects/object-paths');

const SAVED_SEARCH_META = {
    instance: 'prod',
    app: 'search',
    owner: 'nobody',
    name: 'Error Rate',
};

describe('saved search — no canonical .spl hot path', () => {
    it('conf path is used for git ops, not saved-searches/*.spl', () => {
        const confPath = getSavedSearchConfPath(SAVED_SEARCH_META);
        assert.match(confPath, /savedsearches\.conf$/);
        assert.ok(!confPath.includes('saved-searches/'));
        assert.ok(!confPath.endsWith('.spl'));
    });

    it('renderer does not call getSavedSearchPath', () => {
        const rendererSrc = fs.readFileSync(path.join(__dirname, '../..', 'renderer.js'), 'utf8');
        const historySrc = fs.readFileSync(path.join(__dirname, '../..', 'renderer/history.js'), 'utf8');
        const restoreSrc = fs.readFileSync(path.join(__dirname, '../..', 'renderer/history-restore.js'), 'utf8');
        const syncSrc = fs.readFileSync(path.join(__dirname, '../..', 'renderer/history-sync.js'), 'utf8');
        assert.ok(!rendererSrc.includes('getSavedSearchPath'));
        assert.ok(!historySrc.includes('getSavedSearchPath'));
        assert.ok(!restoreSrc.includes('getSavedSearchPath'));
        assert.ok(!syncSrc.includes('getSavedSearchPath'));
    });
});
