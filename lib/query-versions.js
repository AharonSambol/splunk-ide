const fs = require('node:fs');
const path = require('node:path');
const { extractQueryFromUrl } = require('./url-utils');

/**
 * Per-query version history backed by git, scoped to a single .spl file path.
 * Project may have one git repo; all UI operations filter to one relative file.
 */

async function ensureRepo(git) {
    const isRepo = await git.checkIsRepo();
    if (!isRepo) {
        await git.init();
    }
}

/**
 * @param {import('simple-git').SimpleGit} git
 * @param {string} relativePath - path relative to project root (e.g. "queries/error-rate.spl")
 * @returns {Promise<{ status: 'clean'|'modified'|'untracked'|'staged'|'deleted'|'unknown', hasChanges: boolean }>}
 */
async function getFileStatus(git, relativePath) {
    const status = await git.status();
    const normalized = relativePath.replace(/\\/g, '/');

    if (status.deleted.includes(normalized)) {
        return { status: 'deleted', hasChanges: true };
    }
    if (status.staged.includes(normalized)) {
        return { status: 'staged', hasChanges: true };
    }
    if (status.not_added.includes(normalized)) {
        return { status: 'untracked', hasChanges: true };
    }
    if (status.modified.includes(normalized)) {
        return { status: 'modified', hasChanges: true };
    }
    if (status.created.includes(normalized)) {
        return { status: 'modified', hasChanges: true };
    }
    return { status: 'clean', hasChanges: false };
}

/**
 * @typedef {Object} QueryVersion
 * @property {string} hash
 * @property {string} message
 * @property {string} author
 * @property {string} date - ISO string
 * @property {string} query - decoded SPL text at this version
 * @property {string} url - raw .spl file content at this version
 */

/**
 * @param {import('simple-git').SimpleGit} git
 * @param {string} projectRoot
 * @param {string} relativePath
 * @param {number} [maxCount=30]
 * @returns {Promise<QueryVersion[]>}
 */
async function listVersions(git, projectRoot, relativePath, maxCount = 30) {
    const normalized = relativePath.replace(/\\/g, '/');
    let log;
    try {
        log = await git.log({ file: normalized, maxCount });
    } catch {
        return [];
    }

    const versions = [];
    for (const entry of log.all) {
        let url = '';
        try {
            url = await git.show([`${entry.hash}:${normalized}`]);
        } catch {
            // File may not exist at this commit
        }
        versions.push({
            hash: entry.hash,
            message: entry.message,
            author: entry.author_name,
            date: entry.date,
            query: extractQueryFromUrl(url),
            url: url.trim()
        });
    }
    return versions;
}

/**
 * Read current on-disk content for a query file.
 * @param {string} absolutePath
 * @returns {{ url: string, query: string }}
 */
function readCurrentQuery(absolutePath) {
    const url = fs.readFileSync(absolutePath, 'utf8').trim();
    return { url, query: extractQueryFromUrl(url) };
}

/**
 * Stage and commit only the given query file.
 * @param {import('simple-git').SimpleGit} git
 * @param {string} relativePath
 * @param {string} message
 */
async function saveVersion(git, relativePath, message) {
    const normalized = relativePath.replace(/\\/g, '/');
    await git.add(normalized);
    await git.commit(message, [normalized]);
}

/**
 * Restore query file to content at a specific commit (does not move HEAD).
 * @param {import('simple-git').SimpleGit} git
 * @param {string} relativePath
 * @param {string} hash
 * @returns {Promise<{ url: string, query: string }>}
 */
async function restoreVersion(git, relativePath, hash) {
    const normalized = relativePath.replace(/\\/g, '/');
    await git.checkout([hash, '--', normalized]);
    const root = (await git.revparse(['--show-toplevel'])).trim();
    const absolutePath = path.join(root, normalized);
    return readCurrentQuery(absolutePath);
}

/**
 * Compare two SPL strings; returns a simple line-based diff summary.
 * @param {string} before
 * @param {string} after
 * @returns {{ changed: boolean, beforeLines: number, afterLines: number }}
 */
function summarizeChange(before, after) {
    return {
        changed: before !== after,
        beforeLines: before.split('\n').length,
        afterLines: after.split('\n').length
    };
}

module.exports = {
    ensureRepo,
    getFileStatus,
    listVersions,
    readCurrentQuery,
    saveVersion,
    restoreVersion,
    summarizeChange
};
