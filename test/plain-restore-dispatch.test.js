const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const RENDERER_PATH = path.join(__dirname, '..', 'renderer.js');

describe('plain restore renderer dispatch', () => {
    it('plain branch uses restorePlainQueryVersion instead of hardcoded skipAutoSave', () => {
        const source = fs.readFileSync(RENDERER_PATH, 'utf8');
        const dashboardIdx = source.indexOf('if (isDashboardFile(file))');
        const plainRestoreIdx = source.indexOf('restorePlainQueryVersion({');
        assert.ok(dashboardIdx >= 0, 'dashboard restore branch missing');
        assert.ok(plainRestoreIdx > dashboardIdx, 'plain restore must follow dashboard early return');

        const dashboardReturnIdx = source.indexOf('return;', dashboardIdx);
        const plainBranch = source.slice(dashboardReturnIdx, plainRestoreIdx + 400);
        assert.match(plainBranch, /restorePlainQueryVersion\(/);
        assert.doesNotMatch(plainBranch, /skipAutoSave:\s*true/);
        assert.doesNotMatch(plainBranch, /restoreStanzaVersion\(/);
        assert.doesNotMatch(plainBranch, /autoSaveStanzaBeforeRestore\(/);
    });

    it('restorePlainQueryVersion applies shouldSkipAutoSaveOnRestore', async () => {
        const { restorePlainQueryVersion } = require('../lib/plain-query-restore');
        const { shouldSkipAutoSaveOnRestore } = require('../lib/query-versions');
        const { createTempGitRepo, writeSplFile, cleanupTempRepo } = require('./helpers/temp-git-repo');
        const { saveVersion, listVersions } = require('../lib/query-versions');

        const SPL_URL_V1 = 'http://localhost:8010/en-US/app/search/search?q=search%20index%3Dmain';
        const SPL_URL_V2 = 'http://localhost:8010/en-US/app/search/search?q=search%20index%3Dmain%20error';
        const DIRTY = 'http://localhost:8010/en-US/app/search/search?q=search%20index%3Dmain%20dirty';

        const { repoPath, git, relativePath } = await createTempGitRepo('queries/main.spl', SPL_URL_V1);
        try {
            await saveVersion(git, relativePath, 'First save');
            writeSplFile(repoPath, relativePath, SPL_URL_V2);
            await saveVersion(git, relativePath, 'Second save');
            const versions = await listVersions(git, relativePath);
            const older = versions[1];
            const newer = versions[0];

            writeSplFile(repoPath, relativePath, DIRTY);
            const isDirty = true;
            assert.equal(shouldSkipAutoSaveOnRestore(older, isDirty), false);

            await restorePlainQueryVersion({
                git,
                relativePath,
                hash: older.hash,
                version: older,
                trackedHash: newer.hash,
                isDirty
            });

            const after = await listVersions(git, relativePath);
            assert.equal(after.length, 3);
            assert.equal(after[0].isAutoSave, true);
        } finally {
            cleanupTempRepo(repoPath);
        }
    });
});
