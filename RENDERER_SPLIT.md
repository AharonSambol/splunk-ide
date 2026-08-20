# Navigation overhaul — split `renderer.js`

Worktree: `/Users/ilais/Projects/kedem/splunk-ide.navigation-overhaul`  
Branch: `navigation-overhaul`  
HEAD at plan write: cheap-cut commit on this branch (CSS extract, dead git-view-model). Rebase onto `master` again before starting if `master` moved.

Goal: `renderer.js` becomes a thin entry (`<script src="./renderer.js">` stays). Logic moves into `renderer/*.js` by **UI surface**. No behavior change. No bundler. No `lib/` regroup in this wave.

Cheap cuts are done (`NAVIGATION_OVERHAUL.md`). This file is the next execution plan.

---

## Atom protocol (mandatory)

Every split is one **atom**: the smallest move that still leaves the app runnable. No batching tracks into one commit.

Do these five steps **in order**. Do not start the next atom until HEAD contains this one.

### 1. Analyze pre-split behavior

Write down (in the commit body, and keep here if it is not already in the track):

- What the code does today: inputs, outputs, DOM, IPC, git, folder map.
- Callers (grep). Shared `let`s / Maps it closes over.
- What must **not** change (especially folder path `ideFolders` → `toExplorerInput` → `buildFileTree` → `renderExplorer`).

If you cannot describe the behavior in a few bullets, you have not read enough. Do not cut yet.

### 2. Document specific testing criteria

Before editing, list **runnable** checks. Each check must have an expected result you can compare after the splice.

Minimum per atom:

| Kind | Example |
|---|---|
| Syntax | `node --check` on every touched file |
| Grep | function exists in the **new** file, gone from `renderer.js` (or still in `renderer.js` only if the atom is scaffold) |
| Unit | named `node --test …` files that cover the moved surface |
| Source-grep | the three restore tests if the atom touches restore / `renderer.js` strings they pin |
| Folder | `ide-folders` / `file-tree` / `render-explorer` if the atom can see explorer |
| Smoke | only the specs that can catch this atom (see track). Do not require a green full smoke suite |

Record Wave 0 (or previous atom HEAD) pass/fail titles. After the splice, **new** failures are a regress. Known smoke drift (git tab, `#header` hidden, auto `searches`) is baseline, not a fix-it ticket.

### 3. Split

Move code. No behavior change. No drive-by renames, CSS, or `lib/` edits.

### 4. Validate behavior remains

Re-run **exactly** the criteria from step 2. Diff against the pre-split notes. If a check fails, revert the atom; do not commit.

### 5. Commit the iteration

One commit per atom. Message: what moved and why. Body: pre-split one-liner + commands run + result (pass counts / grep).

Do not commit a failing atom. Do not start the next track on an uncommitted splice.

---

## Why extracts are mostly serial

Every concern currently closes over the same module-level `let`s in `renderer.js`. Two writers editing that file will conflict.

**Disjoint-file rule:** only **one** track may edit `renderer.js` at a time. Other tracks may **create** their `renderer/<name>.js` from a snapshot, plus tests, without splicing. A splice step (delete the originals, `require` the new module, keep listeners working) is always serial and owned by whoever currently holds `renderer.js`.

If using subagents: one writer for the splice queue. Extra children only to **draft** destination files (no `renderer.js` edits). Parent splices and runs Wave 2.

If serial (default): Track 0 → A → B → C → D → E → F → G.

---

## Protected: folder logic (do not break)

Live explorer path (do not rewrite, only **move** the call site):

`ideFolders` → `toExplorerInput` → `buildFileTree` → `renderExplorer`

**Keep these files and symbols. Move, do not reimplement.**

| File | Role |
|---|---|
| `lib/ide-folders.js` | `ide-folders.json` CRUD, `toExplorerInput`, folder ids |
| `lib/file-tree.js` | `buildFileTree` |
| `lib/render-explorer.js` | nested explorer DOM |
| `test/ide-folders.test.js` | keep passing |
| `test/file-tree.test.js` | keep passing |
| `test/render-explorer.test.js` | keep passing |

**Keep these `renderer` symbols** (they may live in `renderer/explorer.js` after Track F, not be inlined or renamed):

`IDE_FOLDERS_FILE`, `explorerIdForFile`, `folderNames`, `folderForId`, `addIdeFolder`, `removeIdeFolder`, `setItemFolder`, `replaceItemId`, `pruneIdeFolders`, `toExplorerInput`, `readIdeFolders`, `writeIdeFolders`, `buildFileTree`, `renderExplorer`, `updateExplorer`, `createNewFolder`, `deleteFolder`, `persistIdeFolders`, `loadIdeFoldersFromProject`, `syncFolderList`, `collapsedExplorerFolders`.

**Keep these DOM ids / CSS** (do not “clean up” while moving JS):

`#new-file-btn`, `#new-item-menu`, `#new-search-choice`, `#new-folder-btn`, `#new-file-folder-row`, `#new-file-folder-select`, `.folder-root`, `details.folder`, `.folder-contents`, `.folder-actions`.

Track F is the only track that **moves** explorer functions. Other tracks must not change `updateExplorer` or folder CRUD.

---

## Target layout (stop here)

```
renderer.js                 # requires, window.onload, ipc wiring, ~150–300 lines
renderer/state.js           # mutable app state (the current lets)
renderer/dom.js             # getElementById consts
renderer/confirm-modal.js
renderer/find-overlay.js
renderer/git-settings.js
renderer/quick-search.js
renderer/layout.js
renderer/tabs.js            # tab bar + webview create/navigate
renderer/explorer.js        # project load, files, folders, new-file modal
renderer/history.js         # version list, tags, save/restore, Ace helpers
```

Do **not** add `renderer/index.js`, a store class, events/EventTarget, or getters for every field. `state.js` is a plain object. Modules `require('./state')` and mutate it the same way `renderer.js` does today.

`index.html` still loads only `./renderer.js`. Extracted files are pulled in via `require`.

---

## Out of scope

- `lib/` folders (`git/`, `splunk/`, `explorer/`).
- Splitting `lib/query-versions.js`.
- Wiring or deleting folder explorer.
- Fixing stale smoke (git Source Control tab, `#header` hidden, auto-load `searches`). Record as baseline; do not “fix” in this wave.
- Deduping slug helpers / saved-search vs dashboard git helpers.
- Rewriting README or git ledgers.
- Turning source-snapshot tests into real unit tests beyond retargeting the file they grep.

---

## Source-grep tests (must follow moved code)

These **read `renderer.js` as text**. After a splice, point them at the file that now contains the snippet (or grep all of `renderer/`).

| Test | What it pins |
|---|---|
| `test/plain-restore-dispatch.test.js` | `restorePlainQueryVersion({` after dashboard early return |
| `test/saved-search-restore-tracked-base.test.js` | `if (trackedHash === hash)` discard-draft branch |
| `test/saved-search-no-canonical-spl.test.js` | renderer must not contain `getSavedSearchPath` |

**Before every splice that touches restore / saved-search:** run those three files. **After:** they still pass, with paths updated if the strings left `renderer.js`.

---

## Wave 0 — baseline (serial, once)

```bash
cd /Users/ilais/Projects/kedem/splunk-ide.navigation-overhaul
wc -l renderer.js
node --check renderer.js
node --test test/plain-restore-dispatch.test.js test/saved-search-restore-tracked-base.test.js test/saved-search-no-canonical-spl.test.js
node --test test/ide-folders.test.js test/file-tree.test.js test/render-explorer.test.js
node --test $(find test -name '*.test.js' | sort)
npx playwright test --list
npx playwright test test/smoke/app-launch.spec.js test/smoke/selection-drag.spec.mjs
```

**Record**

- `renderer.js` line count (expect ~3776).
- Unit: 370 pass (or current HEAD count). `npm run test:unit` **lies** (`test/**/*.test.js` skips `test/*.test.js`). Always use `find` until that script is fixed (not this wave unless you touch `package.json` `test:syntax` only).
- Source-grep tests pass.
- Folder tests pass.
- Smoke: shell + selection-drag pass. Copy failing titles for git tab / `#new-project-btn` hidden / `searches` auto-project. Later tracks may not add **new** titles.

**Grep snapshot** (folder wiring must remain after every track):

```bash
rg -n "toExplorerInput|buildFileTree|renderExplorer|updateExplorer" renderer.js renderer/*.js
rg -n "restorePlainQueryVersion|getSavedSearchPath|trackedHash === hash" renderer.js renderer/*.js
```

---

## Track 0 — scaffold `state` + `dom` (two atoms)

Move the **data**, not the behavior. Two commits: DOM first (destructure is safe), then state (`state.files` — destructure would freeze the array).

**Do not touch:** any `lib/*`, `updateExplorer` body, restore function bodies.

### Atom 0a — `renderer/dom.js`

**Pre-split behavior**

- At script load (end of `index.html` body), `renderer.js` queries each shell node once and holds the result in a `const`.
- Those consts are never reassigned. Listeners close over the same nodes.
- `attachParentSelectionCleanup(document)` stays in `renderer.js`.

**Testing criteria**

| Check | Expect |
|---|---|
| `node --check renderer.js renderer/dom.js` | exit 0 |
| `rg "getElementById\\('explorer'\\)|getElementById\\('new-file-btn'\\)" renderer.js` | no hits (webview `getElementById(file.id)` stays) |
| `rg "getElementById\\('explorer'\\)" renderer/dom.js` | hit |
| source-grep three tests | pass |
| folder three tests | pass |
| `npx playwright test test/smoke/app-launch.spec.js test/smoke/selection-drag.spec.mjs` | Wave 0: shell + 3 drag pass; other app-launch/project-flow fails unchanged |

**Change:** `renderer/dom.js` exports the same names. `renderer.js` destructures `require('./renderer/dom')`.

**Commit** after validate.

### Atom 0b — `renderer/state.js`

**Pre-split behavior**

- Module-level `let`s / `Map`s / `Set`s are the store (`files`, `ideFolders`, draft maps, find overlay, …).
- Several `let`s are **reassigned** (`files =`, `gitSyncSettings =`, `SPLUNK_URL =`, `collapsedExplorerFolders = new Set(...)`).
- `const restoreParentByFileId` (and sibling Maps/Sets) are mutated in place, never replaced.

**Testing criteria**

| Check | Expect |
|---|---|
| `rg -n "^let files" renderer.js` | no hits |
| `updateExplorer` uses `state.files` / `state.ideFolders` | still `toExplorerInput` → `buildFileTree` → `renderExplorer` |
| `node --check renderer.js renderer/state.js` | exit 0 |
| source-grep three tests | pass |
| folder three tests | pass |
| `node --test $(find test -name '*.test.js')` | ≥ Wave 0 count, no new fails |
| smoke shell + selection-drag | same as Wave 0 |

**Change:** `renderer/state.js` holds initial values. `renderer.js` uses `state.*`. Replace longest identifiers first (`ideFolders` before `folders`, `fileMru` before `files`, `SPLUNK_URL` not `DEFAULT_SPLUNK_URL`).

**Commit** after validate.

---

## Track A — confirm modal

Smallest splice. Proves the pattern. Follow the atom protocol.

**Pre-split behavior**

- `showConfirmModal({ title, body })` fills `#confirm-modal-title` / `#confirm-modal-body`, adds `.visible`, focuses OK, returns a Promise.
- `closeConfirmModal(confirmed)` hides the modal and resolves that Promise once.
- Cancel / OK / Enter / Escape on the modal call `closeConfirmModal`. Overlay click is handled in the shared `mousedown` closer (leave that listener in `renderer.js` unless it is only confirm — grep; if it also closes other overlays, do not move it).

**Testing criteria**

| Check | Expect |
|---|---|
| `rg "function showConfirmModal" renderer.js` | no hits |
| `rg "function showConfirmModal" renderer/confirm-modal.js` | hit |
| `node --check renderer.js renderer/confirm-modal.js` | exit 0 |
| source-grep + folder tests | pass |
| `find` unit suite | no new fails |
| grep `showConfirmModal(` still called from delete/restore paths | hits in `renderer.js` or `renderer/history.js` / explorer |

**Own:** `renderer/confirm-modal.js` after Track 0.  
**Functions:** `showConfirmModal`, `closeConfirmModal`. Listeners on `#confirm-*` only.

**Before**

```bash
rg -n "function showConfirmModal|function closeConfirmModal" renderer.js
node --check renderer.js
```

**Change**

Export `attachConfirmModal({ state, dom })` or just require `dom`/`state` and `attachConfirmModal()` from `renderer.js`. Move the three `addEventListener`s with the functions.

**After**

```bash
rg -n "function showConfirmModal" renderer.js
# expect: no hits
rg -n "function showConfirmModal" renderer/confirm-modal.js
node --check renderer.js renderer/confirm-modal.js
node --test $(find test -name '*.test.js' | sort)
```

**Done when** delete-file confirm and restore confirm still appear and Enter/Escape still work. No new smoke titles.

---

## Track B — find overlay

**Own:** `renderer/find-overlay.js`.  
**Functions:** `createFindOverlay`, `showFindOverlay`, `hideFindOverlay`, `doFind`. State: `_findOverlay`, `_lastFindQuery`, `_findWasActive`.

`handleKeyboardShortcut` **stays** in `renderer.js` (or Track D) and **calls** `showFindOverlay` / `hideFindOverlay`. Do not move the whole keymap yet.

**Before**

```bash
rg -n "function createFindOverlay|function doFind" renderer.js
node --check renderer.js
```

**Change**

Move find DOM construction + `find-in-page` / `stop-find-in-page` IPC used only by these four functions.

**After**

```bash
rg -n "function createFindOverlay" renderer.js
# expect: no hits
node --check renderer.js renderer/find-overlay.js
node --test test/main-find-in-page.test.js
```

**Done when** Cmd/Ctrl+F still opens the overlay on an open tab; Escape still closes it and clears find. Shortcut handler in `renderer.js` still references the exported functions.

**Status:** moved `createFindOverlay` / `showFindOverlay` / `hideFindOverlay` / `doFind` to `renderer/find-overlay.js`. Keymap and shared mousedown closer stay in `renderer.js` and call the exports. Commit: _this atom_. Before: overlay functions in `renderer.js`; `node --check` ok; 10 find-in-page, 26 restore/folder, smoke shell + 3 drag pass. After: functions gone from `renderer.js`, present in `renderer/find-overlay.js`; same checks pass.

---

## Track C — git settings modal

**Own:** `renderer/git-settings.js`.  
**Functions:** `loadGitSyncSettings`, `populateGitSyncSettingsForm`, `setGitSyncSettingsStatus`, `openGitSyncSettingsModal`, `closeGitSyncSettingsModal`, `retargetOpenViewsToSplunkUrl`, `saveGitSyncSettingsFromModal`, `getGitAuthorFromSettings`, `getGitRemoteSettings`.

`window.onload` still calls `loadGitSyncSettings`. Push/reconcile stay with saved-search flow (Track G).

**Do not** move `ensureRemote` / `pushSharedHistoryWithReconcile` call sites out of history/save.

**Before**

```bash
rg -n "function loadGitSyncSettings|function openGitSyncSettingsModal" renderer.js
node --test test/git-settings.test.js
```

**Change**

Move modal listeners (`#git-sync-settings-*`). Keep `lib/git-settings.js` as the main-process persistence; this file is renderer UI only.

**After**

```bash
rg -n "function loadGitSyncSettings" renderer.js
# expect: no hits
node --test test/git-settings.test.js
node --check renderer.js renderer/git-settings.js
```

**Done when** gear modal still loads/saves Splunk URL + remote; changing Splunk URL still retargets open webviews. `state.SPLUNK_URL` / `state.gitSyncSettings` still what `createView` reads.

---

## Track D — quick search

**Own:** `renderer/quick-search.js`.  
**Functions:** `openQuickSearch`, `closeQuickSearch`, `updateQuickSearchResults`, `handleQuickSearchKeydown`, `activateFileFromQuickSearch`.

Keep using `lib/quick-search.js` + `lib/render-quick-search.js`. Do not merge those libs into this file.

Shift-Shift remains in the keymap; it only **calls** `openQuickSearch()`.

**Before**

```bash
rg -n "function openQuickSearch|function updateQuickSearchResults" renderer.js
node --test test/quick-search.test.js test/render-quick-search.test.js
```

**After**

```bash
rg -n "function openQuickSearch" renderer.js
# expect: no hits
node --test test/quick-search.test.js test/render-quick-search.test.js
```

Smoke `opens quick search overlay with double-shift` must not get **worse** than Wave 0 (it may already fail on hidden `#new-project-btn`). If you can open a project another way, overlay still gets `.visible`.

**Done when** file and content modes still work; arrow keys + Enter still open the tab.

---

## Track E — layout (sidebars)

**Own:** `renderer/layout.js`.  
**Functions:** `clampQuerySidebarWidth`, `applyQuerySidebarWidth`, `clampProjectSidebarWidth`, `applyProjectSidebarWidth`, `setupSidebarResizeDrag`, `initializeProjectSidebarResize`, `initializeQuerySidebarResize`, `setProjectSidebarCollapsed`, `initializeLayoutControls`, `setQueryHistoryPanelOpen`, `toggleQueryHistoryPanel`.

`setQueryHistoryPanelOpen(true)` still calls `syncFileFromViewUrl` + `refreshQueryHistory` (those functions stay elsewhere; require them or pass callbacks). **Lazy:** pass `{ syncActiveFile, refreshHistory, updateStatusBar }` into `attachLayout` so layout does not `require('./history')` before Track G exists.

**Before**

```bash
rg -n "function initializeLayoutControls|function setQueryHistoryPanelOpen" renderer.js
```

**After**

```bash
rg -n "function initializeLayoutControls" renderer.js
# expect: no hits
node --check renderer.js renderer/layout.js
```

**Done when** both sidebars resize, collapse, reopen; widths persist in `localStorage` under the same keys. History toggle still refreshes the list.

---

## Track F — explorer + project (protected)

**Own:** `renderer/explorer.js`.  
**Functions (move, do not rewrite):** `createFileWithUrl`, `createNewFile`, `createNewFolder`, `deleteFile`, `deleteFolder`, `removeFile`, `openFile`, path helpers (`getProjectFilePath`, `ensureDirectoryExists`, `scanProjectFiles`, `scanProjectFolders`), `populateFolderSelect`, `getSelectedFolder`, `openMoveFileModal`, `moveFile`, `createNewProject`, `openProject`, `loadProject`, `clearOpenTabs`, `hideNewItemMenu`, `syncFolderList`, collapsed-folder persist, `persistIdeFolders`, `loadIdeFoldersFromProject`, `updateProjectDisplay`, new-file/rename modal helpers, `renameFile`, `updateExplorer`, `openStartupSearch`.

Listeners on `#new-file-btn`, `#new-item-menu`, `#new-folder-btn`, `#new-file-modal-*`, `#new-project-btn`, `#open-project-btn`.

**Do not** change the `updateExplorer` body except `state.` / `dom.` prefixes already applied in Track 0.

**Before**

```bash
rg -n "toExplorerInput|buildFileTree|renderExplorer" renderer.js
node --test test/ide-folders.test.js test/file-tree.test.js test/render-explorer.test.js test/project-files.test.js
```

Expect `updateExplorer` in `renderer.js` still contains the three calls.

**Change**

Move as a block. `loadProject` still calls `initializeQueryVersions` via a callback injected from `renderer.js` / history module — do not copy history into explorer.

**After**

```bash
rg -n "function updateExplorer" renderer.js
# expect: no hits
rg -n "toExplorerInput|buildFileTree|renderExplorer" renderer/explorer.js
node --test test/ide-folders.test.js test/file-tree.test.js test/render-explorer.test.js test/project-files.test.js test/integration/project-files.integration.test.js
```

Manual: create folder, drag search into it, collapse chevron (name stays beside chevron), new-file modal folder select, delete folder, reload project → `ide-folders.json` membership unchanged.

**Done when** folder unit tests pass **without edits** (unless a test grepped `renderer.js` — none currently should). Explorer empty copy unchanged.

---

## Track G — tabs + history (largest, last)

Split into two files if the splice is huge; still **one** `renderer.js` owner.

### G1 — tabs / webview

**Own:** `renderer/tabs.js`.  
**Functions:** `getOpenTabIds`, `closeTab`, `duplicateCurrentTab`, `copyActiveFileUrl`, `getViewUrl`, `updateTabLabel`, `createTab`, `createView`, `navigateBack`, `navigateForward`, `updateNavButtons`, `applyTabOrder`, `reorderTabs`, `switchToFile`, `openMostRecentTab`, `switchToPreviousTab`, `switchToNextTab`.

`createView` keeps preload, injectors, `splunk-save` IPC, selection-drag handlers. Do not inline `lib/webview-*`.

### G2 — query history / restore

**Own:** `renderer/history.js`.  
**Functions:** everything left that is versions, tags, Ace read/write, `handleSplunkSave`, `enterSavedSearchHistory`, `enterDashboardHistory`, `restoreQueryVersion`, `saveQueryVersion`, `refreshQueryHistory`, `renderQueryVersionList`, preview, status bar, keyboard handler if it still lives in `renderer.js`.

**Must move with the restore body** (source-grep tests):

- `restorePlainQueryVersion({` dispatch
- `if (trackedHash === hash)` discard-draft branch
- absence of `getSavedSearchPath`

**Before**

```bash
node --test test/plain-restore-dispatch.test.js test/saved-search-restore-tracked-base.test.js test/saved-search-no-canonical-spl.test.js test/tabs.test.js test/render-tabs.test.js
rg -n "restorePlainQueryVersion|trackedHash === hash" renderer.js
```

**Change**

1. Move G1, splice, run tab tests + smoke launch/selection-drag.
2. Move G2, **retarget** the three source-grep tests to `renderer/history.js` (or a helper that concatenates `renderer.js` + `renderer/**/*.js`).
3. `renderer.js` left with: requires, `attach*` calls, `window.onload`, `ipcRenderer.on('app-keydown')`, `ipcRenderer.on('context-menu-command')`.

**After**

```bash
wc -l renderer.js renderer/*.js
node --check renderer.js renderer/*.js
node --test test/plain-restore-dispatch.test.js test/saved-search-restore-tracked-base.test.js test/saved-search-no-canonical-spl.test.js
node --test $(find test -name '*.test.js' | sort)
```

Expect `renderer.js` **under ~400 lines**. History file will be large; that is OK. Do not split history further in this wave.

**Done when** save version, restore, tag popup, multi-select compare, saved-search vs dashboard vs plain `.spl` restore still match pre-split. Source-grep tests pass on the new path.

---

## Wave 2 — integrate

```bash
cd /Users/ilais/Projects/kedem/splunk-ide.navigation-overhaul
git status --short
node --check renderer.js renderer/state.js renderer/dom.js renderer/confirm-modal.js renderer/find-overlay.js renderer/git-settings.js renderer/quick-search.js renderer/layout.js renderer/tabs.js renderer/explorer.js renderer/history.js
node --test $(find test -name '*.test.js' | sort)
npx playwright test --list
npm run test:smoke
```

Add new `renderer/*.js` paths to `package.json` `test:syntax` (`node --check` each file). Do not “fix” the `test:unit` glob unless it is a one-line change you want in this wave.

**Pass bar**

| Check | Expect |
|---|---|
| `index.html` | still `<script src="./renderer.js">` only |
| `renderer.js` | entry + wiring, no `function updateExplorer`, no restore body |
| `renderer/explorer.js` | `toExplorerInput` → `buildFileTree` → `renderExplorer` |
| folder tests | pass, same assertions |
| source-grep tests | pass, paths updated |
| unit `find` | green; count ≥ Wave 0 |
| smoke | Wave 0 failures only, plus selection-drag still passing |
| `lib/ide-folders.js` etc. | untouched except requires if a path were wrong (should be untouched) |

**Do not ship if** explorer grouping changed, `ide-folders.json` shape changed, CSS/HTML folder rules changed, restore dispatch skipped auto-save differently, or a source-grep test was deleted to go green.

---

## Parallelism (if subagents)

| Track | New file | May edit `renderer.js`? |
|---|---|---|
| 0 scaffold | `state.js`, `dom.js` | **yes** (exclusive) |
| A confirm | `confirm-modal.js` | only after 0, exclusive |
| B find | `find-overlay.js` | exclusive splice |
| C git settings | `git-settings.js` | exclusive splice |
| D quick search | `quick-search.js` | exclusive splice |
| E layout | `layout.js` | exclusive splice |
| F explorer | `explorer.js` | exclusive splice |
| G tabs/history | `tabs.js`, `history.js` | exclusive splice |

Children that **only write the destination file** (copy-paste functions, add `require('./state')`) may run in parallel **after Track 0**, as long as they do not splice. Parent splices A→G in order.

---

## Cost

| Track | Effort | Nav return |
|---|---|---|
| 0 state/dom | 2–4 h | Enables every later extract |
| A confirm | 30 min | Pattern check |
| B find | 1 h | `renderer.js` loses overlay DOM soup |
| C git settings | 1 h | Settings not mixed with restore |
| D quick search | 1 h | Overlay isolated |
| E layout | 1 h | Resize/collapse isolated |
| F explorer | 2–4 h | Folder logic has a filename |
| G tabs + history | 4–8 h | Remaining god file becomes `history.js` |
| Wave 2 | 1 h | |

Skipped: `lib/` taxonomy, splitting `history.js` again, a real store. Add when this wave is merged and green.
