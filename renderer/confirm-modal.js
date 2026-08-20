'use strict';

const state = require('./state');
const {
    confirmModal,
    confirmModalTitle,
    confirmModalBody,
    confirmOkBtn,
    confirmCancelBtn,
} = require('./dom');

function showConfirmModal({ title, body }) {
    return new Promise(resolve => {
        state.confirmResolve = resolve;
        confirmModalTitle.textContent = title;
        confirmModalBody.textContent = body;
        confirmModal.classList.add('visible');
        confirmOkBtn.focus();
    });
}

function closeConfirmModal(confirmed) {
    confirmModal.classList.remove('visible');
    if (state.confirmResolve) {
        state.confirmResolve(confirmed);
        state.confirmResolve = null;
    }
}

function attachConfirmModal() {
    confirmCancelBtn.addEventListener('click', () => closeConfirmModal(false));
    confirmOkBtn.addEventListener('click', () => closeConfirmModal(true));
    confirmModal.addEventListener('keydown', event => {
        if (!confirmModal.classList.contains('visible')) {
            return;
        }
        if (event.key === 'Escape') {
            event.preventDefault();
            closeConfirmModal(false);
        }
        if (event.key === 'Enter') {
            event.preventDefault();
            closeConfirmModal(true);
        }
    });
}

module.exports = {
    showConfirmModal,
    closeConfirmModal,
    attachConfirmModal,
};
