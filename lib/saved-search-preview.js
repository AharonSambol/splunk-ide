const { extractSearchFromStanza } = require('./query-versions');

function resolveSavedSearchDraftPreviewText({ draftStanzaText = '', headStanzaText = '' } = {}) {
    if (draftStanzaText) {
        const draftQuery = extractSearchFromStanza(draftStanzaText);
        return draftQuery || draftStanzaText;
    }
    if (headStanzaText) {
        const headQuery = extractSearchFromStanza(headStanzaText);
        return headQuery || headStanzaText;
    }
    return '';
}

module.exports = {
    resolveSavedSearchDraftPreviewText
};
