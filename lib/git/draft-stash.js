'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
    ensureRepo,
    resolveAuthor,
    commitFileOnParent,
    hasDraftChanges,
    readCurrentQuery,
    draftStashRef,
} = require('./query-versions');

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

module.exports = {
    getDraftStash,
    saveDraftStash,
    popDraftStash,
};
