# Navigation overhaul — cheap cuts

Worktree: `/Users/ilais/Projects/kedem/splunk-ide.navigation-overhaul`  
Branch: `navigation-overhaul`  
HEAD: `7e072d2` (rebased onto `master`; includes folder explorer)

Goal: make the tree honest and `index.html` readable. No behavior change except deleting code the app never runs.

This file is the execution plan for **low-cost / high-return** cuts only. Do not split `renderer.js`. Do not regroup `lib/`.

---

## Protected: folder logic (do not delete)

Master commits `df02afe` and `7e072d2` wired the nested explorer. The live path is:

`ideFolders` → `toExplorerInput` → `buildFileTree` → `renderExplorer`

`updateExplorer` in `renderer.js` (~1982) **calls** all three. They are not leftovers.

**Keep these files. No track may delete, empty, or un-require them.**

| File | Role |
|---|---|
| `lib/ide-folders.js` | `ide-folders.json` CRUD, `toExplorerInput`, folder ids |
| `lib/file-tree.js` | `buildFileTree` — nested tree from file/folder lists |
| `lib/render-explorer.js` | DOM: files, `<details class="folder">`, drag/drop, Move/Delete |
| `test/ide-folders.test.js` | unit coverage for folder map |
| `test/file-tree.test.js` | unit coverage for tree shape |
| `test/render-explorer.test.js` | unit coverage for nested render + `hideRootLabel` |
| `renderer.js` requires and `updateExplorer` | wiring only; do not rewrite |

**Keep these `index.html` nodes and their CSS** (Track F: 1:1 move, no “unused CSS” cleanup):

- `#new-file-btn`, `#new-item-menu`, `#new-search-choice`, `#new-folder-btn`
- `#new-file-folder-row`, `#new-file-folder-select`
- `.folder-root`, `details.folder`, `details.folder>summary`, `::before` chevron, `.folder-contents`, `.folder-actions`

**Keep these renderer symbols:** `IDE_FOLDERS_FILE`, `explorerIdForFile`, `folderNames`, `folderForId`, `addIdeFolder`, `removeIdeFolder`, `setItemFolder`, `replaceItemId`, `pruneIdeFolders`, `toExplorerInput`, `readIdeFolders`, `writeIdeFolders`, `buildFileTree`, `renderExplorer`.

Track B from the pre-rebase plan is **cancelled**. It would have deleted the live explorer.

---

## Parallelism

Six tracks, **disjoint files**. Run them in one wave. None of them touch the protected folder files.

| Track | Files you may touch | Do not touch |
|---|---|---|
| A Dead git UI | `lib/git-view-model.js`, `test/git-view-model.test.js`, `test/integration/git.integration.test.js` | `lib/git-sync.js`, `lib/git-settings.js`, `lib/ide-folders.js`, renderer (`saveVersion` of `ide-folders.json`) |
| C Squirrel comments | `main.js` (comment block under line 1 only) | live `electron-squirrel-startup` gate, IPC, window create |
| D Deprecated alias | `lib/parent-selection-cleanup.js` | injectors, preload, selection-drag modules |
| E Dead package.json | `package.json` (`makers`, `build`, `test:e2e`, `test:ui`) | `forge.config.js`, dependencies |
| F CSS extract | `index.html` `<style>` → new `styles.css` | body markup, inline `style=""` attributes, `renderer.js`, any folder CSS/HTML |
| G Orphan e2e | `test/e2e/selection-drag.spec.mjs` → `test/smoke/selection-drag.spec.mjs` | `playwright.config.js` unless the move fails to list |

If using subagents: one writer per track, this worktree path, no overlapping files. Parent merges and runs **Wave 2**.

If serial: A → C → D → E → G → F. F last because it is the visual one.

---

## Out of scope (next plan, not this one)

- Split `renderer.js`. That is the real remaining navigation win; it is not cheap.
- Fold `lib/` into `git/` / `splunk/` / `ui/`.
- Inline `saved-search-preview.js` / `plain-query-restore.js` / `query-history-ui.js` / `saved-search-dirty.js` (they *are* used).
- Dedupe slug helpers or `saved-search-open` / `dashboard-open` git helpers.
- Restore the missing git Source Control panel (smoke still expects `.sidebar-tab[data-view="git"]`; that is a product bug, not this cleanup).
- Rewrite README / move git ledgers.
- “Simplify” folder explorer or merge `ide-folders` into `file-tree`.

---

## Wave 0 — baseline (serial, once)

Run from the worktree. Save the output. Later tracks may only add failures that they own.

```bash
cd /Users/ilais/Projects/kedem/splunk-ide.navigation-overhaul
npm run test:unit
npm run test:syntax
node --test test/ide-folders.test.js test/file-tree.test.js test/render-explorer.test.js
npx playwright test --list
npm run test:smoke
```

**Record**

- Unit pass count. Expect unit green, including the three folder tests above.
- Syntax exit 0.
- `--list` must **not** include `selection-drag`.
- Smoke: `#new-folder-btn` **is** in `index.html` now (inside `#new-item-menu`). Git Source Control tab / `#git-view` are still **absent**. Copy failing titles. Do not “fix” the git panel here.

**Grep snapshot** (folder lines must **remain** after every track):

```bash
rg -n "git-view-model|buildGitChangesFromStatus|formatCommitHistory" --glob '!NAVIGATION_OVERHAUL.md'
rg -n "buildFileTree|renderExplorer|toExplorerInput|ide-folders" renderer.js
rg -n "GUEST_DESELECT_JS"
rg -n "handleSquirrelEvent"
```

Expect `renderer.js` to keep `buildFileTree`, `renderExplorer`, and `toExplorerInput`.

---

## Track A — delete dead git status UI

`lib/git-view-model.js` formats stage/commit/reset rows. No app file requires it. Live git is `lib/git-sync.js` + settings. Folder membership is saved through `saveVersion(..., IDE_FOLDERS_FILE, ...)` — that is **not** this module.

**Before**

```bash
rg -n "git-view-model|buildGitChangesFromStatus|formatGitStatus|formatCommitHistory" --glob '!NAVIGATION_OVERHAUL.md'
node --test test/git-view-model.test.js test/integration/git.integration.test.js
node --test test/git-sync.test.js test/git-settings.test.js test/ide-folders.test.js
```

Expect: first grep hits **only** `lib/git-view-model.js` + those two test files. Git-sync and ide-folders tests pass.

**Change**

Delete:

- `lib/git-view-model.js`
- `test/git-view-model.test.js`
- `test/integration/git.integration.test.js`

Do not delete `test/helpers/temp-git-repo.js`, `test/integration/project-files.integration.test.js`, `lib/git-sync.js`, or `lib/ide-folders.js`.

**After**

```bash
rg -n "git-view-model|buildGitChangesFromStatus|formatGitStatus|formatCommitHistory" --glob '!NAVIGATION_OVERHAUL.md'
# expect: no hits
node --test test/git-sync.test.js test/git-settings.test.js test/ide-folders.test.js
npm run test:unit
```

**Done when**

- Grep is empty.
- `git-sync` / `git-settings` / `ide-folders` tests still pass.
- Full unit suite pass count is baseline minus the deleted files’ tests, **zero new failures**.
- `renderer.js` still `require`s `./lib/ide-folders` and still `saveVersion`s `IDE_FOLDERS_FILE`.

---

## Track C — delete commented Squirrel handler

`main.js` line 1 already exits on `electron-squirrel-startup`. Lines ~3–71 are a commented copy of the old handler.

**Before**

```bash
node --check main.js
node --test test/main-app-shortcuts.test.js test/main-context-menu.test.js test/main-find-in-page.test.js
```

Confirm line 1 stays: `if (require('electron-squirrel-startup')) return;`

**Change**

Delete the commented block through the blank lines before `const { app, BrowserWindow, ...`. Leave the live require and everything after it.

**After**

```bash
rg -n "handleSquirrelEvent|squirrel_app|--squirrel-install" main.js
# expect: no hits
node --check main.js
node --test test/main-app-shortcuts.test.js test/main-context-menu.test.js test/main-find-in-page.test.js
```

Smoke `app-launch` “launches, opens main window…” still passes.

**Done when**

- First executable lines are squirrel-startup gate, then real requires.
- Window still loads `index.html`.

---

## Track D — drop `GUEST_DESELECT_JS`

Deprecated alias of `GUEST_RECOVER_JS`. Exported, never imported. Tests use `GUEST_RECOVER_JS` only.

**Before**

```bash
rg -n "GUEST_DESELECT_JS"
node --test test/unit/parent-selection-cleanup.test.js test/unit/webview-selection-drag-handlers.test.js
```

Expect: hits only in `lib/parent-selection-cleanup.js` (define + export).

**Change**

Remove the `@deprecated` comment, `GUEST_DESELECT_JS` const, and its `module.exports` entry. Keep `GUEST_RECOVER_JS` and `GUEST_CLEAR_SELECTION_JS`.

**After**

```bash
rg -n "GUEST_DESELECT_JS"
# expect: no hits
node --test test/unit/parent-selection-cleanup.test.js test/unit/webview-selection-drag-handlers.test.js test/unit/selection-drag-tracker.test.js test/unit/end-ace-selection-drag.test.js
```

**Done when**

- Alias gone; recovery string unchanged (`__splunkIdeDragInProgress` / `__splunkIdeRecoverFromMissedDrag` still in `GUEST_RECOVER_JS`).
- Parent-cleanup tests still assert `GUEST_RECOVER_JS` on mouseup.

---

## Track E — dead Forge / script duplicates

- `package.json` `"makers"` duplicates `forge.config.js` (Forge 7 reads the config file).
- `"build": { "win": … }` is electron-builder. This app uses Forge. Icon path stays in `forge.config.js` / `build/icon.ico`.
- `"test:e2e"` is the same command as `"test:smoke"`. `"test:ui"` calls `test:e2e`. Playwright `testDir` is `./test/smoke`.

**Before**

```bash
node -e "require('./forge.config.js'); console.log('forge ok', require('./forge.config.js').makers.map(m => m.name))"
npm run test:syntax
```

Note `forge.config.js` still lists squirrel / zip / deb / rpm.

**Change** in `package.json` only:

- Delete `"makers"` and `"build"`.
- Delete script `"test:e2e"`.
- Set `"test:ui"` to `npm run test:unit && npm run test:smoke`.

Do not remove `@electron-forge/maker-*` deps. Do not edit `forge.config.js`.

**After**

```bash
node -e "const p=require('./package.json'); if (p.makers || p.build) process.exit(1); if (!p.scripts['test:smoke'] || p.scripts['test:e2e']) process.exit(1); if (p.scripts.test !== 'npm run test:unit') process.exit(1);"
node -e "require('./forge.config.js')"
npm run test:syntax
```

**Done when**

- `npm run test:e2e` fails (script gone).
- `npm run test:smoke` still invokes Playwright.
- Forge makers unchanged in `forge.config.js`.
- `build/icon.ico` still on disk.

---

## Track F — extract CSS from `index.html`

One `<style>` block plus markup in `index.html`. Extract CSS only.

**Before**

```bash
rg -c "<style>|</style>" index.html
rg -n "new-folder-btn|new-item-menu|details.folder|folder-actions|new-file-folder-select" index.html
node --test test/ide-folders.test.js test/file-tree.test.js test/render-explorer.test.js
npx playwright test test/smoke/app-launch.spec.js test/smoke/project-flow.spec.js
```

Confirm HTML still has `#new-folder-btn` and the folder CSS rules listed in **Protected**. Save smoke failures (git tab). Screenshot optional: explorer with a folder open, chevron + name left-aligned (`7e072d2`), new-item menu, new-file modal folder select.

**Change**

1. Cut the `<style>…</style>` inner CSS into new `styles.css` at repo root (same directory as `index.html`). Keep `/* Dark theme IDE styling */`.
2. In `<head>`, replace the style block with `<link rel="stylesheet" href="styles.css">`.
3. Leave **all** HTML, including `#new-item-menu` / `#new-folder-btn` / folder modal row and inline `style="padding: …"` on buttons.
4. **1:1 move.** Do not drop `details.folder` chevron rules, `#new-folder-btn`, `.folder-actions`, or anything that looks unused.

`main.js` `loadFile('index.html')` resolves `styles.css` next to the HTML. No Forge extraResource needed (`asar: true` packs it).

**After**

```bash
rg "<style>" index.html
# expect: no hits
test -f styles.css
rg -n "new-folder-btn|new-item-menu|details.folder|folder-actions|new-file-folder-select" index.html styles.css
wc -l index.html styles.css
node --test test/ide-folders.test.js test/file-tree.test.js test/render-explorer.test.js
npx playwright test test/smoke/app-launch.spec.js
npx playwright test test/smoke/project-flow.spec.js
```

Must still exist after the split:

| Where | What |
|---|---|
| `index.html` | `#new-folder-btn`, `#new-item-menu`, `#new-file-folder-select` |
| `styles.css` | `details.folder`, `summary::before`, `.folder-contents`, `.folder-actions`, `#new-folder-btn` |

App launch must still pass: title, `#app-shell`, `#sidebar`, `#main-area`, `#explorer`, `#new-folder-btn` attached/disabled.

Project-flow must not get worse:

- create project → `#new-file-btn` enabled; open + menu → `#new-folder-btn` enabled
- create file via New Search → `.explorer-item .file-name` visible
- double-shift → `#quick-search-overlay.visible`

Git-tab failures may match Wave 0. New failure “folder has no chevron / name wraps under chevron / menu unstyled” is a **regress**.

Manual: create a folder, drop a search into it, collapse/expand (`details[open]`), confirm name sits beside the chevron.

**Done when**

- No `<style>` in `index.html`.
- `styles.css` is the old block unmodified (diff is location only).
- Folder HTML + CSS both still present.
- Folder unit tests unchanged-pass.
- Launch + file-create + folder-button + quick-search still pass.

---

## Track G — run the orphan selection-drag e2e

`test/e2e/selection-drag.spec.mjs` is a real Playwright harness (`test/harness/main.js`). `playwright.config.js` `testDir` is `./test/smoke`, so `npm run test:smoke` never runs it.

Cheap path: **move**, do not rewrite, do not expand `testDir`.

**Before**

```bash
npx playwright test --list
# selection-drag must be absent
ls test/e2e/selection-drag.spec.mjs
node --test test/unit/parent-selection-cleanup.test.js test/unit/end-ace-selection-drag.test.js
```

**Change**

```bash
git mv test/e2e/selection-drag.spec.mjs test/smoke/selection-drag.spec.mjs
rmdir test/e2e 2>/dev/null || true
```

`__dirname` + `'../..'` is still repo root from `test/smoke/`. Do not edit the spec unless `--list` shows it and it fails on path.

**After**

```bash
npx playwright test --list
# must include selection-drag
npx playwright test test/smoke/selection-drag.spec.mjs
node --test test/unit/parent-selection-cleanup.test.js test/unit/webview-selection-drag-handlers.test.js
```

**Done when**

- `test/e2e/` gone.
- `--list` includes the spec.
- Spec passes (whatever the file already asserts).
- If it **fails**, stop. Do not delete the spec to go green.

---

## Wave 2 — integrate (serial, after all tracks)

```bash
cd /Users/ilais/Projects/kedem/splunk-ide.navigation-overhaul
git status --short
npm run test:syntax
npm run test:unit
node --test test/ide-folders.test.js test/file-tree.test.js test/render-explorer.test.js
npx playwright test --list
npm run test:smoke
```

**Pass bar**

| Check | Expect |
|---|---|
| syntax | exit 0 |
| unit | green; count = Wave 0 minus **only** git-view-model + git.integration tests |
| folder tests | `ide-folders`, `file-tree`, `render-explorer` still present and passing |
| `--list` | includes `selection-drag`; no `test/e2e` |
| smoke | Wave 0 failures only (git panel), **plus** selection-drag passing |
| `renderer.js` | still requires `file-tree`, `render-explorer`, `ide-folders`; `updateExplorer` still calls `toExplorerInput` → `buildFileTree` → `renderExplorer` |
| `index.html` | `<link rel="stylesheet" href="styles.css">`, no `<style>`, folder markup intact |
| `styles.css` | folder/chevron/`#new-folder-btn` rules present |
| `package.json` | no `makers`, no `build`, no `test:e2e` |
| `main.js` | no commented Squirrel body |
| grep | no `git-view-model`, `GUEST_DESELECT_JS`, `handleSquirrelEvent` |

**Do not ship if** folder modules were deleted, CSS rules were “cleaned”, Forge makers disappeared from `forge.config.js`, or selection-drag was deleted because it failed.

---

## Cost

| Track | Effort | Nav return |
|---|---|---|
| A | 15 min | One less fake git UI |
| C | 5 min | `main.js` starts at real code |
| D | 5 min | Less alias noise |
| E | 10 min | Scripts match what Playwright runs |
| F | 20–40 min | `index.html` becomes markup |
| G | 20 min | Hidden regression actually runs |
| Wave 2 | 20 min | |

**Cancelled:** Track B (delete explorer stack). Add renderer split after this wave is merged and green.
