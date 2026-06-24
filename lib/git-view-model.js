'use strict';

function buildGitChangesFromStatus(status) {
    const gitChanges = {};

    status.not_added.forEach(file => {
        gitChanges[file] = 'untracked';
    });
    status.modified.forEach(file => {
        gitChanges[file] = 'modified';
    });
    status.created.forEach(file => {
        gitChanges[file] = 'added';
    });
    status.deleted.forEach(file => {
        gitChanges[file] = 'deleted';
    });
    status.staged.forEach(file => {
        if (gitChanges[file]) {
            gitChanges[file] = 'staged';
        }
    });

    return gitChanges;
}

function formatBranchSummary(branchCurrent) {
    return `Branch: ${branchCurrent}`;
}

function formatGitStatus(gitChanges) {
    return Object.entries(gitChanges).map(([file, status]) => ({
        file,
        status,
        statusBadge: status.charAt(0).toUpperCase(),
        stageButtonLabel: getStageButtonLabel(status),
        stageAction: getStageAction(status),
    }));
}

function formatCommitHistory(log, formatDate = date => new Date(date).toLocaleString()) {
    const commits = log.all || log;
    return commits.map(commit => ({
        hash: commit.hash,
        shortHash: commit.hash.substring(0, 7),
        message: commit.message,
        meta: `${commit.author_name} on ${formatDate(commit.date)}`,
    }));
}

function getStageAction(fileStatus) {
    return fileStatus === 'staged' ? 'unstage' : 'stage';
}

function getStageButtonLabel(fileStatus) {
    return fileStatus === 'staged' ? 'Unstage' : 'Stage';
}

function canCommit(message, status) {
    return message.trim().length > 0;
}

function canResetToCommit(hash, confirmed) {
    return Boolean(hash) && confirmed === true;
}

function formatResetConfirmMessage(commit) {
    const shortHash = commit.hash.substring(0, 7);
    return `Reset to commit ${shortHash}: "${commit.message}"?\n\nThis will discard all changes after this commit.`;
}

function isGitChangesEmpty(gitChanges) {
    return Object.keys(gitChanges).length === 0;
}

module.exports = {
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
};
