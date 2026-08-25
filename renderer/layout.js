'use strict';

const state = require('./state');
const {
    sidebar,
    sidebarCollapseBtn,
    sidebarReopenBtn,
    sidebarResize,
    querySidebarResize,
    sidebarDragOverlay,
    querySidebar,
    querySidebarReopenBtn,
    queryHistoryClose,
} = require('./dom');

const QUERY_SIDEBAR_COLLAPSED_KEY = 'splunk-ide-query-sidebar-collapsed';
const QUERY_SIDEBAR_WIDTH_KEY = 'splunk-ide-query-sidebar-width';
const PROJECT_SIDEBAR_COLLAPSED_KEY = 'splunk-ide-project-sidebar-collapsed';
const PROJECT_SIDEBAR_WIDTH_KEY = 'splunk-ide-project-sidebar-width';
const QUERY_SIDEBAR_MIN_WIDTH = 220;
const QUERY_SIDEBAR_MAX_WIDTH = 560;
const QUERY_SIDEBAR_DEFAULT_WIDTH = 320;
const PROJECT_SIDEBAR_MIN_WIDTH = 180;
const PROJECT_SIDEBAR_MAX_WIDTH = 520;
const PROJECT_SIDEBAR_DEFAULT_WIDTH = 260;

let syncActiveFile;
let refreshHistory;
let updateStatusBar;

function clampQuerySidebarWidth(width) {
    return Math.min(QUERY_SIDEBAR_MAX_WIDTH, Math.max(QUERY_SIDEBAR_MIN_WIDTH, width));
}

function applyQuerySidebarWidth(width, { persist = true } = {}) {
    const clamped = clampQuerySidebarWidth(width);
    querySidebar.style.width = `${clamped}px`;
    if (persist) {
        localStorage.setItem(QUERY_SIDEBAR_WIDTH_KEY, String(clamped));
    }
    return clamped;
}

function clampProjectSidebarWidth(width) {
    return Math.min(PROJECT_SIDEBAR_MAX_WIDTH, Math.max(PROJECT_SIDEBAR_MIN_WIDTH, width));
}

function applyProjectSidebarWidth(width, { persist = true } = {}) {
    const clamped = clampProjectSidebarWidth(width);
    sidebar.style.width = `${clamped}px`;
    if (persist) {
        localStorage.setItem(PROJECT_SIDEBAR_WIDTH_KEY, String(clamped));
    }
    return clamped;
}

function setupSidebarResizeDrag({ handle, getStartWidth, computeWidth, onWidth, isDisabled }) {
    handle.addEventListener('mousedown', event => {
        if (isDisabled()) {
            return;
        }
        event.preventDefault();
        const startX = event.clientX;
        const startWidth = getStartWidth();

        const preventSelect = e => e.preventDefault();
        const onMouseMove = moveEvent => {
            moveEvent.preventDefault();
            onWidth(computeWidth(startWidth, startX, moveEvent.clientX));
        };
        const cleanup = () => {
            handle.classList.remove('dragging');
            document.body.classList.remove('sidebar-resizing');
            sidebarDragOverlay.classList.remove('active');
            sidebarDragOverlay.removeEventListener('mousemove', onMouseMove);
            sidebarDragOverlay.removeEventListener('mouseup', cleanup);
            window.removeEventListener('blur', cleanup);
            document.removeEventListener('selectstart', preventSelect);
        };

        handle.classList.add('dragging');
        document.body.classList.add('sidebar-resizing');
        sidebarDragOverlay.classList.add('active');
        sidebarDragOverlay.addEventListener('mousemove', onMouseMove);
        sidebarDragOverlay.addEventListener('mouseup', cleanup);
        window.addEventListener('blur', cleanup);
        document.addEventListener('selectstart', preventSelect);
    });
}

function initializeProjectSidebarResize() {
    const saved = Number.parseInt(localStorage.getItem(PROJECT_SIDEBAR_WIDTH_KEY), 10);
    applyProjectSidebarWidth(Number.isFinite(saved) ? saved : PROJECT_SIDEBAR_DEFAULT_WIDTH, { persist: false });

    setupSidebarResizeDrag({
        handle: sidebarResize,
        getStartWidth: () => sidebar.offsetWidth,
        computeWidth: (startWidth, startX, clientX) => startWidth + (clientX - startX),
        onWidth: applyProjectSidebarWidth,
        isDisabled: () => sidebar.classList.contains('collapsed'),
    });
}

function initializeQuerySidebarResize() {
    const saved = Number.parseInt(localStorage.getItem(QUERY_SIDEBAR_WIDTH_KEY), 10);
    applyQuerySidebarWidth(Number.isFinite(saved) ? saved : QUERY_SIDEBAR_DEFAULT_WIDTH, { persist: false });

    setupSidebarResizeDrag({
        handle: querySidebarResize,
        getStartWidth: () => querySidebar.offsetWidth,
        computeWidth: (startWidth, startX, clientX) => startWidth + (startX - clientX),
        onWidth: applyQuerySidebarWidth,
        isDisabled: () => querySidebar.classList.contains('collapsed'),
    });
}

function setProjectSidebarCollapsed(collapsed, { persist = true } = {}) {
    sidebar.classList.toggle('collapsed', collapsed);
    sidebarReopenBtn.classList.toggle('visible', collapsed);
    if (persist) {
        localStorage.setItem(PROJECT_SIDEBAR_COLLAPSED_KEY, String(collapsed));
    }
}

function initializeLayoutControls() {
    initializeProjectSidebarResize();
    initializeQuerySidebarResize();
    setProjectSidebarCollapsed(localStorage.getItem(PROJECT_SIDEBAR_COLLAPSED_KEY) === 'true', { persist: false });
}

function setQueryHistoryPanelOpen(open, { persist = true } = {}) {
    querySidebar.classList.toggle('collapsed', !open);
    querySidebarReopenBtn.classList.toggle('visible', !open);
    if (persist) {
        localStorage.setItem(QUERY_SIDEBAR_COLLAPSED_KEY, String(!open));
    }
    if (open) {
        void (async () => {
            const file = state.files.find(f => f.id === state.activeFileId);
            if (file) {
                await syncActiveFile(file.id);
            }
            await refreshHistory();
        })();
    } else {
        updateStatusBar();
    }
}

function toggleQueryHistoryPanel() {
    if (!state.activeFileId) {
        return;
    }
    const isOpen = !querySidebar.classList.contains('collapsed');
    setQueryHistoryPanelOpen(!isOpen);
}

function attachLayout({ syncActiveFile: syncFn, refreshHistory: refreshFn, updateStatusBar: statusFn }) {
    syncActiveFile = syncFn;
    refreshHistory = refreshFn;
    updateStatusBar = statusFn;
    queryHistoryClose.addEventListener('click', () => setQueryHistoryPanelOpen(false));
    querySidebarReopenBtn.addEventListener('click', () => setQueryHistoryPanelOpen(true));
    sidebarCollapseBtn.addEventListener('click', () => setProjectSidebarCollapsed(true));
    sidebarReopenBtn.addEventListener('click', () => setProjectSidebarCollapsed(false));
}

module.exports = {
    QUERY_SIDEBAR_COLLAPSED_KEY,
    attachLayout,
    initializeLayoutControls,
    setProjectSidebarCollapsed,
    setQueryHistoryPanelOpen,
    toggleQueryHistoryPanel,
};
