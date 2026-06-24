const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { simpleGit } = require('simple-git');
const {
    buildGitChangesFromStatus,
    formatCommitHistory,
    canResetToCommit,
    isGitChangesEmpty,
} = require('../../lib/git-view-model');

describe('git integration', () => {
    let repoPath;
    let git;

    beforeEach(async () => {
        repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'splunk-ide-git-'));
        git = simpleGit(repoPath);
        await git.init();
        await git.addConfig('user.name', 'Test User');
        await git.addConfig('user.email', 'test@example.com');
    });

    afterEach(() => {
        fs.rmSync(repoPath, { recursive: true, force: true });
    });

    it('initializes a repository in a temp project directory', async () => {
        assert.equal(await git.checkIsRepo(), true);
    });

    it('detects an unstaged new file in status', async () => {
        const fileName = 'queries/main.spl';
        fs.mkdirSync(path.join(repoPath, 'queries'), { recursive: true });
        fs.writeFileSync(path.join(repoPath, fileName), 'https://splunk.example/main', 'utf8');

        const status = await git.status();
        assert.equal(status.not_added.includes(fileName), true);

        const gitChanges = buildGitChangesFromStatus(status);
        assert.equal(gitChanges[fileName], 'untracked');
        assert.equal(isGitChangesEmpty(gitChanges), false);
    });

    it('stages, commits, and returns history for a project file', async () => {
        const fileName = 'root.spl';
        fs.writeFileSync(path.join(repoPath, fileName), 'https://splunk.example/root', 'utf8');

        const unstaged = await git.status();
        assert.equal(unstaged.not_added.includes(fileName), true);

        await git.add(fileName);
        const staged = await git.status();
        const stagedChanges = buildGitChangesFromStatus(staged);
        assert.equal(stagedChanges[fileName], 'staged');

        const commitMessage = 'Add root query';
        const commitResult = await git.commit(commitMessage);
        assert.match(commitResult.commit, /^[0-9a-f]{40}$/);

        const cleanStatus = await git.status();
        assert.equal(isGitChangesEmpty(buildGitChangesFromStatus(cleanStatus)), true);

        const log = await git.log();
        const history = formatCommitHistory(log, date => `DATE:${date}`);
        assert.equal(history.length, 1);
        assert.equal(history[0].message, commitMessage);
        assert.equal(history[0].hash, log.latest.hash);
        assert.equal(history[0].shortHash, log.latest.hash.substring(0, 7));
    });

    it('requires explicit confirmation before reset is allowed', async () => {
        const fileName = 'tracked.spl';
        fs.writeFileSync(path.join(repoPath, fileName), 'v1', 'utf8');
        await git.add(fileName);
        await git.commit('Initial commit');

        const log = await git.log();
        const commitHash = log.latest.hash;

        assert.equal(canResetToCommit(commitHash, false), false);
        assert.equal(canResetToCommit(commitHash, true), true);
        assert.equal(canResetToCommit('', true), false);
    });
});
