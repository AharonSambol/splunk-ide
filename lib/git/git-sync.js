/**
 * Remote sync helpers with the saved-search refspec policy.
 * Callers should not build raw refspec strings themselves.
 */

const { reconcileConfFromRest } = require('./reconcile');

function buildFetchRefspecs(remoteName) {
    return [
        `+refs/heads/*:refs/remotes/${remoteName}/*`,
        '+refs/tags/search-tag/*:refs/tags/search-tag/*',
        '+refs/splunk-ide/versions/*:refs/splunk-ide/versions/*'
    ];
}

function buildPushRefspecs(sharedBranch) {
    return [
        `HEAD:refs/heads/${sharedBranch}`,
        'refs/tags/search-tag/*:refs/tags/search-tag/*',
        'refs/splunk-ide/versions/*:refs/splunk-ide/versions/*'
    ];
}

/**
 * @param {import('simple-git').SimpleGit} git
 * @param {{ remoteName?: string, remoteUrl: string }} options
 */
async function ensureRemote(git, { remoteName = 'origin', remoteUrl } = {}) {
    if (!remoteUrl) {
        return { ok: false, message: 'remote URL is required' };
    }

    try {
        const remotes = await git.getRemotes(true);
        const existing = remotes.find(remote => remote.name === remoteName);
        if (!existing) {
            await git.addRemote(remoteName, remoteUrl);
        } else if (existing.refs.fetch !== remoteUrl || existing.refs.push !== remoteUrl) {
            await git.remote(['set-url', remoteName, remoteUrl]);
        }
        return { ok: true };
    } catch (error) {
        return { ok: false, message: error.message || String(error) };
    }
}

/**
 * @param {import('simple-git').SimpleGit} git
 * @param {{ remoteName?: string }} [options]
 */
async function fetchSharedHistory(git, { remoteName = 'origin' } = {}) {
    try {
        await git.fetch([remoteName, ...buildFetchRefspecs(remoteName)]);
        return { ok: true };
    } catch (error) {
        return { ok: false, message: error.message || String(error) };
    }
}

async function hasRemoteBranch(git, remoteName = 'origin', branch = 'main') {
    try {
        await git.revparse([`refs/remotes/${remoteName}/${branch}^{commit}`]);
        return true;
    } catch {
        return false;
    }
}

async function sharesHistory(git, a, b) {
    if (!a || !b || a === b) {
        return true;
    }
    try {
        const mergeBase = (await git.raw(['merge-base', a, b])).trim();
        return Boolean(mergeBase);
    } catch {
        return false;
    }
}

/**
 * Fast-forward when behind remote; reset --mixed onto remote when histories are unrelated.
 * @param {import('simple-git').SimpleGit} git
 * @param {{ remoteName?: string, sharedBranch: string }} options
 */
async function alignSharedBranchWithRemote(git, { remoteName = 'origin', sharedBranch } = {}) {
    const { isCommitAncestor } = require('./stanza-drafts');

    if (!sharedBranch) {
        return { ok: false, message: 'shared branch is required' };
    }
    if (!await hasRemoteBranch(git, remoteName, sharedBranch)) {
        return { ok: true, aligned: false };
    }

    const remoteRef = `refs/remotes/${remoteName}/${sharedBranch}`;
    let local = '';
    let remote = '';
    try {
        local = (await git.revparse(['HEAD'])).trim();
        remote = (await git.revparse([remoteRef])).trim();
    } catch {
        return { ok: true, aligned: false };
    }

    if (local === remote) {
        return { ok: true, aligned: false };
    }

    if (await isCommitAncestor(git, local, remote)) {
        await git.merge([`${remoteName}/${sharedBranch}`, '--ff-only']);
        return { ok: true, aligned: true, fastForward: true };
    }

    if (await isCommitAncestor(git, remote, local)) {
        return { ok: true, aligned: false };
    }

    if (!(await sharesHistory(git, local, remote))) {
        await git.reset(['--mixed', remoteRef]);
        return { ok: true, aligned: true, resetUnrelated: true };
    }

    return { ok: true, aligned: false };
}

/**
 * @param {import('simple-git').SimpleGit} git
 * @param {{ remoteName?: string, sharedBranch: string }} options
 */
async function pushSharedHistory(git, { remoteName = 'origin', sharedBranch } = {}) {
    if (!sharedBranch) {
        return { ok: false, message: 'shared branch is required' };
    }

    try {
        await git.push([remoteName, ...buildPushRefspecs(sharedBranch)]);
        return { ok: true };
    } catch (error) {
        return { ok: false, message: error.message || String(error) };
    }
}

function isNonFastForwardPushError(message) {
    const normalized = String(message || '').toLowerCase();
    return /non-fast-forward|rejected|fetch first|failed to push some refs|would be overwritten/.test(normalized);
}

/**
 * Push shared history; on non-fast-forward, reconcile from REST then retry once.
 * @param {import('simple-git').SimpleGit} git
 * @param {{ remoteName?: string, sharedBranch: string, reconcile?: object }} options
 */
async function pushSharedHistoryWithReconcile(git, { remoteName = 'origin', sharedBranch, reconcile } = {}) {
    const align = await alignSharedBranchWithRemote(git, { remoteName, sharedBranch });
    if (!align.ok) {
        return { ok: false, message: align.message, reconciled: false, conflicts: [] };
    }

    const first = await pushSharedHistory(git, { remoteName, sharedBranch });
    if (first.ok) {
        return { ...first, reconciled: false, conflicts: [] };
    }
    if (!reconcile || !isNonFastForwardPushError(first.message)) {
        return { ...first, reconciled: false, conflicts: [] };
    }

    const reconciled = await reconcileConfFromRest(git, {
        ...reconcile,
        remoteSettings: {
            remoteName,
            sharedBranch,
            ...(reconcile.remoteSettings || {})
        }
    });
    if (!reconciled.ok) {
        return {
            ok: false,
            message: reconciled.message || first.message,
            reconciled: false,
            conflicts: reconciled.conflicts || []
        };
    }

    const second = await pushSharedHistory(git, { remoteName, sharedBranch });
    return {
        ...second,
        reconciled: true,
        conflicts: reconciled.conflicts || [],
        committed: reconciled.committed === true,
        hash: reconciled.hash
    };
}

module.exports = {
    ensureRemote,
    fetchSharedHistory,
    hasRemoteBranch,
    alignSharedBranchWithRemote,
    pushSharedHistory,
    pushSharedHistoryWithReconcile,
    isNonFastForwardPushError,
    buildFetchRefspecs,
    buildPushRefspecs
};
