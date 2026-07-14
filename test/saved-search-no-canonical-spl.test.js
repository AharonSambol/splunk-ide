'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { getSavedSearchConfPath } = require('../lib/object-paths');

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
        const src = fs.readFileSync(path.join(__dirname, '..', 'renderer.js'), 'utf8');
        assert.ok(!src.includes('getSavedSearchPath'));
    });
});
