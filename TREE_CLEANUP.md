# Tree cleanup — folder regroup (no behavior change)

Worktree: `/Users/ilais/Projects/kedem/splunk-ide.navigation-overhaul`  
Branch: `navigation-overhaul`  
HEAD at plan write: `63c469f` (renderer split Wave 2). Rebase onto `master` again before starting if `master` moved.

Goal: make `lib/` and `test/` match the mental model (git / objects / explorer / ui / webview). **No behavior change.** No bundler. No `src/`. No `renderer/` nesting. No file splits. No export or function renames.

Cheap cuts: `NAVIGATION_OVERHAUL.md`. Renderer split: `RENDERER_SPLIT.md`. This file is the next execution plan.

---

## Atom protocol (mandatory)

Every regroup is one **atom**: one domain folder (or one root cleanup). The app must still start and the unit suite must still pass after each commit.

Do these five steps **in order**. Do not start the next atom until HEAD contains this one.

### 1. Analyze pre-move behavior

Write down (commit body, and Status here):

- What the moved modules export today (names only; do not restate bodies).
- Callers (`rg require.*<basename>`).
- What must **not** change (especially explorer `ideFolders` → `toExplorerInput` → `buildFileTree` → `renderExplorer`).

If you cannot list callers, you have not grepped enough. Do not move yet.

### 2. Document specific testing criteria

Before editing, list **runnable** checks with expected results.

Minimum per atom:

| Kind | Example |
|---|---|
| Syntax | `node --check` on every touched `.js` file |
| Grep | old `require('../lib/foo')` / `require('./foo')` paths are **gone**; new folder paths exist |
| Unit | named `node --test …` for every test file this atom moves or whose `require` it rewrites |
| Folder | `ide-folders` / `file-tree` / `render-explorer` if the atom can see explorer |
| Source-grep | the three restore tests if the atom changes their `require` or `__dirname` depth |
| Diff gate | see below — no logic hunks |
| Smoke | Wave 2 only. Do not require a green full smoke suite per atom |

Record Wave 0 (or previous atom HEAD) pass count. After the move, **new** unit failures are a regress. Known smoke drift (git tab, `#header` hidden, auto `searches`) is baseline, not a fix-it ticket.

### 3. Move

`git mv` then rewrite **path strings only**. No behavior change. No drive-by renames, CSS, HTML, or function edits.

### 4. Validate behavior remains

Re-run **exactly** the criteria from step 2. If a check fails, revert the atom; do not commit.

### 5. Commit the iteration

One commit per atom. Message: which folder appeared and why. Body: commands run + pass counts.

Do not commit a failing atom. Do not start the next folder on an uncommitted move.

---

## What “no behavior change” means

Allowed edits (and nothing else in `.js` / `.html` / `.css`):

- `git mv` of existing files into new directories
- `require('…')` string literals
- `fs.readFileSync` / `path.join` path segments that pointed at a moved file
- test `__dirname` depth (`'..'` → `'../..'`) when a test file gains a directory
- `package.json` `test:syntax` globs (paths only)

Forbidden (revert the atom if you do any of these):

- Change a function body, condition, default, or export name
- Add/remove `module.exports` keys
- Merge or split files
- Rename a basename (`query-versions.js` stays `query-versions.js`; `injector.js` stays `injector.js`)
- Dedupe slug helpers, open-helpers, or injectors
- Edit `index.html` markup or `styles.css`
- Nest `renderer/` or introduce `src/`
- “Fix” stale smoke, README-driven product changes, or `ide-folders.json` shape
- Rewrite comments except the path in a `require` example

### Diff gate (run before commit)

From the worktree, after staging:

```bash
cd /Users/ilais/Projects/kedem/splunk-ide.navigation-overhaul
git diff --cached -U0 -- '*.js' '*.mjs' '*.html' '*.css' \
  | grep -E '^[+-]' | grep -vE '^[+-]{3}' \
  | grep -vE 'require\(|readFileSync|__dirname|path\.join|test:syntax|PROJECT_ROOT' \
  || true
```

If that prints **any** line, you changed logic (or a comment). Unstage and fix. Markdown / `package.json` script lines are reviewed by eye, not this pipe.

`git mv` keeps history. Do not copy-delete.

---

## Protected: folder logic (do not break)

Live explorer path (do not rewrite, only **change the require path** to the new folder):

`ideFolders` → `toExplorerInput` → `buildFileTree` → `renderExplorer`

**Keep these files, symbols, and tests. Move, do not reimplement.**

| Today | After Atom E |
|---|---|
| `lib/ide-folders.js` | `lib/explorer/ide-folders.js` |
| `lib/file-tree.js` | `lib/explorer/file-tree.js` |
| `lib/render-explorer.js` | `lib/explorer/render-explorer.js` |
| `test/ide-folders.test.js` | `test/explorer/ide-folders.test.js` |
| `test/file-tree.test.js` | `test/explorer/file-tree.test.js` |
| `test/render-explorer.test.js` | `test/explorer/render-explorer.test.js` |

`updateExplorer` in `renderer/explorer.js` must still call all three in that order. Do not merge `ide-folders` into `file-tree`.

**Keep these DOM ids / CSS** (do not “clean up”):

`#new-file-btn`, `#new-item-menu`, `#new-search-choice`, `#new-folder-btn`, `#new-file-folder-row`, `#new-file-folder-select`, `.folder-root`, `details.folder`, `.folder-contents`, `.folder-actions`.

---

## Serial only

Cross-folder `require`s mean an intermediate tree is still valid only if **every caller** is updated in the same atom. Two writers will conflict on `renderer/history.js` and `renderer/explorer.js`.

**One exclusive owner.** Do not parallelize atoms that edit the same file.

`lib/main/` already exists — leave those three files where they are. Atom M only moves their tests.

---

## Target layout (stop here)

```
main.js                     # unchanged entry
renderer.js                 # require paths only
index.html                  # still <script src="./renderer.js">
styles.css
webview-preload.js          # require paths only
injectors/injector.js       # same bytes as today’s injector.js
injectors/injector-selection-cleanup.js
lib/url-utils.js            # stays at lib root (shared)
lib/main/                   # already nested; stay
lib/git/
lib/objects/
lib/explorer/
lib/ui/
lib/webview/
renderer/                   # unchanged layout and basenames
test/helpers/  fixtures/  harness/  smoke/   # stay
test/main/  git/  objects/  explorer/  ui/  webview/  renderer/
docs/                       # plans + ledgers (last atom)
```

Do **not** add barrel `index.js` files. Callers require the concrete file.

Keep **basenames**. Collision with `renderer/tabs.js` vs `lib/ui/tabs.js` is solved by the folder, not a rename. Optional rename pass is **out of scope** (see bottom).

---

## File map

### Stay put

| File | Reason |
|---|---|
| `main.js`, `renderer.js`, `index.html`, `styles.css`, `webview-preload.js` | Electron entry; preload path is load-bearing |
| `renderer/*.js` | Already named by UI surface |
| `lib/url-utils.js` | Shared by renderer, explorer, git, settings |
| `lib/main/*.js` | Already nested |
| `test/helpers/`, `test/fixtures/`, `test/harness/`, `test/smoke/` | Not domain code (harness `require`s of `lib/webview/*` update in Atom W) |
| `playwright.config.js`, `forge.config.js`, `package.json` (except `test:syntax` globs) | |
| `build/icon.ico` | Forge |

### `lib/git/` + `test/git/` (Atom G)

| From | To |
|---|---|
| `lib/git-settings.js` | `lib/git/git-settings.js` |
| `lib/git-sync.js` | `lib/git/git-sync.js` |
| `lib/query-versions.js` | `lib/git/query-versions.js` |
| `lib/stanza-drafts.js` | `lib/git/stanza-drafts.js` |
| `lib/conf-lock.js` | `lib/git/conf-lock.js` |
| `lib/reconcile.js` | `lib/git/reconcile.js` |
| `lib/diff-lines.js` | `lib/git/diff-lines.js` |
| `lib/plain-query-restore.js` | `lib/git/plain-query-restore.js` |
| `test/git-settings.test.js` | `test/git/git-settings.test.js` |
| `test/git-sync.test.js` | `test/git/git-sync.test.js` |
| `test/query-versions.test.js` | `test/git/query-versions.test.js` |
| `test/stanza-*.test.js` (all nine) | `test/git/stanza-*.test.js` |
| `test/reconcile.test.js` | `test/git/reconcile.test.js` |
| `test/diff-lines.test.js` | `test/git/diff-lines.test.js` |
| `test/plain-restore-autosave.behavior.test.js` | `test/git/plain-restore-autosave.behavior.test.js` |
| `test/native-object-trailers-tags.test.js` | `test/git/native-object-trailers-tags.test.js` |
| `test/saved-search-live-draft.test.js` | `test/git/saved-search-live-draft.test.js` |

Leave `test/plain-restore-dispatch.test.js` at `test/` until Atom R (it pins `renderer/history.js` **and** calls git helpers).

### `lib/objects/` + `test/objects/` (Atom O)

| From | To |
|---|---|
| `lib/conf-stanza.js` | `lib/objects/conf-stanza.js` |
| `lib/object-paths.js` | `lib/objects/object-paths.js` |
| `lib/saved-search-id.js` | `lib/objects/saved-search-id.js` |
| `lib/saved-search-open.js` | `lib/objects/saved-search-open.js` |
| `lib/dashboard-open.js` | `lib/objects/dashboard-open.js` |
| `lib/splunk-rest.js` | `lib/objects/splunk-rest.js` |
| `lib/splunk-comment.js` | `lib/objects/splunk-comment.js` |
| `lib/saved-search-preview.js` | `lib/objects/saved-search-preview.js` |
| `lib/saved-search-dirty.js` | `lib/objects/saved-search-dirty.js` |
| matching `test/*.test.js` | `test/objects/<same basename>` |

`test/dashboard-url-utils.test.js` stays next to `lib/url-utils.js` coverage — **do not merge** it into `url-utils.test.js` (could drop a case). Leave both at `test/` or, if you want them off the root, `test/url-utils.test.js` + `test/url-utils-dashboard.test.js` is a **rename** and is **out of scope**. Keep them at `test/`.

### `lib/explorer/` + `test/explorer/` (Atom E)

| From | To |
|---|---|
| `lib/ide-folders.js` | `lib/explorer/ide-folders.js` |
| `lib/file-tree.js` | `lib/explorer/file-tree.js` |
| `lib/render-explorer.js` | `lib/explorer/render-explorer.js` |
| `lib/project-files.js` | `lib/explorer/project-files.js` |
| `test/ide-folders.test.js` | `test/explorer/ide-folders.test.js` |
| `test/file-tree.test.js` | `test/explorer/file-tree.test.js` |
| `test/render-explorer.test.js` | `test/explorer/render-explorer.test.js` |
| `test/project-files.test.js` | `test/explorer/project-files.test.js` |
| `test/integration/project-files.integration.test.js` | `test/explorer/project-files.integration.test.js` |

Remove empty `test/integration/` after the move.

### `lib/ui/` + `test/ui/` (Atom U)

| From | To |
|---|---|
| `lib/tabs.js` | `lib/ui/tabs.js` |
| `lib/render-tabs.js` | `lib/ui/render-tabs.js` |
| `lib/quick-search.js` | `lib/ui/quick-search.js` |
| `lib/render-quick-search.js` | `lib/ui/render-quick-search.js` |
| `lib/query-history-ui.js` | `lib/ui/query-history-ui.js` |
| matching tests | `test/ui/<same basename>` |

### `lib/webview/` + `test/webview/` (Atom W)

| From | To |
|---|---|
| `lib/end-ace-selection-drag.js` | `lib/webview/end-ace-selection-drag.js` |
| `lib/selection-drag-tracker.js` | `lib/webview/selection-drag-tracker.js` |
| `lib/parent-selection-cleanup.js` | `lib/webview/parent-selection-cleanup.js` |
| `lib/webview-selection-drag-handlers.js` | `lib/webview/webview-selection-drag-handlers.js` |
| `lib/webview-splunk-save-hooks.js` | `lib/webview/webview-splunk-save-hooks.js` |
| `test/unit/*.test.js` (five files) | `test/webview/<same basename>` |

Remove empty `test/unit/` after the move.

### `injectors/` (Atom I)

| From | To |
|---|---|
| `injector.js` | `injectors/injector.js` |
| `injector-selection-cleanup.js` | `injectors/injector-selection-cleanup.js` |

Same bytes. Do **not** rename to `comment.js`.

### `test/main/` (Atom M)

| From | To |
|---|---|
| `test/main-app-shortcuts.test.js` | `test/main/app-shortcuts.test.js` |
| `test/main-context-menu.test.js` | `test/main/context-menu.test.js` |
| `test/main-find-in-page.test.js` | `test/main/find-in-page.test.js` |

This atom **may** drop the `main-` prefix because the folder already says `main`. That is the only basename change in the plan; test **bodies** stay identical except `require` depth.

### `test/renderer/` (Atom R)

| From | To |
|---|---|
| `test/plain-restore-dispatch.test.js` | `test/renderer/plain-restore-dispatch.test.js` |
| `test/saved-search-restore-tracked-base.test.js` | `test/renderer/saved-search-restore-tracked-base.test.js` |
| `test/saved-search-no-canonical-spl.test.js` | `test/renderer/saved-search-no-canonical-spl.test.js` |

They pin `renderer.js` / `renderer/history.js` source. After the move, `__dirname` parents become `../..`.

---

## Require rewrite rules

When `lib/foo.js` moves to `lib/<folder>/foo.js`:

1. **Inside the moved file:** `require('./bar')` stays `./bar` if `bar` moved to the **same** folder; becomes `../bar` if `bar` is still at `lib/` root (`url-utils`); becomes `../other/bar` if `bar` already lives in `other`.
2. **Every other file:** replace the old module path. Binding names stay (`const { saveVersion } = require('…')` — only the string changes).
3. **Tests one directory deeper:** `require('../lib/foo')` → `require('../../lib/<folder>/foo')`. `require('./helpers/…')` → `require('../helpers/…')`.
4. **Tests already two deep** (`test/unit`, `test/integration`, `test/harness`): `../../lib/foo` → `../../lib/<folder>/foo`. Helper depth unchanged.

Lazy/dynamic requires count (e.g. `query-versions.js` `require('./stanza-drafts')` at lines ~648, 779, 829, 879, 940; `reconcile.js` `require('./git-sync')`). Rewrite those strings too.

---

## Wave 0 — baseline (serial, once)

```bash
cd /Users/ilais/Projects/kedem/splunk-ide.navigation-overhaul
npm run test:unit
npm run test:syntax
node --test test/ide-folders.test.js test/file-tree.test.js test/render-explorer.test.js
node --test test/plain-restore-dispatch.test.js test/saved-search-restore-tracked-base.test.js test/saved-search-no-canonical-spl.test.js
npx playwright test --list
```

**Record** (2026-08-25, HEAD `3c70dbc`)

- Unit: **374 pass**, 0 fail, 133 suites (`npm run test:unit`, 24114ms).
- Syntax: exit 0 (`npm run test:syntax`).
- Folder tests: **21 pass** (`ide-folders` + `file-tree` + `render-explorer`).
- Source-grep tests: **5 pass** (three files: `plain-restore-dispatch`, `saved-search-restore-tracked-base`, `saved-search-no-canonical-spl`).
- Playwright `--list`: **17 tests in 5 files**, including `selection-drag`.
- Grep snapshot: `toExplorerInput` → `buildFileTree` → `renderExplorer` at `renderer/explorer.js` 566–568; `restorePlainQueryVersion({` at `renderer/history.js` 1964; `getSavedSearchPath` no hits in `renderer.js` / `renderer/history.js`; `ideFolders` present in `renderer/explorer.js`.
- `index.html`: only `src="./renderer.js"`.
- Invariant for every atom: **374 pass**, zero new failures.

Optional (do not “fix”): `npm run test:smoke`. Copy failing titles. Expect the same 8/9 split as Wave 2.

**Grep snapshot** (must remain true in spirit after every atom; only the **path** may change):

```bash
rg -n "toExplorerInput|buildFileTree|renderExplorer" renderer/explorer.js
rg -n "restorePlainQueryVersion\\(\\{" renderer/history.js
rg -n "getSavedSearchPath" renderer.js renderer/history.js   # expect: no hits
rg -n "ideFolders" renderer/explorer.js
```

`index.html` must still contain only `src="./renderer.js"` (no extra renderer scripts).

---

## Atom M — `test/main/` (no lib moves)

**Own:** the three `test/main-*.test.js` files only.

**Before**

```bash
node --test test/main-app-shortcuts.test.js test/main-context-menu.test.js test/main-find-in-page.test.js
```

**Change**

```bash
mkdir -p test/main
git mv test/main-app-shortcuts.test.js test/main/app-shortcuts.test.js
git mv test/main-context-menu.test.js test/main/context-menu.test.js
git mv test/main-find-in-page.test.js test/main/find-in-page.test.js
```

Rewrite `require('../lib/main/…')` → `require('../../lib/main/…')`.

**After**

```bash
node --test test/main/app-shortcuts.test.js test/main/context-menu.test.js test/main/find-in-page.test.js
npm run test:unit
```

**Done when:** 374 pass; `lib/main/` untouched.

**Status:**

---

## Atom G — `lib/git/`

**Own:** files in the git map above; plus **path-only** edits in callers that still live at `lib/` root or in `renderer/` / `main.js` / tests not yet moved.

**Do not** move `conf-stanza.js` yet. After this atom, git files require it as `../conf-stanza`.

### Internal requires after the mv (git folder)

| File | Old | New |
|---|---|---|
| `query-versions.js` | `./conf-stanza` | `../conf-stanza` |
| `query-versions.js` | `./conf-lock` | `./conf-lock` |
| `query-versions.js` | `./url-utils` | `../url-utils` |
| `query-versions.js` | `./stanza-drafts` (all, including lazy) | `./stanza-drafts` |
| `stanza-drafts.js` | `./conf-stanza` | `../conf-stanza` |
| `stanza-drafts.js` | `./conf-lock` | `./conf-lock` |
| `stanza-drafts.js` | `./query-versions` | `./query-versions` |
| `plain-query-restore.js` | `./query-versions` | `./query-versions` |
| `git-sync.js` | `./reconcile` | `./reconcile` |
| `git-sync.js` | `./stanza-drafts` | `./stanza-drafts` |
| `reconcile.js` | `./conf-stanza` | `../conf-stanza` |
| `reconcile.js` | `./query-versions` | `./query-versions` |
| `reconcile.js` | `./stanza-drafts` | `./stanza-drafts` |
| `reconcile.js` | `./splunk-rest` | `../splunk-rest` |
| `reconcile.js` | `./git-sync` (lazy) | `./git-sync` |

`git-settings.js` and `diff-lines.js` have no lib `require`s.

### Callers to update in this atom

| Caller | Old fragment | New |
|---|---|---|
| `main.js` | `./lib/git-settings` | `./lib/git/git-settings` |
| `renderer/history.js` | `../lib/stanza-drafts` | `../lib/git/stanza-drafts` |
| `renderer/history.js` | `../lib/git-sync` | `../lib/git/git-sync` |
| `renderer/history.js` | `../lib/query-versions` | `../lib/git/query-versions` |
| `renderer/history.js` | `../lib/plain-query-restore` | `../lib/git/plain-query-restore` |
| `renderer/history.js` | `../lib/diff-lines` | `../lib/git/diff-lines` |
| `renderer/explorer.js` | `../lib/query-versions` | `../lib/git/query-versions` |
| still-flat `lib/saved-search-open.js` | `./query-versions` `./git-sync` `./stanza-drafts` | `./git/query-versions` `./git/git-sync` `./git/stanza-drafts` |
| still-flat `lib/dashboard-open.js` | `./query-versions` `./git-sync` | `./git/query-versions` `./git/git-sync` |
| still-flat `lib/saved-search-preview.js` | `./query-versions` | `./git/query-versions` |
| tests moved to `test/git/` | `../lib/<name>` and `./helpers/` | `../../lib/git/<name>` and `../helpers/` |
| tests still at `test/` that import git modules (`plain-restore-dispatch`, `saved-search-open`, `dashboard-open`, `saved-search-no-canonical-spl` does **not** import git) | `../lib/query-versions` etc. | `../lib/git/query-versions` etc. |

**Before**

```bash
rg -n "require\\(['\"]\\./(git-settings|git-sync|query-versions|stanza-drafts|conf-lock|reconcile|diff-lines|plain-query-restore)['\"]" lib
node --test test/git-settings.test.js test/git-sync.test.js test/query-versions.test.js \
  test/stanza-drafts.test.js test/stanza-save-version.test.js test/reconcile.test.js \
  test/diff-lines.test.js test/plain-restore-autosave.behavior.test.js
```

**After**

```bash
rg -n "lib/(git-settings|git-sync|query-versions|stanza-drafts|conf-lock|reconcile|diff-lines|plain-query-restore)['\"]" \
  --glob '!TREE_CLEANUP.md' --glob '!*.md'
# expect: only lib/git/… and comments in docs
node --test test/git/*.test.js
node --test test/plain-restore-dispatch.test.js test/saved-search-open.test.js test/dashboard-open.test.js
npm run test:unit
```

**Done when:** 374 pass; diff gate clean; `function saveVersion` still in `lib/git/query-versions.js` (not rewritten).

**Status:**

---

## Atom O — `lib/objects/`

**Own:** objects map; path-only updates in `lib/git/*` (`../conf-stanza` → `../objects/conf-stanza`, `../splunk-rest` → `../objects/splunk-rest`) and renderer/tests.

### Internal requires after the mv (objects folder)

| File | Old (at this point) | New |
|---|---|---|
| `saved-search-id.js` | none | |
| `object-paths.js` | none | |
| `conf-stanza.js` | none | |
| `splunk-rest.js` | none | |
| `splunk-comment.js` | none | |
| `saved-search-dirty.js` | none | |
| `saved-search-open.js` | `./saved-search-id` `./object-paths` `./conf-stanza` `./splunk-rest` | `./…` (same folder) |
| `saved-search-open.js` | `./git/query-versions` `./git/git-sync` `./git/stanza-drafts` | `../git/…` |
| `dashboard-open.js` | `./object-paths` `./splunk-rest` | `./…` |
| `dashboard-open.js` | `./git/query-versions` `./git/git-sync` | `../git/…` |
| `saved-search-preview.js` | `./git/query-versions` | `../git/query-versions` |
| `ide-folders.js` (still at `lib/` until E) | `./saved-search-id` | `./objects/saved-search-id` |

### Git files to retarget in this atom

`query-versions.js`, `stanza-drafts.js`, `reconcile.js`: `../conf-stanza` → `../objects/conf-stanza`. `reconcile.js`: `../splunk-rest` → `../objects/splunk-rest`.

### Renderer / main callers

| Caller | New path |
|---|---|
| `renderer/history.js` | `../lib/objects/saved-search-id`, `object-paths`, `saved-search-open`, `dashboard-open`, `saved-search-preview`, `saved-search-dirty` |
| `renderer/explorer.js` | `../lib/objects/saved-search-id`, `object-paths` |

`query-history-ui` stays `../lib/query-history-ui` until Atom U.

**Before**

```bash
node --test test/conf-stanza.test.js test/object-paths.test.js test/saved-search-id.test.js \
  test/saved-search-open.test.js test/dashboard-open.test.js test/splunk-rest.test.js \
  test/splunk-comment.test.js test/saved-search-preview.test.js test/saved-search-dirty-on-run.test.js
```

**After**

```bash
rg -n "lib/(conf-stanza|object-paths|saved-search-|dashboard-open|splunk-rest|splunk-comment)['\"]" \
  --glob '!TREE_CLEANUP.md' --glob '!*.md'
# expect: lib/objects/… only
node --test test/objects/*.test.js
node --test test/git/*.test.js
node --test test/ide-folders.test.js
npm run test:unit
```

**Done when:** 374 pass; `getSavedSearchId` / `getSavedSearchConfPath` export names unchanged.

**Status:**

---

## Atom E — `lib/explorer/`

**Own:** explorer map; `renderer/explorer.js` and `renderer/history.js` require paths for folders/files/tree/render.

`ide-folders.js`: `./objects/saved-search-id` → `../objects/saved-search-id`.

`renderer/explorer.js` must still contain the call chain (grep):

```bash
rg -n "toExplorerInput|buildFileTree|renderExplorer" renderer/explorer.js
```

Expect all three in `updateExplorer` in the same order as HEAD.

**Tests one level down:** `./helpers/dom` → `../helpers/dom`. Integration file: `../../lib/project-files` → `../../lib/explorer/project-files`.

**Before**

```bash
node --test test/ide-folders.test.js test/file-tree.test.js test/render-explorer.test.js \
  test/project-files.test.js test/integration/project-files.integration.test.js
```

**After**

```bash
node --test test/explorer/*.test.js
npm run test:unit
rmdir test/integration   # only if empty
```

**Done when:** 374 pass; explorer grep snapshot holds; no edits inside `updateExplorer` except require lines at the top of the file.

**Status:**

---

## Atom W — `lib/webview/`

**Own:** webview map; `renderer.js`; `renderer/tabs.js` (lib requires only — **not** injector `readFileSync` yet); `webview-preload.js`; `test/harness/*`; `package.json` `test:syntax` entries for these four lib files.

Keep the `.js` suffix style `webview-preload.js` already uses (`./lib/webview/end-ace-selection-drag.js`).

`webview-selection-drag-handlers.js`: `./parent-selection-cleanup` stays `./parent-selection-cleanup`.

Harness (depth unchanged):

- `test/harness/index.html` → `../../lib/webview/webview-selection-drag-handlers` and `parent-selection-cleanup`
- `test/harness/splunk-save-main.js` and `splunk-save.html` → `../../lib/webview/webview-splunk-save-hooks`

`test/unit/*` → `test/webview/*` with `../../lib/<name>` → `../../lib/webview/<name>`.

Update `test:syntax` globs for the four former `lib/*.js` webview files to `lib/webview/*.js` (or list them). Prefer listing `lib/webview/*.js` if the shell glob works in npm scripts the same way `renderer/*.js` does.

**Before**

```bash
node --test test/unit/*.test.js
node --check webview-preload.js renderer.js renderer/tabs.js
```

**After**

```bash
node --test test/webview/*.test.js
node --check webview-preload.js renderer.js renderer/tabs.js lib/webview/*.js
npm run test:syntax
npm run test:unit
rmdir test/unit   # only if empty
```

**Done when:** 374 pass; `attachParentSelectionCleanup` still exported from `lib/webview/parent-selection-cleanup.js`; smoke **list** still includes `selection-drag` (do not require it green).

**Status:**

---

## Atom U — `lib/ui/`

**Own:** ui map; `renderer/tabs.js` (`../lib/ui/tabs`, `render-tabs`); `renderer/quick-search.js`; `renderer/history.js` (`query-history-ui`).

No cycles with explorer/webview if those atoms already landed.

**Before**

```bash
node --test test/tabs.test.js test/render-tabs.test.js test/quick-search.test.js \
  test/render-quick-search.test.js test/query-history-ui.test.js
```

**After**

```bash
node --test test/ui/*.test.js
npm run test:unit
```

**Done when:** 374 pass; `lib/tabs.js` gone; `lib/ui/tabs.js` present.

**Status:**

---

## Atom I — `injectors/`

**Own:** two injector files; `renderer/tabs.js` `readFileSync` paths only; `package.json` `test:syntax`.

`PROJECT_ROOT` stays `path.join(__dirname, '..')` (repo root). Change:

```javascript
path.join(PROJECT_ROOT, 'injector.js')
path.join(PROJECT_ROOT, 'injector-selection-cleanup.js')
```

to:

```javascript
path.join(PROJECT_ROOT, 'injectors', 'injector.js')
path.join(PROJECT_ROOT, 'injectors', 'injector-selection-cleanup.js')
```

Do not concatenate differently. Do not inline file contents.

**Before**

```bash
node --check injector.js injector-selection-cleanup.js renderer/tabs.js
rg -n "injector\\.js" renderer/tabs.js package.json
```

**After**

```bash
node --check injectors/injector.js injectors/injector-selection-cleanup.js renderer/tabs.js
rg -n "['\"]injector\\.js['\"]" --glob '!TREE_CLEANUP.md' --glob '!*.md'
# expect: no repo-root reads; injectors/injector.js in tabs.js
npm run test:syntax
npm run test:unit
```

**Done when:** injector file bytes identical (`git diff` shows rename + path strings only); 374 pass.

**Status:**

---

## Atom R — `test/renderer/`

**Own:** the three source-grep tests.

Path updates:

- `path.join(__dirname, '..', 'renderer/history.js')` → `path.join(__dirname, '../..', 'renderer/history.js')` (same for `renderer.js`)
- `require('../lib/…')` → `require('../../lib/…')` (objects/git folders as they exist after G/O)
- `require('./helpers/…')` → `require('../helpers/…')`

**After**

```bash
node --test test/renderer/*.test.js
npm run test:unit
```

**Done when:** all three pass; they still fail if you delete `restorePlainQueryVersion({` from `renderer/history.js` (do not actually delete it — that is the invariant).

**Status:**

---

## Atom D — docs and dead config

**Own:** markdown + unused Playwright config. **No** `.js` product files.

```bash
mkdir -p docs/archive
git mv NAVIGATION_OVERHAUL.md RENDERER_SPLIT.md TREE_CLEANUP.md docs/
git mv NATIVE_OBJECT_GIT_LEDGER.md SAVED_SEARCH_GIT_LEDGER.md docs/archive/
git rm playwright.config.mjs
```

Rewrite `README.md` to a short tree map (entrypoints, `lib/*` folders, `test/` mirrors). Do not describe unshipped features. Do not claim smoke is green.

**After:** `git grep playwright.config.mjs` empty; `npm run test:unit` still 374 (docs-only).

**Status:**

---

## Wave 2 — whole-tree check

After Atom D (or after I+R if you defer docs):

```bash
cd /Users/ilais/Projects/kedem/splunk-ide.navigation-overhaul

# syntax: every product module, one file per node --check
npm run test:syntax

# optional hardening of test:syntax (same atom as Wave 2 if you change package.json):
#   node --check main.js renderer.js webview-preload.js
#   for f in renderer/*.js injectors/*.js $(find lib -name '*.js' | sort); do
#     node --check "$f" || exit 1
#   done
# Only globs/paths. Do not skip files the old script checked.

npm run test:unit
node --test test/explorer/ide-folders.test.js test/explorer/file-tree.test.js test/explorer/render-explorer.test.js
node --test test/renderer/*.test.js
npx playwright test --list
```

**Expect**

| Check | Result |
|---|---|
| Unit | **374 pass**, zero new failures |
| Folder chain | grep still shows `toExplorerInput` → `buildFileTree` → `renderExplorer` in `renderer/explorer.js` |
| Source-grep | three `test/renderer/` tests pass |
| `index.html` | only `./renderer.js` |
| Playwright list | 17 tests, including `selection-drag` |
| Smoke | **same titles** as Wave 0 / renderer Wave 2 (8 pass / 9 fail). New failures = regress |

If you run full smoke, do not “fix” hidden `#header`, auto-load `searches`, missing git tab, or guest `editGuestQuery` here.

**Grep leftover old paths** (must be empty except `docs/`):

```bash
rg -n "require\\(['\"]\\.\\./lib/(query-versions|ide-folders|tabs|parent-selection-cleanup)['\"]" \
  --glob '!docs/**'
rg -n "path\\.join\\(PROJECT_ROOT, 'injector" renderer/
```

**Status:**

---

## Out of scope (do not sneak into an atom)

- Rename `query-versions.js` → `versions.js`, `object-paths.js` → `native-paths.js`, or drop duplicate basenames (`git-settings.js` vs `renderer/git-settings.js`)
- Split `lib/git/query-versions.js` or `renderer/history.js`
- Dedupe slug helpers / `saved-search-open` vs `dashboard-open`
- Generate injectors from `lib/objects/splunk-comment.js`
- Merge `test/dashboard-url-utils.test.js` into `url-utils.test.js`
- `src/main` + `src/renderer`, bundler, nested `renderer/ui/`
- Restore git Source Control panel / restyle CSS / rewrite folder explorer

Those are later plans. This plan is path strings and `git mv`.

---

## Do not ship if

- Explorer grouping or `ide-folders.json` shape changed
- `updateExplorer` lost `toExplorerInput` → `buildFileTree` → `renderExplorer`
- Restore dispatch in `renderer/history.js` changed (source-grep tests deleted or weakened instead of retargeted)
- Injector **contents** changed
- Unit count dropped for any reason other than a test file you accidentally deleted (then restore it)
- `index.html` loads more than `./renderer.js`

---

## Suggested commit subjects

- `Move main-process unit tests under test/main.`
- `Move git domain modules into lib/git.`
- `Move Splunk object modules into lib/objects.`
- `Move explorer modules into lib/explorer.`
- `Move webview guest helpers into lib/webview.`
- `Move tab and quick-search helpers into lib/ui.`
- `Move guest injectors into injectors/.`
- `Move renderer source-grep tests under test/renderer.`
- `Park overhaul docs and remove dead Playwright config.`
- `Check every lib module in test:syntax.` (Wave 2, only if `package.json` globs change)
