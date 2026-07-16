const fs = require('node:fs');
const path = require('node:path');
const { getSavedSearchId } = require('./saved-search-id');
const { getSavedSearchConfPath } = require('./object-paths');
const { extractStanza, upsertStanza } = require('./conf-stanza');
const { ensureRepo, saveVersion } = require('./query-versions');
const {
    ensureRemote,
    fetchSharedHistory,
    hasRemoteBranch,
    alignSharedBranchWithRemote
} = require('./git-sync');
const { listStanzaDraftsForConf, recomposeWorktree } = require('./stanza-drafts');
const { fetchSavedSearchStanza: defaultFetchSavedSearchStanza } = require('./splunk-rest');

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

async function getHeadHash(git) {
    try {
        return (await git.revparse(['HEAD'])).trim();
    } catch {
        return '';
    }
}

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

/**
 * Checkout shared branch from remote. Untracked canonical files block checkout
 * on fresh repos; temporarily move the worktree file aside and restore it after.
 */
async function checkoutSharedBranch(git, sharedBranch, remoteName, absolutePath) {
    const remoteRef = `refs/remotes/${remoteName}/${sharedBranch}`;
    const backupPath = `${absolutePath}.splunk-ide-pre-checkout`;
    let movedAside = false;

    if (fs.existsSync(absolutePath)) {
        fs.renameSync(absolutePath, backupPath);
        movedAside = true;
    }

    try {
        await git.checkout(['-B', sharedBranch, remoteRef]);
    } catch (err) {
        if (movedAside && fs.existsSync(backupPath)) {
            fs.renameSync(backupPath, absolutePath);
        }
        throw err;
    }

    if (movedAside && fs.existsSync(backupPath)) {
        const kept = fs.readFileSync(backupPath, 'utf8');
        fs.unlinkSync(backupPath);
        fs.writeFileSync(absolutePath, kept, 'utf8');
    }
}

/**
 * @param {{
 *   git: import('simple-git').SimpleGit,
 *   workspaceRoot: string,
 *   metadata: { instance?: string, app?: string, owner?: string, name?: string },
 *   currentUrl?: string,
 *   remoteSettings?: { remoteUrl?: string, remoteName?: string, sharedBranch?: string },
 *   restSettings?: { baseUrl?: string, auth?: object | string, fetch?: typeof fetch },
 *   fetchSavedSearchStanza?: typeof defaultFetchSavedSearchStanza,
 *   author?: { name?: string, email?: string }
 * }} options
 */
async function openSavedSearchHistory({
    git,
    workspaceRoot,
    metadata,
    currentUrl,
    remoteSettings = {},
    restSettings = {},
    fetchSavedSearchStanza = defaultFetchSavedSearchStanza,
    author
}) {
    const confPath = getSavedSearchConfPath(metadata);
    const stanzaName = String(metadata.name ?? '').trim();
    const savedSearchId = getSavedSearchId(metadata);
    const absolutePath = path.join(workspaceRoot, confPath);

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
                await alignSharedBranchWithRemote(git, { remoteName, sharedBranch });
                if (await hasRemoteBranch(git, remoteName, sharedBranch)) {
                    try {
                        await checkoutSharedBranch(git, sharedBranch, remoteName, absolutePath);
                    } catch (err) {
                        if (!String(err.message || '').includes("didn't match any file")) {
                            warning = err.message || 'checkout failed';
                        }
                    }
                }
            } else {
                warning = fetchResult.message || 'fetch failed';
            }
        }
    }

    const headHash = await getHeadHash(git);
    const headConf = await readHeadConf(git, confPath, headHash);
    const drafts = await listStanzaDraftsForConf(git, confPath);
    const draftForStanza = drafts.find((entry) => entry.name === stanzaName);
    let imported = false;
    let stanzaSource = 'missing';

    if (draftForStanza) {
        await recomposeWorktree(git, confPath, headHash);
        stanzaSource = 'draft';
    } else if (extractStanza(headConf, stanzaName)) {
        if (!fs.existsSync(absolutePath)) {
            if (!(await restoreFromGit(git, confPath))) {
                fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
                fs.writeFileSync(absolutePath, headConf, 'utf8');
            }
        }
        if (drafts.length > 0) {
            await recomposeWorktree(git, confPath, headHash);
        }
        stanzaSource = 'head';
    } else if (restSettings.baseUrl) {
        try {
            const stanzaText = await fetchSavedSearchStanza({
                baseUrl: restSettings.baseUrl,
                auth: restSettings.auth,
                app: metadata.app,
                owner: metadata.owner,
                name: stanzaName,
                fetch: restSettings.fetch
            });
            const toCommit = upsertStanza(headConf, stanzaName, stanzaText);
            fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
            fs.writeFileSync(absolutePath, toCommit, 'utf8');
            const saveResult = await saveVersion(git, confPath, 'Import saved search', undefined, {
                author,
                savedSearch: { ...metadata, id: savedSearchId }
            });
            imported = saveResult.saved === true;
            stanzaSource = 'import';

            const newHeadHash = await getHeadHash(git);
            if (drafts.length > 0) {
                await recomposeWorktree(git, confPath, newHeadHash);
            }
        } catch (err) {
            warning = warning || err.message || 'REST import failed';
        }
    } else if (!warning) {
        warning = 'saved search missing from git and no REST config for import';
    }

    return {
        relativePath: confPath,
        confPath,
        stanzaName,
        stanzaSource,
        imported,
        fetched,
        warning
    };
}

module.exports = { openSavedSearchHistory };
