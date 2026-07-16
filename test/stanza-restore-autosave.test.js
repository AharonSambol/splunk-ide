const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { extractStanza } = require('../lib/conf-stanza');
const {
    saveVersion,
    saveStanzaVersion,
    listVersions,
    autoSaveStanzaBeforeRestore,
    restoreStanzaVersion,
    restoreStanzaAutoSaveVersion
} = require('../lib/query-versions');
const {
    saveStanzaDraft,
    getStanzaDraft,
    recomposeWorktree
} = require('../lib/stanza-drafts');
const { createTempGitRepo, cleanupTempRepo } = require('./helpers/temp-git-repo');

const CONF_PATH = 'prod/apps/search/local/savedsearches.conf';
const STANZA = 'Error Rate';

const HEAD_CONF = `[Error Rate]
search = index=main
disabled = 0

[Other Search]
search = index=other
disabled = 1
`;

const DRAFT_ERROR_RATE = `[Error Rate]
search = index=main | stats count
disabled = 0

`;

const OLD_ERROR_RATE = `[Error Rate]
search = index=legacy
disabled = 0

`;

function writeConf(repoPath, content) {
    const absolutePath = path.join(repoPath, CONF_PATH);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, content, 'utf8');
}

describe('autoSaveStanzaBeforeRestore', () => {
    let repoPath;
    let git;
    let initialHash;
    let headHash;

    beforeEach(async () => {
        ({ repoPath, git } = await createTempGitRepo());
        writeConf(repoPath, HEAD_CONF);
        await saveVersion(git, CONF_PATH, 'Initial conf');
        initialHash = (await git.revparse(['HEAD'])).trim();

        writeConf(
            repoPath,
            HEAD_CONF.replace(
                extractStanza(HEAD_CONF, STANZA),
                OLD_ERROR_RATE
            )
        );
        await saveVersion(git, CONF_PATH, 'Update Error Rate');
        headHash = (await git.revparse(['HEAD'])).trim();
    });

    afterEach(() => {
        cleanupTempRepo(repoPath);
    });

    it('creates an auto-save commit from a durable draft before restore', async () => {
        await saveStanzaDraft(git, CONF_PATH, STANZA, headHash, DRAFT_ERROR_RATE);
        await recomposeWorktree(git, CONF_PATH, headHash);

        const beforeCount = (await listVersions(git, CONF_PATH, 30, { stanza: STANZA })).length;
        const autoSave = await autoSaveStanzaBeforeRestore(git, CONF_PATH, STANZA, initialHash);
        assert.equal(autoSave.saved, true);

        const versions = await listVersions(git, CONF_PATH, 30, { stanza: STANZA });
        assert.equal(versions.length, beforeCount + 1);
        assert.match(versions[0].message, /Auto-save before restore/);
        assert.equal(versions[0].isAutoSave, true);

        const restored = await restoreStanzaVersion(git, CONF_PATH, STANZA, initialHash);
        assert.equal(restored.restored, true);

        const onDisk = fs.readFileSync(path.join(repoPath, CONF_PATH), 'utf8');
        assert.equal(extractStanza(onDisk, STANZA), extractStanza(HEAD_CONF, STANZA));

        const draft = await getStanzaDraft(git, CONF_PATH, STANZA, initialHash);
        assert.ok(draft);
        assert.equal(draft.text, extractStanza(HEAD_CONF, STANZA));
    });

    it('auto-saves from seedSearchText when live search differs from target', async () => {
        const beforeCount = (await listVersions(git, CONF_PATH, 30, { stanza: STANZA })).length;
        const autoSave = await autoSaveStanzaBeforeRestore(git, CONF_PATH, STANZA, initialHash, {
            seedSearchText: 'index=main | stats count'
        });
        assert.equal(autoSave.saved, true);

        const versions = await listVersions(git, CONF_PATH, 30, { stanza: STANZA });
        assert.equal(versions.length, beforeCount + 1);
        assert.equal(versions[0].isAutoSave, true);

        const restored = await restoreStanzaVersion(git, CONF_PATH, STANZA, initialHash);
        assert.equal(restored.restored, true);
        assert.match(
            extractStanza(fs.readFileSync(path.join(repoPath, CONF_PATH), 'utf8'), STANZA),
            /search = index=main/
        );
    });

    it('skips auto-save when live search matches target and no draft exists', async () => {
        const result = await autoSaveStanzaBeforeRestore(git, CONF_PATH, STANZA, initialHash, {
            seedSearchText: 'index=main'
        });
        assert.equal(result.saved, false);
        assert.equal(result.reason, 'no-dirty-work');
    });

    it('does not duplicate stanza headers in auto-save commit', async () => {
        await saveStanzaDraft(git, CONF_PATH, STANZA, headHash, DRAFT_ERROR_RATE);
        await recomposeWorktree(git, CONF_PATH, headHash);

        const autoSave = await autoSaveStanzaBeforeRestore(git, CONF_PATH, STANZA, initialHash);
        assert.equal(autoSave.saved, true);

        const commitConf = await git.show([`${autoSave.hash}:${CONF_PATH}`]);
        const matches = commitConf.match(/^\[Error Rate\]/gm) || [];
        assert.equal(matches.length, 1);
    });
});

describe('restoreStanzaAutoSaveVersion', () => {
    let repoPath;
    let git;
    let initialHash;
    let headHash;

    beforeEach(async () => {
        ({ repoPath, git } = await createTempGitRepo());
        writeConf(repoPath, HEAD_CONF);
        await saveVersion(git, CONF_PATH, 'Initial conf');
        initialHash = (await git.revparse(['HEAD'])).trim();

        writeConf(
            repoPath,
            HEAD_CONF.replace(
                extractStanza(HEAD_CONF, STANZA),
                OLD_ERROR_RATE
            )
        );
        await saveVersion(git, CONF_PATH, 'Update Error Rate');
        headHash = (await git.revparse(['HEAD'])).trim();
    });

    afterEach(() => {
        cleanupTempRepo(repoPath);
    });

    it('consumes auto-save as draft without creating another auto-save', async () => {
        await saveStanzaDraft(git, CONF_PATH, STANZA, headHash, DRAFT_ERROR_RATE);
        await recomposeWorktree(git, CONF_PATH, headHash);

        const autoSave = await autoSaveStanzaBeforeRestore(git, CONF_PATH, STANZA, initialHash);
        assert.equal(autoSave.saved, true);

        const versionsBefore = await listVersions(git, CONF_PATH, 30, { stanza: STANZA });
        const autoSaveVersion = versionsBefore.find((entry) => entry.isAutoSave);
        assert.ok(autoSaveVersion);

        await restoreStanzaVersion(git, CONF_PATH, STANZA, initialHash);

        const restored = await restoreStanzaAutoSaveVersion(
            git,
            CONF_PATH,
            STANZA,
            autoSaveVersion.hash,
            autoSaveVersion.parentHash
        );
        assert.equal(restored.restored, true);

        const versionsAfter = await listVersions(git, CONF_PATH, 30, { stanza: STANZA });
        assert.equal(versionsAfter.filter((entry) => entry.isAutoSave).length, 0);
        assert.ok(!versionsAfter.some((entry) => entry.hash === autoSaveVersion.hash));

        const draft = await getStanzaDraft(git, CONF_PATH, STANZA, autoSaveVersion.parentHash || headHash);
        assert.ok(draft);
        assert.match(draft.text, /search = index=main \| stats count/);
    });

    it('does not grow auto-save chain when restoring auto-save twice', async () => {
        const autoSave = await autoSaveStanzaBeforeRestore(git, CONF_PATH, STANZA, initialHash, {
            seedSearchText: 'index=main | stats count'
        });
        assert.equal(autoSave.saved, true);

        const versionsBefore = await listVersions(git, CONF_PATH, 30, { stanza: STANZA });
        const autoSaveVersion = versionsBefore.find((entry) => entry.isAutoSave);
        assert.ok(autoSaveVersion);

        await restoreStanzaAutoSaveVersion(
            git,
            CONF_PATH,
            STANZA,
            autoSaveVersion.hash,
            autoSaveVersion.parentHash
        );

        const versionsAfterFirst = await listVersions(git, CONF_PATH, 30, { stanza: STANZA });
        assert.equal(versionsAfterFirst.filter((entry) => entry.isAutoSave).length, 0);

        await restoreStanzaAutoSaveVersion(
            git,
            CONF_PATH,
            STANZA,
            autoSaveVersion.hash,
            autoSaveVersion.parentHash
        );

        const versionsAfterSecond = await listVersions(git, CONF_PATH, 30, { stanza: STANZA });
        assert.equal(versionsAfterSecond.filter((entry) => entry.isAutoSave).length, 0);
    });
});
