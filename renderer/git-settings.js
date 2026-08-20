'use strict';

const { ipcRenderer } = require('electron');
const { normalizeSplunkAddress, withSplunkOrigin } = require('../lib/url-utils');
const state = require('./state');
const {
    gitSyncSettingsBtn,
    gitSyncSettingsModal,
    gitSyncSplunkUrlInput,
    gitSyncRemoteUrlInput,
    gitSyncRemoteNameInput,
    gitSyncSharedBranchInput,
    gitSyncUserNameInput,
    gitSyncUserEmailInput,
    gitSyncSettingsStatus,
    gitSyncSettingsCancelBtn,
    gitSyncSettingsSaveBtn,
} = require('./dom');

async function loadGitSyncSettings() {
    state.gitSyncSettings = await ipcRenderer.invoke('get-git-sync-settings');
    state.SPLUNK_URL = normalizeSplunkAddress(state.gitSyncSettings.splunkUrl);
}

function populateGitSyncSettingsForm() {
    gitSyncSplunkUrlInput.value = state.gitSyncSettings.splunkUrl || state.SPLUNK_URL;
    gitSyncRemoteUrlInput.value = state.gitSyncSettings.remoteUrl || '';
    gitSyncRemoteNameInput.value = state.gitSyncSettings.remoteName || 'origin';
    gitSyncSharedBranchInput.value = state.gitSyncSettings.sharedBranch || 'main';
    gitSyncUserNameInput.value = state.gitSyncSettings.gitUserName || '';
    gitSyncUserEmailInput.value = state.gitSyncSettings.gitUserEmail || '';
}

function setGitSyncSettingsStatus(message, type = '') {
    gitSyncSettingsStatus.textContent = message;
    gitSyncSettingsStatus.classList.remove('error', 'success');
    if (type) {
        gitSyncSettingsStatus.classList.add(type);
    }
}

function openGitSyncSettingsModal() {
    populateGitSyncSettingsForm();
    setGitSyncSettingsStatus('');
    gitSyncSettingsModal.classList.add('visible');
    setTimeout(() => gitSyncSplunkUrlInput.focus(), 0);
}

function closeGitSyncSettingsModal() {
    gitSyncSettingsModal.classList.remove('visible');
    setGitSyncSettingsStatus('');
}

function retargetOpenViewsToSplunkUrl() {
    for (const file of state.files) {
        file.url = withSplunkOrigin(file.url || state.SPLUNK_URL, state.SPLUNK_URL);
        const view = document.getElementById(file.id);
        if (view) {
            view.src = file.url;
        }
    }
}

async function saveGitSyncSettingsFromModal() {
    const settings = {
        splunkUrl: gitSyncSplunkUrlInput.value,
        remoteUrl: gitSyncRemoteUrlInput.value,
        remoteName: gitSyncRemoteNameInput.value,
        sharedBranch: gitSyncSharedBranchInput.value,
        gitUserName: gitSyncUserNameInput.value,
        gitUserEmail: gitSyncUserEmailInput.value
    };

    gitSyncSettingsSaveBtn.disabled = true;
    setGitSyncSettingsStatus('Saving...');

    try {
        const result = await ipcRenderer.invoke('set-git-sync-settings', settings);
        if (!result || !result.ok) {
            setGitSyncSettingsStatus(result?.message || 'Failed to save settings', 'error');
            return;
        }
        await loadGitSyncSettings();
        retargetOpenViewsToSplunkUrl();
        closeGitSyncSettingsModal();
    } catch (error) {
        setGitSyncSettingsStatus(error.message || 'Failed to save settings', 'error');
    } finally {
        gitSyncSettingsSaveBtn.disabled = false;
    }
}

function getGitAuthorFromSettings() {
    const name = (state.gitSyncSettings.gitUserName || '').trim();
    const email = (state.gitSyncSettings.gitUserEmail || '').trim();
    if (name && email) {
        return { name, email };
    }
    if (name) {
        return { name, email: '' };
    }
    return undefined;
}

function getGitRemoteSettings() {
    return {
        remoteUrl: state.gitSyncSettings.remoteUrl || '',
        remoteName: state.gitSyncSettings.remoteName || 'origin',
        sharedBranch: state.gitSyncSettings.sharedBranch || 'main'
    };
}

function attachGitSettings() {
    gitSyncSettingsBtn.addEventListener('click', openGitSyncSettingsModal);
    gitSyncSettingsCancelBtn.addEventListener('click', closeGitSyncSettingsModal);
    gitSyncSettingsSaveBtn.addEventListener('click', saveGitSyncSettingsFromModal);
    gitSyncSettingsModal.addEventListener('keydown', event => {
        if (!gitSyncSettingsModal.classList.contains('visible')) {
            return;
        }
        if (event.key === 'Escape') {
            event.preventDefault();
            closeGitSyncSettingsModal();
        }
    });
}

module.exports = {
    loadGitSyncSettings,
    populateGitSyncSettingsForm,
    setGitSyncSettingsStatus,
    openGitSyncSettingsModal,
    closeGitSyncSettingsModal,
    retargetOpenViewsToSplunkUrl,
    saveGitSyncSettingsFromModal,
    getGitAuthorFromSettings,
    getGitRemoteSettings,
    attachGitSettings,
};
