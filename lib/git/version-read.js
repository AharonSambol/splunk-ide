'use strict';

const fs = require('node:fs');
const { extractStanza } = require('../objects/conf-stanza');
const { extractQueryFromUrl } = require('../splunk-url');
const {
    VERSION_REF_PREFIX,
    PARENT_TRAILER_RE,
    AUTOSAVE_TRAILER_RE,
    getConsumedAutoSaveHashes,
    sanitizeFileSlug,
} = require('./query-versions');

async function listVersionRefHashes(git, relativePath) {
    const fileSlug = sanitizeFileSlug(relativePath);
    try {
        const raw = await git.raw([
            'for-each-ref',
            '--format=%(objectname)',
            `${VERSION_REF_PREFIX}/${fileSlug}/`
        ]);
        return raw.trim().split('\n').filter(Boolean);
    } catch {
        return [];
    }
}

async function getCommitParentHash(git, hash) {
    try {
        return (await git.raw(['rev-parse', `${hash}^`])).trim();
    } catch {
        return undefined;
    }
}

async function readConfAtCommit(git, relativePath, hash) {
    try {
        return await git.show([`${hash}:${relativePath}`]);
    } catch {
        return '';
    }
}

/**
 * Stanza body at a specific commit (exact name match).
 * @param {import('simple-git').SimpleGit} git
 * @param {string} relativePath
 * @param {string} hash
 * @param {string} stanzaName
 * @returns {Promise<string | null>}
 */
async function readVersionStanza(git, relativePath, hash, stanzaName) {
    const confText = await readConfAtCommit(git, relativePath, hash);
    return extractStanza(confText, stanzaName);
}

async function stanzaChangedInCommit(git, relativePath, hash, parentHash, stanzaName) {
    const commitText = await readConfAtCommit(git, relativePath, hash);
    const parentText = parentHash ? await readConfAtCommit(git, relativePath, parentHash) : '';
    return extractStanza(commitText, stanzaName) !== extractStanza(parentText, stanzaName);
}

async function buildVersionFromCommit(git, hash, normalized, consumedAutoSaves, options) {
    let showRaw = '';
    try {
        showRaw = await git.raw([
            'show',
            '-s',
            '--pretty=format:%an%x00%ad%x00%s%x00%b',
            '--date=iso-strict',
            hash
        ]);
    } catch {
        return null;
    }

    const [author, date, message, body = ''] = showRaw.split('\0');
    let pathAtCommit = normalized;
    try {
        await git.show([`${hash}:${normalized}`]);
    } catch {
        return null;
    }

    let url = '';
    try {
        url = await git.show([`${hash}:${pathAtCommit}`]);
    } catch {
        return null;
    }

    const version = {
        hash,
        message,
        author,
        date,
        query: extractQueryFromUrl(url),
        url: url.trim()
    };

    const parentHash = await getCommitParentHash(git, hash);
    if (parentHash) {
        version.parentHash = parentHash;
    } else {
        const parentMatch = PARENT_TRAILER_RE.exec(body);
        if (parentMatch) {
            version.parentHash = parentMatch[1];
        }
    }

    if (AUTOSAVE_TRAILER_RE.test(body)) {
        version.isAutoSave = true;
        if (consumedAutoSaves.has(hash)) {
            version.isConsumedAutoSave = true;
            if (!options.includeConsumedAutoSaves) {
                return null;
            }
        }
    }

    if (options.stanza) {
        const parentHash = version.parentHash;
        if (!(await stanzaChangedInCommit(git, normalized, hash, parentHash, options.stanza))) {
            return null;
        }
        version.stanzaText = await readVersionStanza(git, normalized, hash, options.stanza);
    }
    return version;
}

/**
 * @typedef {Object} QueryVersion
 * @property {string} hash
 * @property {string} message
 * @property {string} [parentHash]
 * @property {boolean} [isAutoSave]
 * @property {boolean} [isConsumedAutoSave]
 * @property {string} author
 * @property {string} date - ISO string
 * @property {string} query - decoded SPL text at this version
 * @property {string} url - raw .spl file content at this version
 * @property {string} [stanzaText] - stanza body when listVersions is filtered by stanza
 */

/**
 * @param {import('simple-git').SimpleGit} git
 * @param {string} relativePath
 * @param {number} [maxCount=30]
 * @param {{ includeConsumedAutoSaves?: boolean, stanza?: string }} [options]
 * @returns {Promise<QueryVersion[]>}
 */
async function listVersions(git, relativePath, maxCount = 30, options = {}) {
    const normalized = relativePath.replace(/\\/g, '/');
    const isRepo = await git.checkIsRepo('root');
    if (!isRepo) {
        return [];
    }

    const logMaxCount = options.stanza ? Math.max(maxCount * 50, maxCount) : maxCount;

    let raw;
    try {
        raw = await git.raw([
            'log', '--follow', '--name-only',
            `--max-count=${logMaxCount}`,
            '--pretty=format:COMMIT:%H%x00%an%x00%ad%x00%s%x00%b',
            '--date=iso-strict',
            '--', normalized
        ]);
    } catch {
        return [];
    }

    if (!raw.trim()) {
        return [];
    }

    const consumedAutoSaves = await getConsumedAutoSaveHashes(git);
    const versions = [];
    const blocks = raw.trim().split(/^COMMIT:/m).filter(Boolean);
    for (const block of blocks) {
        const lines = block.trim().split('\n').map(line => line.trim()).filter(Boolean);
        if (lines.length === 0) {
            continue;
        }

        const [hash, author, date, message, bodyFirst = ''] = lines[0].split('\0');
        const pathAtCommit = lines.length > 1 ? lines[lines.length - 1] : normalized;
        const bodyLines = [bodyFirst];
        for (let i = 1; i < lines.length - 1; i++) {
            bodyLines.push(lines[i]);
        }
        const body = bodyLines.join('\n');
        let parentHash = await getCommitParentHash(git, hash);
        if (!parentHash) {
            const parentMatch = PARENT_TRAILER_RE.exec(body);
            if (parentMatch) {
                parentHash = parentMatch[1];
            }
        }
        let url = '';
        try {
            url = await git.show([`${hash}:${pathAtCommit}`]);
        } catch {
            // File may not exist at this commit under any known path.
        }
        const version = {
            hash,
            message,
            author,
            date,
            query: extractQueryFromUrl(url),
            url: url.trim()
        };
        if (parentHash) {
            version.parentHash = parentHash;
        }
        if (AUTOSAVE_TRAILER_RE.test(body)) {
            version.isAutoSave = true;
            if (consumedAutoSaves.has(hash)) {
                version.isConsumedAutoSave = true;
                if (!options.includeConsumedAutoSaves) {
                    continue;
                }
            }
        }

        if (options.stanza) {
            if (!(await stanzaChangedInCommit(git, normalized, hash, parentHash, options.stanza))) {
                continue;
            }
            version.stanzaText = await readVersionStanza(git, normalized, hash, options.stanza);
        }
        versions.push(version);
    }

    const seen = new Set(versions.map(version => version.hash));
    const refHashes = await listVersionRefHashes(git, normalized);
    for (const hash of refHashes) {
        if (seen.has(hash)) {
            continue;
        }
        const version = await buildVersionFromCommit(git, hash, normalized, consumedAutoSaves, options);
        if (version) {
            versions.push(version);
            seen.add(hash);
        }
    }

    versions.sort((a, b) => new Date(b.date) - new Date(a.date));
    return versions.slice(0, maxCount);
}

module.exports = {
    listVersionRefHashes,
    getCommitParentHash,
    readConfAtCommit,
    readVersionStanza,
    stanzaChangedInCommit,
    buildVersionFromCommit,
    listVersions,
};
