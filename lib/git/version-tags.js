'use strict';

const {
    ensureRepo,
    sanitizeFileSlug,
    sanitizeRefSegment,
    slugStanzaForRef,
} = require('./query-versions');

/**
 * Annotated git tags scoped to a file path (and stanza) under refs/tags/search-tag.
 */

const TAG_REF_PREFIX = 'search-tag';

function versionTagRef(relativePath, tagName, stanzaName) {
    const fileSlug = sanitizeFileSlug(relativePath);
    const nameSlug = sanitizeRefSegment(tagName, 'tag');
    if (stanzaName) {
        const stanzaSlug = slugStanzaForRef(stanzaName);
        return `${TAG_REF_PREFIX}/${fileSlug}/${stanzaSlug}/${nameSlug}`;
    }
    return `${TAG_REF_PREFIX}/${fileSlug}/${nameSlug}`;
}

/**
 * Create or update an annotated git tag scoped to a query file path.
 * @param {import('simple-git').SimpleGit} git
 * @param {string} relativePath
 * @param {string} hash
 * @param {string} name - visible tag label stored in the tag message
 */
async function setVersionTag(git, relativePath, hash, name, stanzaName) {
    await ensureRepo(git);
    const normalized = relativePath.replace(/\\/g, '/');
    const ref = versionTagRef(normalized, name, stanzaName);
    await git.raw(['tag', '-fa', ref, hash, '-m', name]);
    return { ref };
}

/**
 * Delete an annotated git tag scoped to a query file path.
 * @param {import('simple-git').SimpleGit} git
 * @param {string} relativePath
 * @param {string} name - visible tag label used when the tag was created
 */
async function deleteVersionTag(git, relativePath, name, stanzaName) {
    const normalized = relativePath.replace(/\\/g, '/');
    const ref = versionTagRef(normalized, name, stanzaName);
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
async function listVersionTags(git, relativePath, stanzaName) {
    const normalized = relativePath.replace(/\\/g, '/');
    const isRepo = await git.checkIsRepo('root');
    if (!isRepo) {
        return [];
    }

    const fileSlug = sanitizeFileSlug(normalized);
    const refGlob = stanzaName
        ? `refs/tags/${TAG_REF_PREFIX}/${fileSlug}/${slugStanzaForRef(stanzaName)}/*`
        : `refs/tags/${TAG_REF_PREFIX}/${fileSlug}/*`;
    let raw;
    try {
        raw = await git.raw([
            'for-each-ref',
            '--sort=-taggerdate',
            refGlob,
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
    versionTagRef,
    setVersionTag,
    deleteVersionTag,
    listVersionTags,
    formatSplunkSaveTagName,
};
