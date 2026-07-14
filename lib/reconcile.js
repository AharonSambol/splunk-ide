/**
 * Reconcile diverged shared conf history from Splunk REST (no three-way merge).
 */

const fs = require('node:fs');
const path = require('node:path');
const { upsertStanza } = require('./conf-stanza');
const { ensureRepo, commitFileContentOnParent, readVersionStanza, resolveAuthor } = require('./query-versions');
const {
    listStanzaDraftsForConf,
    recomposeWorktreeImpl,
    isCommitAncestor
} = require('./stanza-drafts');
const { fetchSavedSearchStanza: defaultFetchSavedSearchStanza } = require('./splunk-rest');

const STANZA_CONFLICT_STATUS = 'Stanza conflict';

async function readHeadConf(git, confPath, headHash) {
    if (!headHash) {
        return '';
    }
    try {
        return await git.show([`${headHash}:${confPath}`]);
    } catch {
        return '';
    }
}

function collectStanzaNames(stanzas, metadata) {
    const names = new Set();
    if (metadata?.name) {
        names.add(String(metadata.name).trim());
    }
    for (const entry of stanzas || []) {
        if (typeof entry === 'string') {
            names.add(entry.trim());
        } else if (entry?.name) {
            names.add(String(entry.name).trim());
        }
    }
    return [...names].filter(Boolean);
}

/**
 * Remote changed a stanza since the draft base while a local draft still exists.
 * @param {import('simple-git').SimpleGit} git
 * @param {string} confPath
 * @param {string} remoteHash
 */
async function detectStanzaConflicts(git, confPath, remoteHash) {
    const normalized = confPath.replace(/\\/g, '/');
    const drafts = await listStanzaDraftsForConf(git, normalized);
    const conflicts = [];

    for (const draft of drafts) {
        const remoteStanza = await readVersionStanza(git, normalized, remoteHash, draft.name);
        const baseStanza = await readVersionStanza(git, normalized, draft.baseHash, draft.name);
        if (remoteStanza !== null && remoteStanza !== baseStanza) {
            conflicts.push({ name: draft.name, status: STANZA_CONFLICT_STATUS });
        }
    }

    return conflicts;
}

async function syncRemoteBranch(git, { remoteName = 'origin', sharedBranch }) {
    const remoteRef = `refs/remotes/${remoteName}/${sharedBranch}`;
    let local = '';
    let remote = '';
    try {
        local = (await git.revparse(['HEAD'])).trim();
        remote = (await git.raw(['rev-parse', remoteRef])).trim();
    } catch {
        return { ok: true, merged: false };
    }

    if (!remote || local === remote) {
        return { ok: true, merged: false };
    }

    if (await isCommitAncestor(git, remote, local)) {
        return { ok: true, merged: false };
    }

    if (await isCommitAncestor(git, local, remote)) {
        await git.merge([`${remoteName}/${sharedBranch}`, '--ff-only']);
        return { ok: true, merged: true, fastForward: true };
    }

    try {
        await git.merge([`${remoteName}/${sharedBranch}`, '-m', `Merge remote ${sharedBranch}`]);
        return { ok: true, merged: true };
    } catch (error) {
        const status = await git.status();
        const conflicted = status.conflicted || [];
        if (conflicted.length === 0) {
            return { ok: false, message: error.message || String(error) };
        }
        for (const file of conflicted) {
            await git.checkout(['--theirs', '--', file]);
            await git.add(file);
        }
        await git.commit(`Merge remote ${sharedBranch}`);
        return { ok: true, merged: true, resolvedConflicts: true };
    }
}

/**
 * @param {import('simple-git').SimpleGit} git
 * @param {{
 *   confPath: string,
 *   metadata?: { instance?: string, app?: string, owner?: string, name?: string },
 *   stanzas?: Array<string | { name: string }>,
 *   restSettings?: { baseUrl?: string, auth?: object | string, fetch?: typeof fetch },
 *   fetchSavedSearchStanza?: typeof defaultFetchSavedSearchStanza,
 *   remoteSettings?: { remoteName?: string, sharedBranch?: string },
 *   author?: { name?: string, email?: string },
 *   commitMessage?: string,
 *   skipFetch?: boolean
 * }} options
 */
async function reconcileConfFromRest(git, options = {}) {
    const {
        confPath,
        metadata = {},
        stanzas = [],
        restSettings = {},
        fetchSavedSearchStanza = defaultFetchSavedSearchStanza,
        remoteSettings = {},
        author,
        commitMessage = 'Reconcile from Splunk',
        skipFetch = false
    } = options;

    const normalized = confPath.replace(/\\/g, '/');
    const remoteName = remoteSettings.remoteName || 'origin';
    const sharedBranch = remoteSettings.sharedBranch || 'main';

    if (!restSettings.baseUrl) {
        return { ok: false, message: 'REST baseUrl is required for reconcile' };
    }

    await ensureRepo(git, { author });

    if (!skipFetch) {
        const { fetchSharedHistory } = require('./git-sync');
        const fetched = await fetchSharedHistory(git, { remoteName });
        if (!fetched.ok) {
            return { ok: false, message: fetched.message || 'fetch failed' };
        }
    }

    let remoteHash = '';
    try {
        remoteHash = (await git.raw(['rev-parse', `refs/remotes/${remoteName}/${sharedBranch}`])).trim();
    } catch {
        return { ok: false, message: 'remote branch not found after fetch' };
    }

    const conflicts = await detectStanzaConflicts(git, normalized, remoteHash);

    let headBeforeMerge = '';
    try {
        headBeforeMerge = (await git.revparse(['HEAD'])).trim();
    } catch {
        headBeforeMerge = '';
    }
    if (headBeforeMerge) {
        try {
            await git.checkout(['HEAD', '--', normalized]);
        } catch {
            // Missing path in HEAD is fine before merge.
        }
    }

    const merged = await syncRemoteBranch(git, { remoteName, sharedBranch });
    if (!merged.ok) {
        return { ok: false, message: merged.message || 'merge failed', conflicts };
    }

    let parentHash = '';
    try {
        parentHash = (await git.revparse(['HEAD'])).trim();
    } catch {
        parentHash = '';
    }

    const stanzaNames = collectStanzaNames(stanzas, metadata);
    const drafts = await listStanzaDraftsForConf(git, normalized);
    for (const draft of drafts) {
        if (!stanzaNames.includes(draft.name)) {
            stanzaNames.push(draft.name);
        }
    }

    let conf = await readHeadConf(git, normalized, parentHash);
    for (const name of stanzaNames) {
        const stanzaText = await fetchSavedSearchStanza({
            baseUrl: restSettings.baseUrl,
            auth: restSettings.auth,
            app: metadata.app,
            owner: metadata.owner,
            name,
            fetch: restSettings.fetch
        });
        conf = upsertStanza(conf, name, stanzaText);
    }

    const headConf = await readHeadConf(git, normalized, parentHash);
    let committed = false;
    let commitHash = parentHash;

    if (conf !== headConf) {
        const resolvedAuthor = await resolveAuthor(git, { author });
        commitHash = await commitFileContentOnParent(
            git,
            normalized,
            parentHash,
            conf,
            commitMessage,
            resolvedAuthor
        );
        if (parentHash) {
            await git.raw(['update-ref', 'HEAD', commitHash, parentHash]);
        } else {
            await git.raw(['update-ref', 'HEAD', commitHash]);
        }
        committed = true;
    }

    const root = (await git.revparse(['--show-toplevel'])).trim();
    const absolutePath = path.join(root, normalized);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    await recomposeWorktreeImpl(git, normalized, commitHash);

    return {
        ok: true,
        committed,
        hash: commitHash,
        conflicts,
        merged: merged.merged === true
    };
}

module.exports = {
    STANZA_CONFLICT_STATUS,
    detectStanzaConflicts,
    reconcileConfFromRest
};
