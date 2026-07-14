/**
 * Native Splunk on-disk paths for the shared git tree.
 *
 * Shared objects (owner `nobody`, case-insensitive) live under
 * `<instance>/apps/<app>/local/…`. Private objects use
 * `<instance>/users/<owner>/<app>/local/…`.
 *
 * Dashboard view file names are slugged for the path segment only. Slug is
 * never used to match conf stanzas or object identity — use the exact Splunk
 * name (see getSavedSearchId in saved-search-id.js).
 */

function trim(value) {
    return String(value ?? '').trim();
}

function slugNameForPath(name) {
    const slugged = trim(name)
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^[.\-\s]+|[.\-\s]+$/g, '');
    return slugged || 'untitled';
}

function getLocalRoot({ instance, app, owner }) {
    const i = trim(instance);
    const a = trim(app);
    const o = trim(owner);
    const base = o.toLowerCase() === 'nobody' ? `apps/${a}/local` : `users/${o}/${a}/local`;
    return `${i}/${base}`;
}

function getSavedSearchConfPath({ instance, app, owner }) {
    return `${getLocalRoot({ instance, app, owner })}/savedsearches.conf`;
}

function getDashboardViewPath({ instance, app, owner, name, ext }) {
    const slug = slugNameForPath(name);
    const extension = trim(ext).replace(/^\./, '') || 'xml';
    return `${getLocalRoot({ instance, app, owner })}/data/ui/views/${slug}.${extension}`;
}

module.exports = { getSavedSearchConfPath, getDashboardViewPath };
