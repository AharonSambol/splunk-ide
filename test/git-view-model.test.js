const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
    buildGitChangesFromStatus,
    formatBranchSummary,
    formatGitStatus,
    formatCommitHistory,
    getStageAction,
    getStageButtonLabel,
    canCommit,
    canResetToCommit,
    formatResetConfirmMessage,
    isGitChangesEmpty,
} = require('../lib/git-view-model');

describe('buildGitChangesFromStatus', () => {
    it('maps simple-git status into file status rows', () => {
        const gitChanges = buildGitChangesFromStatus({
            not_added: ['new.spl'],
            modified: ['changed.spl'],
            created: ['added.spl'],
            deleted: ['removed.spl'],
            staged: ['changed.spl'],
        });

        assert.deepEqual(gitChanges, {
            'new.spl': 'untracked',
            'changed.spl': 'staged',
            'added.spl': 'added',
            'removed.spl': 'deleted',
        });
    });
});

describe('formatBranchSummary', () => {
    it('formats branch label text', () => {
        assert.equal(formatBranchSummary('main'), 'Branch: main');
    });
});

describe('formatGitStatus', () => {
    it('formats rows with badge and stage action metadata', () => {
        const rows = formatGitStatus({
            'queries/main.spl': 'modified',
            'queries/new.spl': 'staged',
        });

        assert.deepEqual(rows, [
            {
                file: 'queries/main.spl',
                status: 'modified',
                statusBadge: 'M',
                stageButtonLabel: 'Stage',
                stageAction: 'stage',
            },
            {
                file: 'queries/new.spl',
                status: 'staged',
                statusBadge: 'S',
                stageButtonLabel: 'Unstage',
                stageAction: 'unstage',
            },
        ]);
    });
});

describe('formatCommitHistory', () => {
    it('formats commit rows for rendering', () => {
        const rows = formatCommitHistory({
            all: [{
                hash: 'abcdef1234567890',
                message: 'Initial commit',
                author_name: 'Dev',
                date: '2026-01-02T10:00:00.000Z',
            }],
        }, date => `DATE:${date}`);

        assert.deepEqual(rows, [{
            hash: 'abcdef1234567890',
            shortHash: 'abcdef1',
            message: 'Initial commit',
            meta: 'Dev on DATE:2026-01-02T10:00:00.000Z',
        }]);
    });
});

describe('getStageAction', () => {
    it('returns unstage for staged files', () => {
        assert.equal(getStageAction('staged'), 'unstage');
    });

    it('returns stage for unstaged files', () => {
        assert.equal(getStageAction('modified'), 'stage');
    });
});

describe('getStageButtonLabel', () => {
    it('returns button labels used by the git panel', () => {
        assert.equal(getStageButtonLabel('staged'), 'Unstage');
        assert.equal(getStageButtonLabel('modified'), 'Stage');
    });
});

describe('canCommit', () => {
    it('requires a non-empty commit message', () => {
        assert.equal(canCommit(' fix ', {}), true);
        assert.equal(canCommit('   ', {}), false);
    });
});

describe('canResetToCommit', () => {
    it('requires a hash and explicit confirmation', () => {
        assert.equal(canResetToCommit('abc123', true), true);
        assert.equal(canResetToCommit('abc123', false), false);
        assert.equal(canResetToCommit('', true), false);
    });
});

describe('formatResetConfirmMessage', () => {
    it('formats reset confirmation text', () => {
        const message = formatResetConfirmMessage({
            hash: 'abcdef1234567890',
            message: 'Save work',
        });
        assert.equal(
            message,
            'Reset to commit abcdef1: "Save work"?\n\nThis will discard all changes after this commit.'
        );
    });
});

describe('isGitChangesEmpty', () => {
    it('detects empty git change maps', () => {
        assert.equal(isGitChangesEmpty({}), true);
        assert.equal(isGitChangesEmpty({ 'a.spl': 'modified' }), false);
    });
});
