const fs = require('node:fs');
const path = require('node:path');
const { getSavedSearchId, getSavedSearchPath } = require('./saved-search-id');
const { ensureRepo, saveVersion } = require('./query-versions');
const { ensureRemote, fetchSharedHistory } = require('./git-sync');

async function latestCommitWithFile(git, relativePath) {
    try {
        return (await git.raw(['rev-list', '-1', 'HEAD', '--', relativePath])).trim();
    } catch {
        return '';
    }
}

/**
 * @param {import('simple-git').SimpleGit} git
 * @param {string} relativePath
 */
async function restoreFromGit(git, relativePath) {
    const hash = await latestCommitWithFile(git, relativePath);
    if (!hash) {
        return false;
    }
    await git.checkout([hash, '--', relativePath]);
    return true;
}

/**
 * @param {{
 *   git: import('simple-git').SimpleGit,
 *   workspaceRoot: string,
 *   metadata: { instance?: string, app?: string, owner?: string, name?: string },
 *   currentUrl: string,
 *   remoteSettings?: { remoteUrl?: string, remoteName?: string, sharedBranch?: string },
 *   author?: { name?: string, email?: string }
 * }} options
 */
async function openSavedSearchHistory({
    git,
    workspaceRoot,
    metadata,
    currentUrl,
    remoteSettings = {},
    author
}) {
    const relativePath = getSavedSearchPath(metadata);
    const savedSearchId = getSavedSearchId(metadata);
    const absolutePath = path.join(workspaceRoot, relativePath);

    await ensureRepo(git, { author });

    const remoteName = remoteSettings.remoteName || 'origin';
    const sharedBranch = remoteSettings.sharedBranch || 'main';
    let fetched = false;
    let warning = '';

    if (remoteSettings.remoteUrl) {
        const remoteResult = await ensureRemote(git, {
            remoteName,
            remoteUrl: remoteSettings.remoteUrl
        });
        if (!remoteResult.ok) {
            warning = remoteResult.message || 'remote setup failed';
        } else {
            const fetchResult = await fetchSharedHistory(git, { remoteName });
            if (fetchResult.ok) {
                fetched = true;
                try {
                    await git.checkout(['-B', sharedBranch, `refs/remotes/${remoteName}/${sharedBranch}`]);
                } catch {
                    // Shared branch may not exist yet on first open.
                }
            } else {
                warning = fetchResult.message || 'fetch failed';
            }
        }
    }

    let imported = false;

    if (fs.existsSync(absolutePath)) {
        // ponytail: existing worktree file wins over current Splunk content
    } else if (await restoreFromGit(git, relativePath)) {
        // File restored from git history.
    } else {
        fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
        fs.writeFileSync(absolutePath, currentUrl, 'utf8');
        await saveVersion(git, relativePath, 'Import saved search', undefined, {
            author,
            savedSearch: { ...metadata, id: savedSearchId }
        });
        imported = true;
    }

    return { relativePath, imported, fetched, warning };
}

module.exports = { openSavedSearchHistory };
