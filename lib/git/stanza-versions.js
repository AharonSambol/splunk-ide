'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { extractStanza, upsertStanza } = require('../objects/conf-stanza');
const { withConfLock } = require('./conf-lock');
const {
    ensureRepo,
    resolveAuthor,
    readConfAtCommit,
    readVersionStanza,
    extractSearchFromStanza,
    buildCommitMessage,
    commitFileContentOnParent,
    consumeAutoSave,
} = require('./query-versions');

/**
 * Stanza-scoped version ops: save/restore/discard one stanza inside a shared
 * conf file. The X/Impl pairs wrap mutating ops in withConfLock so concurrent
 * tabs cannot interleave writes to the same conf.
 */

function setStanzaSearch(stanzaText, stanzaName, search) {
    if (!stanzaText) {
        return `[${stanzaName}]\nsearch = ${search}\n\n`;
    }
    if (/^search\s*=/m.test(stanzaText)) {
        return stanzaText.replace(/^search\s*=.*$/m, `search = ${search}`);
    }
    const lines = stanzaText.split('\n');
    if (lines[0]?.startsWith('[')) {
        lines.splice(1, 0, `search = ${search}`);
        const block = lines.join('\n');
        return block.endsWith('\n') ? block : `${block}\n`;
    }
    return `[${stanzaName}]\nsearch = ${search}\n\n`;
}

/**
 * Save one stanza into a shared conf file: upsert(HEAD, stanza, draft) via temp index.
 * Sibling stanzas in the commit come from HEAD, not sibling drafts.
 * @param {import('simple-git').SimpleGit} git
 * @param {string} confPath
 * @param {string} stanzaName
 * @param {string} message
 * @param {{ author?: { name?: string, email?: string }, savedSearch?: object }} [options]
 */
async function saveStanzaVersion(git, confPath, stanzaName, message, options = {}) {
    return withConfLock(confPath, () =>
        saveStanzaVersionImpl(git, confPath, stanzaName, message, options)
    );
}

async function saveStanzaVersionImpl(git, confPath, stanzaName, message, options = {}) {
    const {
        deleteStanzaDraft,
        listStanzaDraftsForConf,
        recomposeWorktreeImpl
    } = require('./stanza-drafts');

    await ensureRepo(git, options);
    const normalized = confPath.replace(/\\/g, '/');

    let parentHash = '';
    try {
        parentHash = (await git.revparse(['HEAD'])).trim();
    } catch {
        parentHash = '';
    }

    const headConf = parentHash ? await readConfAtCommit(git, normalized, parentHash) : '';
    const drafts = await listStanzaDraftsForConf(git, normalized);
    const draft = drafts.find((entry) => entry.name === stanzaName);

    let stanzaText = draft?.text;
    if (!stanzaText) {
        const root = (await git.revparse(['--show-toplevel'])).trim();
        const absolutePath = path.join(root, normalized);
        let worktreeConf = '';
        try {
            worktreeConf = fs.readFileSync(absolutePath, 'utf8');
        } catch {
            worktreeConf = '';
        }
        stanzaText = extractStanza(worktreeConf, stanzaName);
    }

    if (options.seedSearchText != null) {
        const seedSearch = String(options.seedSearchText).trim();
        if (!seedSearch) {
            if (!stanzaText) {
                return { saved: false, reason: 'missing-query' };
            }
        } else {
            const currentSearch = extractSearchFromStanza(stanzaText);
            if (!stanzaText || currentSearch !== seedSearch) {
                stanzaText = setStanzaSearch(stanzaText, stanzaName, seedSearch);
            }
        }
    }

    if (!stanzaText) {
        return { saved: false, reason: 'missing-stanza' };
    }

    const headStanza = extractStanza(headConf, stanzaName);
    if (stanzaText === headStanza) {
        return { saved: false, reason: 'no-changes' };
    }

    const toCommit = upsertStanza(headConf, stanzaName, stanzaText);
    const author = await resolveAuthor(git, options);
    const commitMessage = buildCommitMessage(message, parentHash || undefined, options);
    const commitHash = await commitFileContentOnParent(
        git,
        normalized,
        parentHash,
        toCommit,
        commitMessage,
        author
    );

    if (parentHash) {
        await git.raw(['update-ref', 'HEAD', commitHash, parentHash]);
    } else {
        await git.raw(['update-ref', 'HEAD', commitHash]);
    }

    if (draft) {
        await deleteStanzaDraft(git, normalized, stanzaName, draft.baseHash);
    }

    await recomposeWorktreeImpl(git, normalized, commitHash);
    return { saved: true, hash: commitHash };
}

/**
 * Commit dirty stanza work before restoring to a historical version.
 * @param {import('simple-git').SimpleGit} git
 * @param {string} confPath
 * @param {string} stanzaName
 * @param {string} targetHash
 * @param {{ seedSearchText?: string, isAutoSave?: boolean, author?: { name?: string, email?: string }, savedSearch?: object }} [options]
 */
async function autoSaveStanzaBeforeRestore(git, confPath, stanzaName, targetHash, options = {}) {
    const { listStanzaDraftsForConf } = require('./stanza-drafts');
    const normalized = confPath.replace(/\\/g, '/');

    const drafts = await listStanzaDraftsForConf(git, normalized);
    const hasDraft = drafts.some((entry) => entry.name === stanzaName);

    const targetStanza = await readVersionStanza(git, normalized, targetHash, stanzaName);
    const targetSearch = extractSearchFromStanza(targetStanza || '').trim();

    let liveSearch = '';
    if (options.seedSearchText != null) {
        liveSearch = String(options.seedSearchText).trim();
    } else if (hasDraft) {
        const draft = drafts.find((entry) => entry.name === stanzaName);
        liveSearch = extractSearchFromStanza(draft?.text || '').trim();
    }

    const liveDiffersFromTarget = Boolean(liveSearch && targetSearch && liveSearch !== targetSearch);
    if (!hasDraft && !liveDiffersFromTarget) {
        return { saved: false, reason: 'no-dirty-work' };
    }

    const shortHash = targetHash.substring(0, 7);
    return saveStanzaVersion(git, normalized, stanzaName, `Auto-save before restore to ${shortHash}`, {
        ...options,
        isAutoSave: true
    });
}

/**
 * Restore one stanza from history into a durable draft; recompose worktree.
 * Never checks out the whole conf file.
 * @param {import('simple-git').SimpleGit} git
 * @param {string} confPath
 * @param {string} stanzaName
 * @param {string} hash - historical commit to restore from
 * @param {object} [options]
 */
async function restoreStanzaVersion(git, confPath, stanzaName, hash, options = {}) {
    return withConfLock(confPath, () =>
        restoreStanzaVersionImpl(git, confPath, stanzaName, hash, options)
    );
}

async function restoreStanzaVersionImpl(git, confPath, stanzaName, hash, options = {}) {
    const {
        saveStanzaDraftImpl,
        deleteStanzaDraft,
        listStanzaDraftsForConf,
        recomposeWorktreeImpl
    } = require('./stanza-drafts');

    await ensureRepo(git, options);
    const normalized = confPath.replace(/\\/g, '/');

    const stanzaText = await readVersionStanza(git, normalized, hash, stanzaName);
    if (!stanzaText) {
        return { restored: false, reason: 'missing-stanza' };
    }

    const existing = await listStanzaDraftsForConf(git, normalized);
    for (const draft of existing) {
        if (draft.name === stanzaName) {
            await deleteStanzaDraft(git, normalized, stanzaName, draft.baseHash);
        }
    }

    await saveStanzaDraftImpl(git, normalized, stanzaName, hash, stanzaText);

    let headHash = '';
    try {
        headHash = (await git.revparse(['HEAD'])).trim();
    } catch {
        headHash = '';
    }

    await recomposeWorktreeImpl(git, normalized, headHash);
    return { restored: true, stanzaText, baseHash: hash };
}

/**
 * Check out a consumed auto-save stanza as the new draft (plain .spl parity).
 * @param {import('simple-git').SimpleGit} git
 * @param {string} confPath
 * @param {string} stanzaName
 * @param {string} hash - auto-save commit to consume
 * @param {string} [parentHash] - tracked base when the auto-save was created
 */
async function restoreStanzaAutoSaveVersion(git, confPath, stanzaName, hash, parentHash) {
    return withConfLock(confPath, () =>
        restoreStanzaAutoSaveVersionImpl(git, confPath, stanzaName, hash, parentHash)
    );
}

async function restoreStanzaAutoSaveVersionImpl(git, confPath, stanzaName, hash, parentHash) {
    const {
        saveStanzaDraftImpl,
        deleteStanzaDraft,
        listStanzaDraftsForConf,
        recomposeWorktreeImpl
    } = require('./stanza-drafts');

    await ensureRepo(git);
    const normalized = confPath.replace(/\\/g, '/');

    const stanzaText = await readVersionStanza(git, normalized, hash, stanzaName);
    if (!stanzaText) {
        return { restored: false, reason: 'missing-stanza' };
    }

    const baseHash = parentHash || hash;
    const existing = await listStanzaDraftsForConf(git, normalized);
    for (const draft of existing) {
        if (draft.name === stanzaName) {
            await deleteStanzaDraft(git, normalized, stanzaName, draft.baseHash);
        }
    }

    await saveStanzaDraftImpl(git, normalized, stanzaName, baseHash, stanzaText);

    let headHash = '';
    try {
        headHash = (await git.revparse(['HEAD'])).trim();
    } catch {
        headHash = '';
    }

    await consumeAutoSave(git, hash);
    if (hash === headHash) {
        await git.raw(['reset', '--mixed', `${hash}^`]);
    }

    let recomposeHead = '';
    try {
        recomposeHead = (await git.revparse(['HEAD'])).trim();
    } catch {
        recomposeHead = '';
    }

    await recomposeWorktreeImpl(git, normalized, recomposeHead);
    return { restored: true, stanzaText, baseHash };
}

/**
 * Discard one stanza's draft ref(s) and recompose worktree from HEAD + remaining drafts.
 * @param {import('simple-git').SimpleGit} git
 * @param {string} confPath
 * @param {string} stanzaName
 * @param {object} [options]
 */
async function discardStanzaDraft(git, confPath, stanzaName, options = {}) {
    return withConfLock(confPath, () =>
        discardStanzaDraftImpl(git, confPath, stanzaName, options)
    );
}

async function discardStanzaDraftImpl(git, confPath, stanzaName, options = {}) {
    const {
        deleteStanzaDraft,
        listStanzaDraftsForConf,
        recomposeWorktreeImpl
    } = require('./stanza-drafts');

    await ensureRepo(git, options);
    const normalized = confPath.replace(/\\/g, '/');

    const existing = await listStanzaDraftsForConf(git, normalized);
    const toDelete = existing.filter((draft) => draft.name === stanzaName);
    if (toDelete.length === 0) {
        return { discarded: false, reason: 'no-draft' };
    }

    for (const draft of toDelete) {
        await deleteStanzaDraft(git, normalized, stanzaName, draft.baseHash);
    }

    let headHash = '';
    try {
        headHash = (await git.revparse(['HEAD'])).trim();
    } catch {
        headHash = '';
    }

    await recomposeWorktreeImpl(git, normalized, headHash);
    return { discarded: true };
}

function shouldSkipAutoSaveOnRestore(version, isDirty) {
    return !!version?.isAutoSave || !isDirty;
}

module.exports = {
    saveStanzaVersion,
    autoSaveStanzaBeforeRestore,
    restoreStanzaVersion,
    restoreStanzaAutoSaveVersion,
    discardStanzaDraft,
    shouldSkipAutoSaveOnRestore,
    setStanzaSearch,
};
