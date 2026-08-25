const { restoreVersion, shouldSkipAutoSaveOnRestore } = require('./query-versions');

/**
 * Plain .spl restore: optional URL sync, then restore with auto-save skip rule.
 * @param {object} params
 * @param {import('simple-git').SimpleGit} params.git
 * @param {string} params.relativePath
 * @param {string} params.hash
 * @param {{ isAutoSave?: boolean }} params.version
 * @param {string} [params.trackedHash]
 * @param {boolean} params.isDirty
 * @param {() => Promise<void>|void} [params.syncUrl]
 */
async function restorePlainQueryVersion({
    git,
    relativePath,
    hash,
    version,
    trackedHash,
    isDirty,
    syncUrl
}) {
    if (syncUrl) {
        await syncUrl();
    }
    return restoreVersion(git, relativePath, hash, trackedHash, {
        skipAutoSave: shouldSkipAutoSaveOnRestore(version, isDirty)
    });
}

module.exports = { restorePlainQueryVersion };
