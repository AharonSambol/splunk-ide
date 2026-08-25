/**
 * Splunk .conf stanza extract / upsert helpers.
 *
 * Stanzas are bounded by line-start headers `[name]` (exact name match).
 * Values may contain `[...]` substrings; only `^[` lines start a stanza.
 *
 * @exports extractStanza
 * @exports upsertStanza
 * @exports listStanzaNames
 */

function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function findStanzaStarts(confText) {
    const starts = [];
    const re = /^\[([^\]]+)\]\s*$/gm;
    let match;
    while ((match = re.exec(confText)) !== null) {
        starts.push({ name: match[1], index: match.index });
    }
    return starts;
}

function stanzaSlice(confText, starts, index) {
    const start = starts[index].index;
    const end = index + 1 < starts.length ? starts[index + 1].index : confText.length;
    return confText.slice(start, end);
}

/**
 * @param {string} confText
 * @param {string} name exact stanza name (case-sensitive; without brackets)
 * @returns {string | null}
 */
function extractStanza(confText, name) {
    const starts = findStanzaStarts(confText);
    const index = starts.findIndex((entry) => entry.name === name);
    if (index === -1) {
        return null;
    }
    return stanzaSlice(confText, starts, index);
}

/**
 * @param {string} confText
 * @returns {string[]}
 */
function listStanzaNames(confText) {
    return findStanzaStarts(confText).map((entry) => entry.name);
}

/**
 * @param {string} confText
 * @param {string} name exact stanza name (case-sensitive; without brackets)
 * @param {string} stanzaText full stanza block including `[name]` header
 * @returns {string}
 */
function upsertStanza(confText, name, stanzaText) {
    const starts = findStanzaStarts(confText);
    const index = starts.findIndex((entry) => entry.name === name);

    if (index === -1) {
        if (confText.length === 0) {
            return stanzaText;
        }
        const separator = confText.endsWith('\n') ? '' : '\n';
        return confText + separator + stanzaText;
    }

    const start = starts[index].index;
    const end = index + 1 < starts.length ? starts[index + 1].index : confText.length;
    return confText.slice(0, start) + stanzaText + confText.slice(end);
}

module.exports = { extractStanza, upsertStanza, listStanzaNames };
