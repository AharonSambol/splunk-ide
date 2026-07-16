const fs = require('node:fs');
const path = require('node:path');
const { getDashboardViewPath } = require('./object-paths');
const { ensureRepo, saveVersion } = require('./query-versions');
const {
    ensureRemote,
    fetchSharedHistory,
    hasRemoteBranch,
    alignSharedBranchWithRemote
} = require('./git-sync');
const { fetchDashboardView: defaultFetchDashboardView } = require('./splunk-rest');

function detectViewExt(body) {
    const trimmed = String(body ?? '').trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        return 'json';
    }
    return 'xml';
}

function resolveDashboardViewPath(dashboard) {
    return getDashboardViewPath({
        instance: dashboard.instance,
        app: dashboard.app,
        owner: dashboard.owner,
        name: dashboard.name,
        ext: dashboard.ext || 'xml'
    });
}

async function latestCommitWithFile(git, relativePath) {
    try {
        return (await git.raw(['rev-list', '-1', 'HEAD', '--', relativePath])).trim();
    } catch {
        return '';
    }
}

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

async function readHeadViewBody(git, metadata, headHash) {
    if (!headHash) {
        return null;
    }
    for (const ext of ['xml', 'json']) {
        const viewPath = getDashboardViewPath({ ...metadata, ext });
        try {
            const body = await git.show([`${headHash}:${viewPath}`]);
            if (body) {
                return { viewPath, body, ext };
            }
        } catch {
            // Try the other extension.
        }
    }
    return null;
}

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
 *   metadata: { instance?: string, app?: string, owner?: string, name?: string, ext?: string },
 *   remoteSettings?: { remoteUrl?: string, remoteName?: string, sharedBranch?: string },
 *   restSettings?: { baseUrl?: string, auth?: object | string, fetch?: typeof fetch },
 *   fetchDashboardView?: typeof defaultFetchDashboardView,
 *   author?: { name?: string, email?: string }
 * }} options
 */
async function openDashboardHistory({
    git,
    workspaceRoot,
    metadata,
    remoteSettings = {},
    restSettings = {},
    fetchDashboardView = defaultFetchDashboardView,
    author
}) {
    const dashboard = {
        instance: metadata.instance,
        app: metadata.app,
        owner: metadata.owner,
        name: String(metadata.name ?? '').trim(),
        ext: metadata.ext
    };
    let viewPath = resolveDashboardViewPath(dashboard);
    let absolutePath = path.join(workspaceRoot, viewPath);

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
    const headView = await readHeadViewBody(git, dashboard, headHash);
    let imported = false;
    let viewSource = 'missing';

    if (headView) {
        dashboard.ext = headView.ext;
        viewPath = headView.viewPath;
        absolutePath = path.join(workspaceRoot, viewPath);
        if (!fs.existsSync(absolutePath)) {
            if (!(await restoreFromGit(git, viewPath))) {
                fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
                fs.writeFileSync(absolutePath, headView.body, 'utf8');
            }
        }
        viewSource = 'head';
    } else if (restSettings.baseUrl) {
        try {
            const body = await fetchDashboardView({
                baseUrl: restSettings.baseUrl,
                auth: restSettings.auth,
                app: dashboard.app,
                owner: dashboard.owner,
                name: dashboard.name,
                fetch: restSettings.fetch
            });
            dashboard.ext = detectViewExt(body);
            viewPath = resolveDashboardViewPath(dashboard);
            absolutePath = path.join(workspaceRoot, viewPath);
            fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
            fs.writeFileSync(absolutePath, body, 'utf8');
            const saveResult = await saveVersion(git, viewPath, 'Import dashboard', undefined, { author });
            imported = saveResult.saved === true;
            viewSource = 'import';
        } catch (err) {
            warning = warning || err.message || 'REST import failed';
        }
    } else if (!warning) {
        warning = 'dashboard missing from git and no REST config for import';
    }

    return {
        relativePath: viewPath,
        viewPath,
        dashboard: { ...dashboard },
        ext: dashboard.ext || 'xml',
        viewSource,
        imported,
        fetched,
        warning
    };
}

module.exports = {
    detectViewExt,
    openDashboardHistory,
    resolveDashboardViewPath
};
