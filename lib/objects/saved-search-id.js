const crypto = require('node:crypto');

const FALLBACKS = {
    instance: 'unknown-instance',
    app: 'unknown-app',
    owner: 'unknown-owner',
    name: 'untitled-search',
};

function normalize(value, fallback) {
    const trimmed = String(value ?? '').trim();
    return trimmed || fallback;
}

function slugSegment(value, fallback) {
    const slugged = value
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^[.\-\s]+|[.\-\s]+$/g, '');
    return slugged || fallback;
}

function hashId12(canonicalId) {
    return crypto.createHash('sha256').update(canonicalId, 'utf8').digest('hex').slice(0, 12);
}

function getSavedSearchId({ instance, app, owner, name }) {
    const i = normalize(instance, FALLBACKS.instance);
    const a = normalize(app, FALLBACKS.app);
    const o = normalize(owner, FALLBACKS.owner);
    const n = normalize(name, FALLBACKS.name);
    return `${i}|${a}|${o}|${n}`;
}

function getSavedSearchPath({ instance, app, owner, name }) {
    const canonicalId = getSavedSearchId({ instance, app, owner, name });
    const i = slugSegment(normalize(instance, FALLBACKS.instance), FALLBACKS.instance);
    const a = slugSegment(normalize(app, FALLBACKS.app), FALLBACKS.app);
    const o = slugSegment(normalize(owner, FALLBACKS.owner), FALLBACKS.owner);
    const n = slugSegment(normalize(name, FALLBACKS.name), FALLBACKS.name);
    const sha12 = hashId12(canonicalId);
    return `saved-searches/${i}/${a}/${o}/${n}-${sha12}.spl`;
}

module.exports = { getSavedSearchId, getSavedSearchPath };
