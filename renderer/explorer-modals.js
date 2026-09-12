'use strict';

const { folderForId, explorerIdForFile } = require('../lib/explorer/ide-folders');
const state = require('./state');
const {
    newItemMenu,
    newFileModal,
    newFileModalLabel,
    newFileModalInput,
    newFileFolderRow,
    newFileFolderSelect,
    newFileCreateBtn,
} = require('./dom');

let createNewFile;
let createNewFolder;
let renameFile;
let moveFile;

function attachExplorerModals(deps) {
    ({
        createNewFile = createNewFile,
        createNewFolder = createNewFolder,
        renameFile = renameFile,
        moveFile = moveFile,
    } = deps);
}

function populateFolderSelect(selectedValue = '') {
    newFileFolderSelect.innerHTML = '';
    const rootOption = document.createElement('option');
    rootOption.value = '';
    rootOption.textContent = 'Root';
    newFileFolderSelect.appendChild(rootOption);

    const sortedFolders = [...state.folders].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    sortedFolders.forEach(folderPath => {
        const option = document.createElement('option');
        option.value = folderPath;
        option.textContent = folderPath;
        if (folderPath === selectedValue) {
            option.selected = true;
        }
        newFileFolderSelect.appendChild(option);
    });
}

function getSelectedFolder() {
    return newFileFolderSelect.value || '';
}

function openMoveFileModal(file) {
    state.modalMode = 'move';
    state.modalTargetFileId = file.id;
    newFileModalLabel.textContent = `Move "${file.name.split('/').pop()}" to folder`;
    newFileModalInput.value = file.name.split('/').pop();
    newFileModalInput.disabled = true;
    populateFolderSelect(folderForId(state.ideFolders, explorerIdForFile(file)));
    showNewFileModal();
}

function hideNewItemMenu() {
    newItemMenu.classList.remove('visible');
}

function openNewFileModal() {
    state.modalMode = 'create';
    state.modalTargetFileId = null;
    newFileModalLabel.textContent = 'New Search';
    newFileModalInput.value = `Search ${state.fileCounter}`;
    showNewFileModal();
}

function openNewFolderModal() {
    state.modalMode = 'folder';
    state.modalTargetFileId = null;
    newFileModalLabel.textContent = 'New Folder Name';
    newFileModalInput.value = '';
    showNewFileModal();
}

function openRenameModal(file) {
    state.modalMode = 'rename';
    state.modalTargetFileId = file.id;
    newFileModalLabel.textContent = `Rename "${file.name.split('/').pop()}"`;
    newFileModalInput.value = file.name;
    showNewFileModal();
}

function showNewFileModal() {
    if (state.modalMode === 'rename') {
        newFileModalLabel.textContent = `Rename "${state.files.find(f => f.id === state.modalTargetFileId)?.name.split('/').pop() || ''}"`;
        newFileFolderRow.style.display = 'none';
        newFileModalInput.disabled = false;
    } else if (state.modalMode === 'folder') {
        newFileModalLabel.textContent = 'New Folder Name';
        newFileFolderRow.style.display = 'none';
        newFileModalInput.disabled = false;
    } else if (state.modalMode === 'move') {
        newFileModalLabel.textContent = `Move "${state.files.find(f => f.id === state.modalTargetFileId)?.name.split('/').pop() || ''}" to folder`;
        newFileFolderRow.style.display = 'block';
        newFileModalInput.disabled = true;
    } else {
        newFileModalLabel.textContent = 'New Search';
        newFileFolderRow.style.display = 'none';
        newFileModalInput.disabled = false;
    }

    if (state.modalMode === 'rename') {
        newFileCreateBtn.textContent = 'Rename';
    } else if (state.modalMode === 'move') {
        newFileCreateBtn.textContent = 'Move';
    } else if (state.modalMode === 'folder') {
        newFileCreateBtn.textContent = 'Create Folder';
    } else {
        newFileCreateBtn.textContent = 'Create';
    }
    newFileModalInput.placeholder = state.modalMode === 'folder' ? 'Folder name' : 'Enter file name or path';
    newFileModal.classList.add('visible');
    setTimeout(() => {
        newFileModalInput.select();
        newFileModalInput.focus();
    }, 0);
}

function closeNewFileModal() {
    newFileModal.classList.remove('visible');
    state.modalMode = 'create';
    state.modalTargetFileId = null;
}

function confirmNewFileCreation() {
    const name = newFileModalInput.value;
    const selectedFolder = getSelectedFolder();
    if (state.modalMode === 'rename' && state.modalTargetFileId) {
        renameFile(state.modalTargetFileId, name);
    } else if (state.modalMode === 'folder') {
        createNewFolder(name);
    } else if (state.modalMode === 'move' && state.modalTargetFileId) {
        moveFile(state.modalTargetFileId, selectedFolder);
    } else {
        createNewFile(name);
    }
    closeNewFileModal();
}

module.exports = {
    attachExplorerModals,
    populateFolderSelect,
    getSelectedFolder,
    openMoveFileModal,
    hideNewItemMenu,
    openNewFileModal,
    openNewFolderModal,
    openRenameModal,
    showNewFileModal,
    closeNewFileModal,
    confirmNewFileCreation,
};
