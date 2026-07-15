const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
    saveVersion,
    listVersions,
    readCurrentQuery,
    hasDraftChanges,
    consumeAutoSave
} = require('../lib/query-versions');
const { restorePlainQueryVersion } = require('../lib/plain-query-restore');
const { createTempGitRepo, writeSplFile, cleanupTempRepo } = require('./helpers/temp-git-repo');

const SPL_URL_V1 = 'http://localhost:8010/en-US/app/search/search?q=search%20index%3Dmain';
const SPL_URL_V2 = 'http://localhost:8010/en-US/app/search/search?q=search%20index%3Dmain%20error';
const SPL_URL_DIRTY = 'http://localhost:8010/en-US/app/search/search?q=search%20index%3Dmain%20dirty';
const SPL_URL_LIVE = 'http://localhost:8010/en-US/app/search/search?q=search%20index%3Dmain%20live';
const SPL_URL_STALE = 'http://localhost:8010/en-US/app/search/search?q=search%20index%3Dmain%20stale';

async function seedTwoVersions(repoPath, git, relativePath) {
    await saveVersion(git, relativePath, 'First save');
    writeSplFile(repoPath, relativePath, SPL_URL_V2);
    await saveVersion(git, relativePath, 'Second save');
    const versions = await listVersions(git, relativePath);
    return { older: versions[1], newer: versions[0] };
}

function diskUrl(repoPath, relativePath) {
    return readCurrentQuery(path.join(repoPath, relativePath)).url;
}

describe('plain restore auto-save behavior', () => {
    let repoPath;
    let git;
    let relativePath;

    beforeEach(async () => {
        ({ repoPath, git, relativePath } = await createTempGitRepo('queries/main.spl', SPL_URL_V1));
    });

    afterEach(() => {
        cleanupTempRepo(repoPath);
    });

    it('A: clean restore older creates no auto-save and restores file content', async () => {
        const { older, newer } = await seedTwoVersions(repoPath, git, relativePath);
        const isDirty = await hasDraftChanges(git, relativePath, newer.hash);
        assert.equal(isDirty, false);

        const restored = await restorePlainQueryVersion({
            git,
            relativePath,
            hash: older.hash,
            version: older,
            trackedHash: newer.hash,
            isDirty
        });

        assert.equal(restored.url, SPL_URL_V1);
        assert.equal(diskUrl(repoPath, relativePath), SPL_URL_V1);

        const versions = await listVersions(git, relativePath);
        assert.equal(versions.length, 2);
        assert.equal(versions.some((version) => version.isAutoSave), false);
    });

    it('B: dirty restore older auto-saves latest dirty URL then restores older file', async () => {
        const { older, newer } = await seedTwoVersions(repoPath, git, relativePath);
        writeSplFile(repoPath, relativePath, SPL_URL_DIRTY);
        const isDirty = await hasDraftChanges(git, relativePath, newer.hash);
        assert.equal(isDirty, true);

        await restorePlainQueryVersion({
            git,
            relativePath,
            hash: older.hash,
            version: older,
            trackedHash: newer.hash,
            isDirty
        });

        const versions = await listVersions(git, relativePath);
        assert.equal(versions.length, 3);
        const [autoSave] = versions;
        assert.match(autoSave.message, /Auto-save before restore/);
        assert.equal(autoSave.isAutoSave, true);
        assert.equal(autoSave.url, SPL_URL_DIRTY);
        assert.equal(diskUrl(repoPath, relativePath), SPL_URL_V1);
    });

    it('C: restoring a consumed auto-save hides it from history and restores draft content', async () => {
        const { older, newer } = await seedTwoVersions(repoPath, git, relativePath);
        writeSplFile(repoPath, relativePath, SPL_URL_DIRTY);
        const isDirty = await hasDraftChanges(git, relativePath, newer.hash);

        await restorePlainQueryVersion({
            git,
            relativePath,
            hash: older.hash,
            version: older,
            trackedHash: newer.hash,
            isDirty
        });

        const beforeConsume = await listVersions(git, relativePath);
        const autoSave = beforeConsume[0];
        assert.equal(autoSave.isAutoSave, true);

        const restored = await restorePlainQueryVersion({
            git,
            relativePath,
            hash: autoSave.hash,
            version: autoSave,
            trackedHash: older.hash,
            isDirty: false
        });
        await consumeAutoSave(git, autoSave.hash);

        assert.equal(restored.url, SPL_URL_DIRTY);
        assert.equal(diskUrl(repoPath, relativePath), SPL_URL_DIRTY);

        const afterConsume = await listVersions(git, relativePath);
        assert.equal(afterConsume.length, 2);
        assert.ok(!afterConsume.some((version) => version.hash === autoSave.hash));
    });

    it('D: without sync, disk matching tracked HEAD skips auto-save on restore', async () => {
        const { older, newer } = await seedTwoVersions(repoPath, git, relativePath);
        writeSplFile(repoPath, relativePath, SPL_URL_V2);
        const isDirty = await hasDraftChanges(git, relativePath, newer.hash);
        assert.equal(isDirty, false);

        await restorePlainQueryVersion({
            git,
            relativePath,
            hash: older.hash,
            version: older,
            trackedHash: newer.hash,
            isDirty
        });

        const versions = await listVersions(git, relativePath);
        assert.equal(versions.length, 2);
        assert.equal(versions.some((version) => version.isAutoSave), false);
    });

    it('E: sync before restore auto-saves live URL not stale disk content', async () => {
        const { older, newer } = await seedTwoVersions(repoPath, git, relativePath);
        writeSplFile(repoPath, relativePath, SPL_URL_STALE);

        const syncUrl = async () => {
            writeSplFile(repoPath, relativePath, SPL_URL_LIVE);
        };
        await syncUrl();
        const isDirty = await hasDraftChanges(git, relativePath, newer.hash);
        assert.equal(isDirty, true);

        await restorePlainQueryVersion({
            git,
            relativePath,
            hash: older.hash,
            version: older,
            trackedHash: newer.hash,
            isDirty,
            syncUrl
        });

        const [autoSave] = await listVersions(git, relativePath);
        assert.equal(autoSave.isAutoSave, true);
        assert.equal(autoSave.url, SPL_URL_LIVE);
        assert.notEqual(autoSave.url, SPL_URL_STALE);
        assert.equal(diskUrl(repoPath, relativePath), SPL_URL_V1);
    });

    it('sibling: dirty second file is unchanged when restoring the first file', async () => {
        const pathA = 'queries/a.spl';
        const pathB = 'queries/b.spl';
        writeSplFile(repoPath, pathA, SPL_URL_V1);
        writeSplFile(repoPath, pathB, SPL_URL_V1);
        await saveVersion(git, pathA, 'A first');
        await saveVersion(git, pathB, 'B first');

        writeSplFile(repoPath, pathA, SPL_URL_V2);
        await saveVersion(git, pathA, 'A second');
        const versionsA = await listVersions(git, pathA);
        const versionsB = await listVersions(git, pathB);
        const olderA = versionsA[1];
        const newerA = versionsA[0];
        const trackedB = versionsB[0].hash;

        writeSplFile(repoPath, pathB, SPL_URL_DIRTY);
        const bBytesBefore = fs.readFileSync(path.join(repoPath, pathB), 'utf8');
        assert.equal(await hasDraftChanges(git, pathB, trackedB), true);

        await restorePlainQueryVersion({
            git,
            relativePath: pathA,
            hash: olderA.hash,
            version: olderA,
            trackedHash: newerA.hash,
            isDirty: false
        });

        const bBytesAfter = fs.readFileSync(path.join(repoPath, pathB), 'utf8');
        assert.equal(bBytesAfter, bBytesBefore);
        assert.equal(await hasDraftChanges(git, pathB, trackedB), true);
        assert.equal(diskUrl(repoPath, pathA), SPL_URL_V1);
    });
});
