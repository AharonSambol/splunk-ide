const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { extractStanza, upsertStanza, listStanzaNames } = require('../lib/conf-stanza');

const MULTI_STANZA = `[Error Rate]
search = index=main
disabled = 0

[Other Search]
search = index=other
disabled = 1
`;

describe('extractStanza', () => {
    it('returns stanza text for an exact name match', () => {
        const stanza = extractStanza(MULTI_STANZA, 'Error Rate');
        assert.equal(stanza, `[Error Rate]
search = index=main
disabled = 0

`);
    });

    it('returns null when the stanza name is missing', () => {
        assert.equal(extractStanza(MULTI_STANZA, 'Missing Search'), null);
    });

    it('matches names case-sensitively', () => {
        assert.equal(extractStanza(MULTI_STANZA, 'error rate'), null);
        assert.equal(extractStanza(MULTI_STANZA, 'ERROR RATE'), null);
    });

    it('matches names with spaces and dots exactly', () => {
        const conf = `[Error..Rate]
search = x
`;
        assert.equal(extractStanza(conf, 'Error..Rate'), `[Error..Rate]
search = x
`);
        assert.equal(extractStanza(conf, 'Error Rate'), null);
    });

    it('does not split on bracket substrings inside values', () => {
        const conf = `[Error Rate]
search = [subsearch] | stats count
description = not a [Other Search] header
`;
        const stanza = extractStanza(conf, 'Error Rate');
        assert.match(stanza, /\[subsearch\] \| stats count/);
        assert.match(stanza, /not a \[Other Search\] header/);
    });
});

describe('listStanzaNames', () => {
    it('lists stanza names in file order', () => {
        assert.deepEqual(listStanzaNames(MULTI_STANZA), ['Error Rate', 'Other Search']);
    });

    it('returns an empty list for empty conf text', () => {
        assert.deepEqual(listStanzaNames(''), []);
    });
});

describe('upsertStanza', () => {
    it('replaces an existing stanza in place without duplicating the header', () => {
        const replacement = `[Error Rate]
search = index=main | stats count
disabled = 0

`;
        const updated = upsertStanza(MULTI_STANZA, 'Error Rate', replacement);
        assert.equal((updated.match(/^\[Error Rate\]/gm) || []).length, 1);
        assert.match(updated, /index=main \| stats count/);
        assert.match(updated, /\[Other Search\]/);
        assert.match(updated, /index=other/);
    });

    it('leaves unchanged sibling stanzas byte-identical', () => {
        const siblingBefore = extractStanza(MULTI_STANZA, 'Other Search');
        const replacement = `[Error Rate]
search = index=main | stats count
disabled = 0

`;
        const updated = upsertStanza(MULTI_STANZA, 'Error Rate', replacement);
        assert.equal(extractStanza(updated, 'Other Search'), siblingBefore);
    });

    it('appends a missing stanza once', () => {
        const newStanza = `[New Search]
search = index=new
`;
        const updated = upsertStanza(MULTI_STANZA, 'New Search', newStanza);
        assert.equal((updated.match(/^\[New Search\]/gm) || []).length, 1);
        assert.equal(extractStanza(updated, 'New Search'), newStanza);
    });

    it('appends to empty conf text', () => {
        const stanza = `[Error Rate]
search = index=main
`;
        assert.equal(upsertStanza('', 'Error Rate', stanza), stanza);
    });

    it('replaces a middle stanza in a multi-stanza conf', () => {
        const conf = `[First]
a = 1

[Error Rate]
search = old

[Last]
z = 9
`;
        const replacement = `[Error Rate]
search = new

`;
        const updated = upsertStanza(conf, 'Error Rate', replacement);
        assert.deepEqual(listStanzaNames(updated), ['First', 'Error Rate', 'Last']);
        assert.equal(extractStanza(updated, 'First'), extractStanza(conf, 'First'));
        assert.equal(extractStanza(updated, 'Last'), extractStanza(conf, 'Last'));
        assert.match(extractStanza(updated, 'Error Rate'), /search = new/);
    });

    it('roundtrips extract then upsert without changing unrelated bytes', () => {
        const updated = upsertStanza(MULTI_STANZA, 'Other Search', extractStanza(MULTI_STANZA, 'Other Search'));
        assert.equal(updated, MULTI_STANZA);
    });
});
