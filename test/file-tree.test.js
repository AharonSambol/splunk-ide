const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { buildFileTree } = require('../lib/file-tree');

describe('buildFileTree', () => {
    it('groups files under nested folders', () => {
        const tree = buildFileTree(
            [
                { id: 1, name: 'queries/main.spl' },
                { id: 2, name: 'queries/archive/old.spl' },
                { id: 3, name: 'readme.txt' },
            ],
            ['queries', 'queries/archive']
        );

        assert.equal(tree.files.length, 1);
        assert.equal(tree.files[0].displayName, 'readme.txt');
        assert.equal(tree.children.length, 1);

        const queries = tree.children[0];
        assert.equal(queries.name, 'queries');
        assert.equal(queries.files.length, 1);
        assert.equal(queries.files[0].displayName, 'main.spl');
        assert.equal(queries.children.length, 1);

        const archive = queries.children[0];
        assert.equal(archive.name, 'archive');
        assert.equal(archive.files.length, 1);
        assert.equal(archive.files[0].displayName, 'old.spl');
    });

    it('creates folders from file paths when folder list is empty', () => {
        const tree = buildFileTree([{ id: 1, name: 'a/b/c.spl' }], []);

        assert.equal(tree.children.length, 1);
        assert.equal(tree.children[0].name, 'a');
        assert.equal(tree.children[0].children[0].name, 'b');
        assert.equal(tree.children[0].children[0].files[0].displayName, 'c.spl');
    });
});
