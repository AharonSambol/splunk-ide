'use strict';

const fs = require('node:fs');

/**
 * Git plumbing shared by native-object open/restore paths: HEAD lookup,
 * file restore from git, and the shared-branch checkout that parks the
 * worktree file aside while it runs.
 */
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

module.exports = { checkoutSharedBranch, getHeadHash, latestCommitWithFile, restoreFromGit, readHeadConf };
