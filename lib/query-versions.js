const fs = require('node:fs');
const path = require('node:path');
const { extractQueryFromUrl } = require('./url-utils');

/**
 * Per-query version history backed by git, scoped to a single .spl file path.
 * Project may have one git repo; all UI operations filter to one relative file.
 */

async function ensureRepo(git) {
    const isRepo = await git.checkIsRepo('root');
    if (!isRepo) {
        await git.init();
        await git.addConfig('user.name', 'Splunk IDE');
        await git.addConfig('user.email', 'splunk-ide@local');
    }
}

/**
 * @param {import('simple-git').SimpleGit} git
 * @param {string} relativePath - path relative to project root (e.g. "queries/error-rate.spl")
 * @returns {Promise<{ status: 'clean'|'modified'|'untracked'|'staged'|'deleted'|'unknown', hasChanges: boolean }>}
 */
async function getFileStatus(git, relativePath) {
    const normalized = relativePath.replace(/\\/g, '/');
    const isRepo = await git.checkIsRepo('root');
    if (!isRepo) {
        return { status: 'untracked', hasChanges: true };
    }

    const status = await git.status();
    const entry = status.files.find(file => file.path === normalized);

    if (!entry) {
        return { status: 'clean', hasChanges: false };
    }

    if (entry.working_dir === '?' || status.not_added.includes(normalized)) {
        return { status: 'untracked', hasChanges: true };
    }
    if (entry.working_dir === 'D' || entry.index === 'D') {
        return { status: 'deleted', hasChanges: true };
    }
    // Working tree differs from index (includes staged-then-edited-again).
    if (entry.working_dir === 'M') {
        return { status: 'modified', hasChanges: true };
    }
    if (entry.index === 'M' || entry.index === 'A') {
        return { status: 'staged', hasChanges: true };
    }
    return { status: 'clean', hasChanges: false };
}

const PARENT_TRAILER_RE = /^Query-Parent:\s*(\S+)/m;
const AUTOSAVE_TRAILER_RE = /^Query-Autosave:\s*true/m;
const CONSUMED_AUTOSAVES_FILE = 'splunk-ide-consumed-autosaves';

async function getConsumedAutoSaveHashes(git) {
    try {
        const gitDir = (await git.revparse(['--absolute-git-dir'])).trim();
        const content = fs.readFileSync(path.join(gitDir, CONSUMED_AUTOSAVES_FILE), 'utf8');
        return new Set(content.split('\n').map(line => line.trim()).filter(Boolean));
    } catch {
        return new Set();
    }
}

/**
 * @typedef {Object} QueryVersion
 * @property {string} hash
 * @property {string} message
 * @property {string} [parentHash]
 * @property {boolean} [isAutoSave]
 * @property {boolean} [isConsumedAutoSave]
 * @property {string} author
 * @property {string} date - ISO string
 * @property {string} query - decoded SPL text at this version
 * @property {string} url - raw .spl file content at this version
 */

/**
 * @param {import('simple-git').SimpleGit} git
 * @param {string} relativePath
 * @param {number} [maxCount=30]
 * @param {{ includeConsumedAutoSaves?: boolean }} [options]
 * @returns {Promise<QueryVersion[]>}
 */
async function listVersions(git, relativePath, maxCount = 30, options = {}) {
    const normalized = relativePath.replace(/\\/g, '/');
    const isRepo = await git.checkIsRepo('root');
    if (!isRepo) {
        return [];
    }

    let raw;
    try {
        raw = await git.raw([
            'log', '--follow', '--name-only',
            `--max-count=${maxCount}`,
            '--pretty=format:COMMIT:%H%x00%an%x00%ad%x00%s%x00%b',
            '--date=iso-strict',
            '--', normalized
        ]);
    } catch {
        return [];
    }

    if (!raw.trim()) {
        return [];
    }

    const consumedAutoSaves = await getConsumedAutoSaveHashes(git);
    const versions = [];
    const blocks = raw.trim().split(/^COMMIT:/m).filter(Boolean);
    for (const block of blocks) {
        const lines = block.trim().split('\n').map(line => line.trim()).filter(Boolean);
        if (lines.length === 0) {
            continue;
        }

        const [hash, author, date, message, bodyFirst = ''] = lines[0].split('\0');
        const pathAtCommit = lines.length > 1 ? lines[lines.length - 1] : normalized;
        const bodyLines = [bodyFirst];
        for (let i = 1; i < lines.length - 1; i++) {
            bodyLines.push(lines[i]);
        }
        const body = bodyLines.join('\n');
        const parentMatch = PARENT_TRAILER_RE.exec(body);
        let url = '';
        try {
            url = await git.show([`${hash}:${pathAtCommit}`]);
        } catch {
            // File may not exist at this commit under any known path.
        }
        const version = {
            hash,
            message,
            author,
            date,
            query: extractQueryFromUrl(url),
            url: url.trim()
        };
        if (parentMatch) {
            version.parentHash = parentMatch[1];
        }
        if (AUTOSAVE_TRAILER_RE.test(body)) {
            version.isAutoSave = true;
            if (consumedAutoSaves.has(hash)) {
                version.isConsumedAutoSave = true;
                if (!options.includeConsumedAutoSaves) {
                    continue;
                }
            }
        }
        versions.push(version);
    }
    return versions;
}

/**
 * Read current on-disk content for a query file.
 * @param {string} absolutePath
 * @returns {{ url: string, query: string }}
 */
function readCurrentQuery(absolutePath) {
    try {
        const url = fs.readFileSync(absolutePath, 'utf8').trim();
        return { url, query: extractQueryFromUrl(url) };
    } catch {
        return { url: '', query: '' };
    }
}

/**
 * Stage and commit only the given query file.
 * @param {import('simple-git').SimpleGit} git
 * @param {string} relativePath
 * @param {string} message
 * @param {string} [parentHash]
 * @param {{ isAutoSave?: boolean }} [options]
 */
async function saveVersion(git, relativePath, message, parentHash, options = {}) {
    await ensureRepo(git);
    const normalized = relativePath.replace(/\\/g, '/');
    const { hasChanges } = await getFileStatus(git, normalized);
    if (!hasChanges) {
        return { saved: false, reason: 'no-changes' };
    }
    await git.add(normalized);
    const trailers = [];
    if (parentHash) {
        trailers.push(`Query-Parent: ${parentHash}`);
    }
    if (options.isAutoSave) {
        trailers.push('Query-Autosave: true');
    }
    const commitMessage = trailers.length
        ? `${message}\n\n${trailers.join('\n')}`
        : message;
    await git.commit(commitMessage, [normalized]);
    return { saved: true };
}

/**
 * Restore query file to content at a specific commit (does not move HEAD).
 * @param {import('simple-git').SimpleGit} git
 * @param {string} relativePath
 * @param {string} hash
 * @param {string} [parentHash] - logical parent for any auto-save commit before restore
 * @param {{ skipAutoSave?: boolean }} [options]
 * @returns {Promise<{ url: string, query: string }>}
 */
async function restoreVersion(git, relativePath, hash, parentHash, options = {}) {
    const normalized = relativePath.replace(/\\/g, '/');
    const { hasChanges } = await getFileStatus(git, normalized);
    if (hasChanges && !options.skipAutoSave) {
        await saveVersion(
            git,
            normalized,
            `Auto-save before restore to ${hash.substring(0, 7)}`,
            parentHash,
            { isAutoSave: true }
        );
    }
    await git.checkout([hash, '--', normalized]);
    const root = (await git.revparse(['--show-toplevel'])).trim();
    const absolutePath = path.join(root, normalized);
    return readCurrentQuery(absolutePath);
}

/**
 * Rename or move a query file, preserving git history when possible.
 * @param {import('simple-git').SimpleGit} git
 * @param {string} projectRoot
 * @param {string} oldRelativePath
 * @param {string} newRelativePath
 */
async function renameQueryFile(git, projectRoot, oldRelativePath, newRelativePath) {
    const oldNorm = oldRelativePath.replace(/\\/g, '/');
    const newNorm = newRelativePath.replace(/\\/g, '/');
    if (oldNorm === newNorm) {
        return;
    }

    const oldAbs = path.join(projectRoot, oldNorm);
    const newAbs = path.join(projectRoot, newNorm);
    if (!fs.existsSync(oldAbs)) {
        throw new Error(`File not found: ${oldNorm}`);
    }

    const newDir = path.dirname(newAbs);
    if (!fs.existsSync(newDir)) {
        fs.mkdirSync(newDir, { recursive: true });
    }

    const isRepo = await git.checkIsRepo('root');
    if (isRepo) {
        try {
            await git.mv(oldNorm, newNorm);
            await git.commit(`Rename ${path.basename(oldNorm)} to ${path.basename(newNorm)}`);
            return;
        } catch {
            // Untracked or partially tracked files fall back to filesystem rename.
        }
    }

    fs.renameSync(oldAbs, newAbs);
}

/**
 * Mark an auto-save commit as consumed so listVersions hides it by default.
 * @param {import('simple-git').SimpleGit} git
 * @param {string} hash
 */
async function consumeAutoSave(git, hash) {
    const gitDir = (await git.revparse(['--absolute-git-dir'])).trim();
    const consumed = await getConsumedAutoSaveHashes(git);
    consumed.add(hash);
    fs.writeFileSync(
        path.join(gitDir, CONSUMED_AUTOSAVES_FILE),
        `${[...consumed].join('\n')}\n`
    );
}

module.exports = {
    ensureRepo,
    getFileStatus,
    listVersions,
    readCurrentQuery,
    saveVersion,
    restoreVersion,
    renameQueryFile,
    consumeAutoSave
};
