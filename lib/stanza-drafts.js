/**
 * Per-stanza durable draft stashes and conf recompose (Model A).
 *
 * Ref shape: refs/splunk-ide/stashes/<conf-slug>/<stanza-slug>/<baseHash>
 * Blob body: stanza text only (header + keys), not the whole conf.
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { upsertStanza, listStanzaNames } = require('./conf-stanza');
const { ensureRepo } = require('./query-versions');

const execFileAsync = promisify(execFile);
const STASH_REF_PREFIX = 'refs/splunk-ide/stashes';

function sanitizeRefSegment(value, fallback) {
    const slug = String(value)
        .replace(/[^a-zA-Z0-9._-]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/\.{2,}/g, '-')
        .replace(/^[-./]+|[-./]+$/g, '');
    return slug || fallback;
}

function sanitizeFileSlug(relativePath) {
    return relativePath
        .replace(/\\/g, '/')
        .split('/')
        .map((part) => sanitizeRefSegment(part, 'dir'))
        .filter(Boolean)
        .join('--');
}

function slugStanzaForRef(stanzaName) {
    const slugged = String(stanzaName ?? '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^[.\-\s]+|[.\-\s]+$/g, '');
    return slugged || 'untitled';
}

function stanzaDraftStashRef(confPath, stanzaName, baseHash) {
    const confSlug = sanitizeFileSlug(confPath);
    const stanzaSlug = slugStanzaForRef(stanzaName);
    return `${STASH_REF_PREFIX}/${confSlug}/${stanzaSlug}/${baseHash}`;
}

async function gitRoot(git) {
    return (await git.revparse(['--show-toplevel'])).trim();
}

async function writeBlob(git, content) {
    const root = await gitRoot(git);
    const gitDir = (await git.revparse(['--absolute-git-dir'])).trim();
    const tmp = path.join(gitDir, `splunk-ide-blob-${process.pid}-${Date.now()}`);
    fs.writeFileSync(tmp, content, 'utf8');
    try {
        const { stdout } = await execFileAsync('git', ['hash-object', '-w', tmp], { cwd: root });
        return stdout.trim();
    } finally {
        try {
            fs.unlinkSync(tmp);
        } catch {
            // Temp blob cleanup is best-effort.
        }
    }
}

function assertStanzaOnlyDraft(stanzaName, stanzaText) {
    const names = listStanzaNames(stanzaText);
    if (names.length !== 1 || names[0] !== stanzaName) {
        throw new Error(
            `Stanza draft must contain exactly one stanza named "${stanzaName}"`
        );
    }
}

/**
 * @param {string} headConfText
 * @param {{ name: string, text: string }[]} drafts
 * @returns {string}
 */
function recompose(headConfText, drafts) {
    let conf = headConfText ?? '';
    for (const draft of drafts) {
        conf = upsertStanza(conf, draft.name, draft.text);
    }
    return conf;
}

/**
 * @param {import('simple-git').SimpleGit} git
 * @param {string} confPath
 * @param {string} stanzaName
 * @param {string} baseHash
 */
async function getStanzaDraft(git, confPath, stanzaName, baseHash) {
    const normalized = confPath.replace(/\\/g, '/');
    const ref = stanzaDraftStashRef(normalized, stanzaName, baseHash);
    try {
        const hash = (await git.raw(['rev-parse', ref])).trim();
        const text = await git.catFile(['-p', hash]);
        return { hash, ref, text, name: stanzaName, baseHash };
    } catch {
        return null;
    }
}

/**
 * @param {import('simple-git').SimpleGit} git
 * @param {string} confPath
 * @param {string} stanzaName
 * @param {string} baseHash
 * @param {string} stanzaText
 */
async function saveStanzaDraft(git, confPath, stanzaName, baseHash, stanzaText) {
    await ensureRepo(git);
    const normalized = confPath.replace(/\\/g, '/');
    if (!baseHash) {
        return { saved: false, reason: 'no-base' };
    }
    assertStanzaOnlyDraft(stanzaName, stanzaText);

    const blobHash = await writeBlob(git, stanzaText);
    const ref = stanzaDraftStashRef(normalized, stanzaName, baseHash);
    await git.raw(['update-ref', ref, blobHash]);
    return { saved: true, hash: blobHash, ref };
}

/**
 * @param {import('simple-git').SimpleGit} git
 * @param {string} confPath
 * @param {string} stanzaName
 * @param {string} baseHash
 */
async function deleteStanzaDraft(git, confPath, stanzaName, baseHash) {
    const normalized = confPath.replace(/\\/g, '/');
    const ref = stanzaDraftStashRef(normalized, stanzaName, baseHash);
    try {
        await git.raw(['update-ref', '-d', ref]);
        return { deleted: true, ref };
    } catch {
        return { deleted: false, ref };
    }
}

/**
 * @param {import('simple-git').SimpleGit} git
 * @param {string} confPath
 * @returns {Promise<{ name: string, text: string, baseHash: string, ref: string, hash: string }[]>}
 */
async function listStanzaDraftsForConf(git, confPath) {
    const normalized = confPath.replace(/\\/g, '/');
    const prefix = `${STASH_REF_PREFIX}/${sanitizeFileSlug(normalized)}/`;
    let raw = '';
    try {
        raw = await git.raw(['for-each-ref', '--format=%(refname)', prefix]);
    } catch {
        return [];
    }

    const drafts = [];
    for (const ref of raw.trim().split('\n').filter(Boolean)) {
        const suffix = ref.slice(`${STASH_REF_PREFIX}/`.length);
        const parts = suffix.split('/');
        if (parts.length !== 3) {
            continue;
        }
        const baseHash = parts[2];
        try {
            const hash = (await git.raw(['rev-parse', ref])).trim();
            const text = await git.catFile(['-p', hash]);
            const names = listStanzaNames(text);
            if (names.length !== 1) {
                continue;
            }
            drafts.push({ name: names[0], text, baseHash, ref, hash });
        } catch {
            // Skip broken refs.
        }
    }
    return drafts;
}

/**
 * @param {import('simple-git').SimpleGit} git
 * @param {string} confPath
 * @param {string} headHash
 * @returns {Promise<string>}
 */
async function recomposeWorktree(git, confPath, headHash) {
    const normalized = confPath.replace(/\\/g, '/');
    let headConf = '';
    try {
        headConf = await git.show([`${headHash}:${normalized}`]);
    } catch {
        headConf = '';
    }
    const drafts = await listStanzaDraftsForConf(git, normalized);
    const composed = recompose(headConf, drafts);
    const root = await gitRoot(git);
    const absolutePath = path.join(root, normalized);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, composed, 'utf8');
    return composed;
}

module.exports = {
    stanzaDraftStashRef,
    recompose,
    getStanzaDraft,
    saveStanzaDraft,
    deleteStanzaDraft,
    listStanzaDraftsForConf,
    recomposeWorktree
};
