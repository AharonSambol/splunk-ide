const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { extractQueryFromUrl, urlsMatchForDraft } = require('./url-utils');

const execFileAsync = promisify(execFile);

const DEFAULT_AUTHOR = { name: 'Splunk IDE', email: 'splunk-ide@local' };

/**
 * Per-query version history backed by git, scoped to a single .spl file path.
 * Project may have one git repo; all UI operations filter to one relative file.
 */

async function getRepoAuthor(git) {
    try {
        const name = (await git.getConfig('user.name', 'local')).value;
        const email = (await git.getConfig('user.email', 'local')).value;
        if (name && email) {
            return { name, email };
        }
    } catch {
        // Repo may lack author config.
    }
    return null;
}

/**
 * @param {import('simple-git').SimpleGit} git
 * @param {{ author?: { name?: string, email?: string } }} [options]
 */
async function resolveAuthor(git, options = {}) {
    const existing = await getRepoAuthor(git);
    if (existing) {
        return existing;
    }
    const { name, email } = options.author || {};
    if (name && email) {
        return { name, email };
    }
    return DEFAULT_AUTHOR;
}

function authorEnv(author) {
    return {
        GIT_AUTHOR_NAME: author.name,
        GIT_AUTHOR_EMAIL: author.email,
        GIT_COMMITTER_NAME: author.name,
        GIT_COMMITTER_EMAIL: author.email
    };
}

/**
 * @param {import('simple-git').SimpleGit} git
 * @param {{ author?: { name?: string, email?: string } }} [options]
 */
async function ensureRepo(git, options = {}) {
    const isRepo = await git.checkIsRepo('root');
    if (!isRepo) {
        await git.init();
        const author = await resolveAuthor(git, options);
        await git.addConfig('user.name', author.name);
        await git.addConfig('user.email', author.email);
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
const STASH_REF_PREFIX = 'refs/splunk-ide/stashes';
const VERSION_REF_PREFIX = 'refs/splunk-ide/versions';

async function getConsumedAutoSaveHashes(git) {
    try {
        const gitDir = (await git.revparse(['--absolute-git-dir'])).trim();
        const content = fs.readFileSync(path.join(gitDir, CONSUMED_AUTOSAVES_FILE), 'utf8');
        return new Set(content.split('\n').map(line => line.trim()).filter(Boolean));
    } catch {
        return new Set();
    }
}

function draftStashRef(relativePath, baseHash) {
    return `${STASH_REF_PREFIX}/${sanitizeFileSlug(relativePath)}/${baseHash}`;
}

function versionRecordRef(relativePath, commitHash) {
    return `${VERSION_REF_PREFIX}/${sanitizeFileSlug(relativePath)}/${commitHash}`;
}

async function gitExec(git, args, extraEnv = {}) {
    const root = (await git.revparse(['--show-toplevel'])).trim();
    const { stdout } = await execFileAsync('git', args, {
        cwd: root,
        env: { ...process.env, ...extraEnv }
    });
    return stdout.trim();
}

/**
 * Create a commit on top of parentHash with the working-tree file content.
 * @param {import('simple-git').SimpleGit} git
 * @param {string} relativePath
 * @param {string} parentHash
 * @param {string} message
 * @param {{ name: string, email: string }} author
 */
async function commitFileOnParent(git, relativePath, parentHash, message, author) {
    const gitDir = (await git.revparse(['--absolute-git-dir'])).trim();
    const indexFile = path.join(gitDir, `splunk-ide-idx-${process.pid}-${Date.now()}`);
    const env = { GIT_INDEX_FILE: indexFile, ...authorEnv(author) };

    try {
        const parentTree = await gitExec(git, ['rev-parse', `${parentHash}^{tree}`], env);
        await gitExec(git, ['read-tree', parentTree], env);
        await gitExec(git, ['add', relativePath], env);
        const tree = await gitExec(git, ['write-tree'], env);
        return await gitExec(git, ['commit-tree', tree, '-p', parentHash, '-m', message], env);
    } finally {
        try {
            fs.unlinkSync(indexFile);
        } catch {
            // Temp index cleanup is best-effort.
        }
    }
}

/**
 * @param {import('simple-git').SimpleGit} git
 * @param {string} relativePath
 * @param {string} [baseHash]
 */
async function hasDraftChanges(git, relativePath, baseHash) {
    const normalized = relativePath.replace(/\\/g, '/');
    if (!baseHash) {
        return (await getFileStatus(git, normalized)).hasChanges;
    }

    const root = (await git.revparse(['--show-toplevel'])).trim();
    const absolutePath = path.join(root, normalized);
    let current = '';
    try {
        current = fs.readFileSync(absolutePath, 'utf8').trim();
    } catch {
        return true;
    }

    let base = '';
    try {
        base = (await git.show([`${baseHash}:${normalized}`])).trim();
    } catch {
        return true;
    }
    return !urlsMatchForDraft(current, base);
}

/**
 * @param {import('simple-git').SimpleGit} git
 * @param {string} relativePath
 * @param {string} baseHash
 */
async function getDraftStash(git, relativePath, baseHash) {
    const normalized = relativePath.replace(/\\/g, '/');
    const ref = draftStashRef(normalized, baseHash);
    try {
        const hash = (await git.raw(['rev-parse', ref])).trim();
        return { hash, ref };
    } catch {
        return null;
    }
}

/**
 * @param {import('simple-git').SimpleGit} git
 * @param {string} relativePath
 * @param {string} baseHash
 */
async function saveDraftStash(git, relativePath, baseHash) {
    await ensureRepo(git);
    const normalized = relativePath.replace(/\\/g, '/');
    if (!baseHash) {
        return { saved: false, reason: 'no-base' };
    }
    if (!(await hasDraftChanges(git, normalized, baseHash))) {
        return { saved: false, reason: 'no-changes' };
    }

    const author = await resolveAuthor(git);
    const commitHash = await commitFileOnParent(
        git,
        normalized,
        baseHash,
        'Splunk IDE draft stash',
        author
    );
    const ref = draftStashRef(normalized, baseHash);
    await git.raw(['update-ref', ref, commitHash]);
    return { saved: true, hash: commitHash, ref };
}

/**
 * @param {import('simple-git').SimpleGit} git
 * @param {string} relativePath
 * @param {string} baseHash
 * @returns {Promise<{ url: string, query: string } | null>}
 */
async function popDraftStash(git, relativePath, baseHash) {
    const normalized = relativePath.replace(/\\/g, '/');
    const stash = await getDraftStash(git, normalized, baseHash);
    if (!stash) {
        return null;
    }

    const content = await git.show([`${stash.hash}:${normalized}`]);
    const root = (await git.revparse(['--show-toplevel'])).trim();
    const absolutePath = path.join(root, normalized);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, content, 'utf8');
    await git.raw(['update-ref', '-d', stash.ref]);
    return readCurrentQuery(absolutePath);
}

async function listVersionRefHashes(git, relativePath) {
    const fileSlug = sanitizeFileSlug(relativePath);
    try {
        const raw = await git.raw([
            'for-each-ref',
            '--format=%(objectname)',
            `${VERSION_REF_PREFIX}/${fileSlug}/`
        ]);
        return raw.trim().split('\n').filter(Boolean);
    } catch {
        return [];
    }
}

async function getCommitParentHash(git, hash) {
    try {
        return (await git.raw(['rev-parse', `${hash}^`])).trim();
    } catch {
        return undefined;
    }
}

async function buildVersionFromCommit(git, hash, normalized, consumedAutoSaves, options) {
    let showRaw = '';
    try {
        showRaw = await git.raw([
            'show',
            '-s',
            '--pretty=format:%an%x00%ad%x00%s%x00%b',
            '--date=iso-strict',
            hash
        ]);
    } catch {
        return null;
    }

    const [author, date, message, body = ''] = showRaw.split('\0');
    let pathAtCommit = normalized;
    try {
        await git.show([`${hash}:${normalized}`]);
    } catch {
        return null;
    }

    let url = '';
    try {
        url = await git.show([`${hash}:${pathAtCommit}`]);
    } catch {
        return null;
    }

    const version = {
        hash,
        message,
        author,
        date,
        query: extractQueryFromUrl(url),
        url: url.trim()
    };

    const parentHash = await getCommitParentHash(git, hash);
    if (parentHash) {
        version.parentHash = parentHash;
    } else {
        const parentMatch = PARENT_TRAILER_RE.exec(body);
        if (parentMatch) {
            version.parentHash = parentMatch[1];
        }
    }

    if (AUTOSAVE_TRAILER_RE.test(body)) {
        version.isAutoSave = true;
        if (consumedAutoSaves.has(hash)) {
            version.isConsumedAutoSave = true;
            if (!options.includeConsumedAutoSaves) {
                return null;
            }
        }
    }
    return version;
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
        let parentHash = await getCommitParentHash(git, hash);
        if (!parentHash) {
            const parentMatch = PARENT_TRAILER_RE.exec(body);
            if (parentMatch) {
                parentHash = parentMatch[1];
            }
        }
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
        if (parentHash) {
            version.parentHash = parentHash;
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

    const seen = new Set(versions.map(version => version.hash));
    const refHashes = await listVersionRefHashes(git, normalized);
    for (const hash of refHashes) {
        if (seen.has(hash)) {
            continue;
        }
        const version = await buildVersionFromCommit(git, hash, normalized, consumedAutoSaves, options);
        if (version) {
            versions.push(version);
            seen.add(hash);
        }
    }

    versions.sort((a, b) => new Date(b.date) - new Date(a.date));
    return versions.slice(0, maxCount);
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
 * @param {string} message
 * @param {string} [parentHash]
 * @param {{ isAutoSave?: boolean, savedSearch?: { instance?: string, app?: string, owner?: string, name?: string, id?: string } }} [options]
 */
function buildCommitMessage(message, parentHash, options = {}) {
    const trailers = [];
    if (parentHash) {
        trailers.push(`Query-Parent: ${parentHash}`);
    }
    if (options.isAutoSave) {
        trailers.push('Query-Autosave: true');
    }
    const { savedSearch } = options;
    if (savedSearch) {
        if (savedSearch.instance != null) {
            trailers.push(`Splunk-Instance: ${savedSearch.instance}`);
        }
        if (savedSearch.app != null) {
            trailers.push(`Splunk-App: ${savedSearch.app}`);
        }
        if (savedSearch.owner != null) {
            trailers.push(`Splunk-Owner: ${savedSearch.owner}`);
        }
        if (savedSearch.name != null) {
            trailers.push(`Saved-Search: ${savedSearch.name}`);
        }
        if (savedSearch.id != null) {
            trailers.push(`Saved-Search-Id: ${savedSearch.id}`);
        }
    }
    return trailers.length ? `${message}\n\n${trailers.join('\n')}` : message;
}

/**
 * Stage and commit only the given query file.
 * @param {import('simple-git').SimpleGit} git
 * @param {string} relativePath
 * @param {string} message
 * @param {string} [parentHash]
 * @param {{ isAutoSave?: boolean, author?: { name?: string, email?: string }, savedSearch?: { instance?: string, app?: string, owner?: string, name?: string, id?: string } }} [options]
 */
async function saveVersion(git, relativePath, message, parentHash, options = {}) {
    await ensureRepo(git, options);
    const normalized = relativePath.replace(/\\/g, '/');

    let head = '';
    try {
        head = (await git.revparse(['HEAD'])).trim();
    } catch {
        head = '';
    }

    const isOffHeadSave = !!(parentHash && head && parentHash !== head);
    const hasChanges = isOffHeadSave
        ? await hasDraftChanges(git, normalized, parentHash)
        : (await getFileStatus(git, normalized)).hasChanges;
    if (!hasChanges) {
        return { saved: false, reason: 'no-changes' };
    }

    const commitMessage = buildCommitMessage(message, parentHash, options);

    if (isOffHeadSave) {
        const author = await resolveAuthor(git, options);
        const commitHash = await commitFileOnParent(git, normalized, parentHash, commitMessage, author);
        const ref = versionRecordRef(normalized, commitHash);
        await git.raw(['update-ref', ref, commitHash]);
        return { saved: true, hash: commitHash };
    }

    await git.add(normalized);
    await git.commit(commitMessage, [normalized]);
    const savedHash = (await git.revparse(['HEAD'])).trim();
    return { saved: true, hash: savedHash };
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

const TAG_REF_PREFIX = 'search-tag';

function sanitizeRefSegment(value, fallback) {
    const slug = String(value)
        .replace(/[^a-zA-Z0-9._-]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/\.{2,}/g, '-')
        .replace(/^[-./]+|[-./]+$/g, '');
    return slug || fallback;
}

function sanitizeFileSlug(relativePath) {
    return relativePath
        .replace(/\\/g, '/')
        .split('/')
        .map(part => sanitizeRefSegment(part, 'dir'))
        .filter(Boolean)
        .join('--');
}

function versionTagRef(relativePath, tagName) {
    const fileSlug = sanitizeFileSlug(relativePath);
    const nameSlug = sanitizeRefSegment(tagName, 'tag');
    return `${TAG_REF_PREFIX}/${fileSlug}/${nameSlug}`;
}

/**
 * Create or update an annotated git tag scoped to a query file path.
 * @param {import('simple-git').SimpleGit} git
 * @param {string} relativePath
 * @param {string} hash
 * @param {string} name - visible tag label stored in the tag message
 */
async function setVersionTag(git, relativePath, hash, name) {
    await ensureRepo(git);
    const normalized = relativePath.replace(/\\/g, '/');
    const ref = versionTagRef(normalized, name);
    await git.raw(['tag', '-fa', ref, hash, '-m', name]);
    return { ref };
}

/**
 * Delete an annotated git tag scoped to a query file path.
 * @param {import('simple-git').SimpleGit} git
 * @param {string} relativePath
 * @param {string} name - visible tag label used when the tag was created
 */
async function deleteVersionTag(git, relativePath, name) {
    const normalized = relativePath.replace(/\\/g, '/');
    const ref = versionTagRef(normalized, name);
    await git.raw(['tag', '-d', ref]);
    return { ref };
}

/**
 * @typedef {Object} VersionTag
 * @property {string} name
 * @property {string} hash
 * @property {string} date - tagger date when available
 */

/**
 * List annotated tags for a single query file path.
 * @param {import('simple-git').SimpleGit} git
 * @param {string} relativePath
 * @returns {Promise<VersionTag[]>}
 */
async function listVersionTags(git, relativePath) {
    const normalized = relativePath.replace(/\\/g, '/');
    const isRepo = await git.checkIsRepo('root');
    if (!isRepo) {
        return [];
    }

    const fileSlug = sanitizeFileSlug(normalized);
    let raw;
    try {
        raw = await git.raw([
            'for-each-ref',
            '--sort=-taggerdate',
            `refs/tags/${TAG_REF_PREFIX}/${fileSlug}/*`,
            '--format=%(refname:short)%00%(*objectname)%00%(taggerdate:iso-strict)%00%(contents:subject)'
        ]);
    } catch {
        return [];
    }

    if (!raw.trim()) {
        return [];
    }

    return raw.trim().split('\n').map(line => {
        const [, hash, date, tagName] = line.split('\0');
        return {
            name: tagName || '',
            hash: hash || '',
            date: date || ''
        };
    }).filter(tag => tag.hash);
}

function formatSplunkSaveTagName(userName, commitHash, date = new Date()) {
    const user = String(userName || 'user').trim()
        .replace(/[^a-zA-Z0-9._-]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'user';
    const dt = date.toISOString().slice(0, 19).replace('T', '_').replace(/:/g, '-');
    const hash = String(commitHash || '').slice(0, 7);
    return `${dt}_${user}_${hash}`;
}

module.exports = {
    ensureRepo,
    getFileStatus,
    hasDraftChanges,
    getDraftStash,
    saveDraftStash,
    popDraftStash,
    listVersions,
    readCurrentQuery,
    saveVersion,
    restoreVersion,
    renameQueryFile,
    consumeAutoSave,
    setVersionTag,
    deleteVersionTag,
    listVersionTags,
    formatSplunkSaveTagName,
    versionTagRef,
    draftStashRef,
    versionRecordRef
};
