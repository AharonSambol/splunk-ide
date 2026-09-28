const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { withConfLock } = require('./conf-lock');
const { extractQueryFromUrl, urlsMatchForDraft } = require('../splunk-url');

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
 * Commit explicit file content on top of parentHash via temp index (not worktree).
 * @param {import('simple-git').SimpleGit} git
 * @param {string} relativePath
 * @param {string} parentHash
 * @param {string} content
 * @param {string} message
 * @param {{ name: string, email: string }} author
 */
function extractSearchFromStanza(stanzaText) {
    if (!stanzaText) {
        return '';
    }
    const match = stanzaText.match(/^search\s*=\s*(.*)$/m);
    return match ? match[1].trim() : '';
}

async function commitFileContentOnParent(git, relativePath, parentHash, content, message, author) {
    const gitDir = (await git.revparse(['--absolute-git-dir'])).trim();
    const indexFile = path.join(gitDir, `splunk-ide-idx-${process.pid}-${Date.now()}`);
    const blobFile = path.join(gitDir, `splunk-ide-blob-${process.pid}-${Date.now()}`);
    const env = { GIT_INDEX_FILE: indexFile, ...authorEnv(author) };

    try {
        if (parentHash) {
            const parentTree = await gitExec(git, ['rev-parse', `${parentHash}^{tree}`], env);
            await gitExec(git, ['read-tree', parentTree], env);
        }
        fs.writeFileSync(blobFile, content, 'utf8');
        const blobHash = await gitExec(git, ['hash-object', '-w', blobFile], env);
        await gitExec(
            git,
            ['update-index', '--add', '--cacheinfo', '100644', blobHash, relativePath],
            env
        );
        const tree = await gitExec(git, ['write-tree'], env);
        const commitArgs = parentHash
            ? ['commit-tree', tree, '-p', parentHash, '-m', message]
            : ['commit-tree', tree, '-m', message];
        return await gitExec(git, commitArgs, env);
    } finally {
        for (const file of [blobFile, indexFile]) {
            try {
                fs.unlinkSync(file);
            } catch {
                // Temp file cleanup is best-effort.
            }
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
    const { savedSearch, dashboard } = options;
    if (savedSearch) {
        trailers.push('Object-Type: savedsearch');
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
    if (dashboard) {
        trailers.push('Object-Type: dashboard');
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

function slugStanzaForRef(stanzaName) {
    const slugged = String(stanzaName ?? '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^[.\-\s]+|[.\-\s]+$/g, '');
    return slugged || 'untitled';
}

/**
 * @typedef {Object} VersionTag
 * @property {string} name
 * @property {string} hash
 * @property {string} date - tagger date when available
 */

module.exports = {
    ensureRepo,
    resolveAuthor,
    getFileStatus,
    hasDraftChanges,
    getDraftStash,
    saveDraftStash,
    popDraftStash,
    readCurrentQuery,
    saveVersion,
    commitFileContentOnParent,
    buildCommitMessage,
    getConsumedAutoSaveHashes,
    VERSION_REF_PREFIX,
    PARENT_TRAILER_RE,
    AUTOSAVE_TRAILER_RE,
    restoreVersion,
    renameQueryFile,
    consumeAutoSave,
    extractSearchFromStanza,
    sanitizeFileSlug,
    sanitizeRefSegment,
    slugStanzaForRef,
    draftStashRef,
    versionRecordRef
};

// Lazy re-exports: every existing require('./query-versions') caller keeps
// working, and the moved files can require this file without a load-order
// cycle (getters fire only after this module finishes loading).
for (const [file, names] of [
    ['./version-read', [
        'listVersionRefHashes',
        'getCommitParentHash',
        'readConfAtCommit',
        'readVersionStanza',
        'stanzaChangedInCommit',
        'buildVersionFromCommit',
        'listVersions',
    ]],
    ['./stanza-versions', [
        'saveStanzaVersion',
        'autoSaveStanzaBeforeRestore',
        'restoreStanzaVersion',
        'restoreStanzaAutoSaveVersion',
        'discardStanzaDraft',
        'shouldSkipAutoSaveOnRestore',
    ]],
    ['./version-tags', [
        'setVersionTag',
        'deleteVersionTag',
        'listVersionTags',
        'formatSplunkSaveTagName',
        'versionTagRef',
    ]],
]) {
    for (const name of names) {
        Object.defineProperty(module.exports, name, {
            enumerable: true,
            get() {
                return require(file)[name];
            }
        });
    }
}
