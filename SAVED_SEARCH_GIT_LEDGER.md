# Saved Search Git History Ledger

This file is the handoff contract for loop-based implementation. A subagent
should be able to open this file, take the first `Open` loop, implement only
that loop, run its check, update the status row, and commit.

## Non-negotiables

- Worktree: `/Users/ilais/Projects/kedem/splunk-ide-git-overhaul`
- Branch: `git-overhaul`
- Current base commit: `ff0cbc7 Support off-head query versions and draft stashes`
- Do **not** create real git branches per saved search unless this ledger is explicitly changed first.
- Do **not** force-push.
- Do **not** push draft stashes.
- Do **not** add dependencies for slugging, hashing, config files, or git commands. Use Node stdlib + `simple-git`.
- Existing local `.spl` query-file history must keep working.

## Target design in one paragraph

All users share saved-search history through one git repository and one shared
branch. Each Splunk saved search maps to one canonical `.spl` file path. Normal
history is normal git history for that file. Nonlinear/off-HEAD versions are
shared through `refs/splunk-ide/versions/*`. Drafts are private and stay in
`refs/splunk-ide/stashes/*`.

## Ref policy

Shared remotely:

```txt
refs/heads/*
refs/tags/search-tag/*
refs/splunk-ide/versions/*
```

Local-only:

```txt
refs/splunk-ide/stashes/*
```

Fetch refspecs:

```txt
+refs/heads/*:refs/remotes/<remote>/*
+refs/tags/search-tag/*:refs/tags/search-tag/*
+refs/splunk-ide/versions/*:refs/splunk-ide/versions/*
```

Push refspecs:

```txt
HEAD:refs/heads/<sharedBranch>
refs/tags/search-tag/*:refs/tags/search-tag/*
refs/splunk-ide/versions/*:refs/splunk-ide/versions/*
```

No push command should mention `refs/splunk-ide/stashes/*`.

## Canonical saved-search path

Input metadata:

```js
{
  instance: 'prod',       // Splunk instance identifier, not URL text if avoidable
  app: 'search',
  owner: 'nobody',
  name: 'Error Rate'
}
```

Canonical ID source string:

```txt
<instance>|<app>|<owner>|<name>
```

Path shape:

```txt
saved-searches/<instance>/<app>/<owner>/<name-slug>-<sha12>.spl
```

Example:

```txt
saved-searches/prod/search/nobody/error-rate-a1b2c3d4e5f6.spl
```

Rules:

- Slug each path segment separately.
- Hash the canonical ID, not the query text.
- Use safe fallback segments for missing fields, e.g. `unknown-instance`, `unknown-app`, `unknown-owner`, `untitled-search`.
- No sidecar registry for now. The path is the registry.

## Commit message/trailer policy

Existing trailers stay valid:

```txt
Query-Parent: <hash>
Query-Autosave: true
```

Saved-search commits may add:

```txt
Splunk-Instance: prod
Splunk-App: search
Splunk-Owner: nobody
Saved-Search: Error Rate
Saved-Search-Id: a1b2c3d4e5f6...
```

Rules:

- These trailers are optional. Local query files must not require them.
- Normal commits and `commit-tree` off-HEAD commits must generate trailers the same way.
- Old commits without these trailers must still list and restore correctly.

## Author policy

Use real git authors for shared commits.

Resolution order:

1. Existing repo-local `user.name` + `user.email`.
2. App settings `gitUserName` + `gitUserEmail`.
3. Test/local fallback: `Splunk IDE <splunk-ide@local>`.

Important: off-HEAD commits use `git commit-tree`, so they need env too:

```js
{
  GIT_AUTHOR_NAME: name,
  GIT_AUTHOR_EMAIL: email,
  GIT_COMMITTER_NAME: name,
  GIT_COMMITTER_EMAIL: email
}
```

Do not write global git config.

## Saved-search open flow

Expected technical flow:

```txt
saved-search metadata
  -> canonical path
  -> ensure repo
  -> apply author config if repo lacks author
  -> ensure remote if configured
  -> fetch if configured
  -> if canonical file exists in worktree: load it
  -> else if file exists in git: restore it
  -> else: write current Splunk content and commit "Import saved search"
  -> listVersions(git, canonicalPath)
  -> render history
```

Fetch failure should show sync status but still allow local work.

## Saved-search save flow

Expected technical flow:

```txt
write current content to canonical file
  -> fetch if remote configured
  -> saveVersion(git, canonicalPath, message, parentHash?, options)
  -> push shared branch + shared refs if remote configured
  -> if push fails: keep local commit/ref and show status
  -> refresh local history
```

No save path may discard dirty local content or draft stashes.

## Conflict/status model

Minimum statuses:

```txt
Up to date
Unsaved draft
Remote changed
Local version not pushed
Push failed
```

Keep sync status separate from file dirty state. A push failure is not the same
thing as editor changes.

## Ledger table

| ID | Status | Commit goal | Primary files | Required check |
| --- | --- | --- | --- | --- |
| 0 | Done | Land off-HEAD versions and draft stashes | `lib/query-versions.js`, `renderer.js`, `test/query-versions.test.js` | `npm test -- test/query-versions.test.js` |
| 1 | Done | Canonical saved-search identity/path helper | `lib/saved-search-id.js`, `test/saved-search-id.test.js` | `npm test -- test/saved-search-id.test.js` |
| 2 | Done | Saved-search commit trailers | `lib/query-versions.js`, `test/query-versions.test.js` | `npm test -- test/query-versions.test.js` |
| 3 | Done | Explicit git author support for normal and off-HEAD commits | `lib/query-versions.js`, `test/query-versions.test.js` | targeted author tests |
| 4 | Done | Remote sync helper with exact refspec policy | `lib/git-sync.js`, `test/git-sync.test.js` | bare remote tests |
| 5 | Done | Two-clone sharing proof | `test/git-sync.test.js` or integration test | repo A push, repo B fetch/list |
| 6 | Done | Saved-search open/import service | small new lib, tests | unit test for import/open logic |
| 7 | Done | Renderer uses canonical saved-search paths | `renderer.js` | manual smoke + syntax/unit check |
| 8 | Done | Persist git remote/author settings | `main.js`, small settings helper/tests | settings read/write check |
| 9 | Done | Settings UI | `index.html`, `renderer.js` | syntax/unit smoke |
| 10 | Done | Fetch on saved-search open | `renderer.js`, `lib/git-sync.js` | manual smoke |
| 11 | Done | Push on saved-search save | `renderer.js`, `lib/git-sync.js` | bare remote/manual smoke |
| 12 | Done | Conflict and sync status display | `renderer.js` | manual smoke |
| 13 | Open | Full two-instance validation | app workflow | checklist at bottom |

---

# Loop specs

## Loop 1 — canonical saved-search identity/path helper

Build a small pure module. No git, no renderer.

Suggested exports:

```js
getSavedSearchId({ instance, app, owner, name })
getSavedSearchPath({ instance, app, owner, name })
```

Implementation notes:

- Use `node:crypto` SHA-256; use first 12 hex chars in filename.
- Normalize values with `String(value || fallback).trim()`.
- Slug unsafe chars to `-`, collapse duplicate `-`, trim leading/trailing dots/dashes/spaces.
- Keep readable case behavior simple and tested. Lowercase is fine.

Tests must cover:

- stable path for same metadata
- different hash for same slug but different canonical metadata
- unsafe chars in instance/app/owner/name
- missing fields use stable fallback segments

After loop:

- Mark row 1 `Done`.
- Commit message: `Add saved search identity helper`.

**Done (2026-07-09):** Added `getSavedSearchId` / `getSavedSearchPath` with SHA-256 path suffix, per-segment slugging, and fallback segments. Six unit tests pass.

## Loop 2 — saved-search commit trailers

Extend `saveVersion()` options to accept saved-search metadata. Keep old callers working.

Suggested option shape:

```js
await saveVersion(git, path, message, parentHash, {
  savedSearch: { instance, app, owner, name, id }
})
```

Technical requirements:

- Centralize trailer building so normal commit and off-HEAD commit paths match.
- Preserve existing `Query-Parent` and `Query-Autosave` behavior.
- Do not require `savedSearch` for local query files.
- If `id` is not passed, caller should pass one later from Loop 1; do not recompute here unless this loop deliberately imports the helper.

Tests must cover:

- normal saved-search commit has trailers
- off-HEAD saved-search commit has trailers
- normal query save without metadata is unchanged enough to pass existing tests

After loop:

- Mark row 2 `Done`.
- Commit message: `Add saved search commit trailers`.

**Done (2026-07-09):** Added `buildCommitMessage()` for shared trailer assembly; `saveVersion()` accepts optional `savedSearch` metadata for Splunk trailers on normal and off-HEAD commits. Two new tests pass; existing query-file tests unchanged.

## Loop 3 — explicit git author support

Make normal and off-HEAD commits use the same resolved author.

Suggested option shape:

```js
await ensureRepo(git, { author: { name, email } })
await saveVersion(git, path, message, parentHash, { author: { name, email } })
```

Technical requirements:

- Do not overwrite existing repo-local author config.
- New repo can receive app-provided author config.
- `commitFileOnParent()` must accept extra env or author info for `commit-tree`.
- Normal `git commit` path can rely on repo config, but tests must prove it.

Tests must cover:

- new repo normal commit author
- new repo off-HEAD commit author
- existing repo author is not overwritten by passed fallback author

After loop:

- Mark row 3 `Done`.
- Commit message: `Respect configured git authors`.

**Done (2026-07-09):** Added `resolveAuthor()` with repo-local config precedence; `ensureRepo()` and off-HEAD `commitFileOnParent()` apply app-provided or default author without overwriting existing repo config. Three author tests pass.

## Loop 4 — remote sync helper

Build git sync as a separate module. Renderer should not know raw refspecs.

Suggested exports:

```js
ensureRemote(git, { remoteName = 'origin', remoteUrl })
fetchSharedHistory(git, { remoteName = 'origin' })
pushSharedHistory(git, { remoteName = 'origin', sharedBranch })
```

Suggested result style:

```js
{ ok: true }
{ ok: false, message: '...' }
```

Technical requirements:

- `ensureRemote()` adds or updates the named remote idempotently.
- Fetch uses the exact fetch refspec policy above.
- Push uses the exact push refspec policy above.
- Do not include stash refs in push.
- Return failures instead of throwing for expected remote errors if that keeps renderer simpler; tests can accept either only if callers can inspect failure.

Tests must cover:

- remote add/update/idempotence
- push/fetch normal branch
- push/fetch search tags
- push/fetch `refs/splunk-ide/versions/*`
- no `refs/splunk-ide/stashes/*` appears in remote after push

After loop:

- Mark row 4 `Done`.
- Commit message: `Add git sync helpers`.

**Done (2026-07-09):** Added `ensureRemote`, `fetchSharedHistory`, and `pushSharedHistory` with exact saved-search refspec policy; failures return `{ ok: false, message }`. Seven bare-remote tests pass.

## Loop 5 — two-clone sharing proof

Add a test proving the core product requirement without renderer.

Scenario:

```txt
bare remote
repo A
repo B
repo A writes canonical saved-search file
repo A saveVersion(...)
repo A pushSharedHistory(...)
repo B fetchSharedHistory(...)
repo B listVersions(canonicalPath)
```

Expected result:

- repo B sees repo A commit in history for the same canonical path.
- if adding an off-HEAD version is easy, repo B sees that version ref too.
- repo B does not receive repo A stash refs.

After loop:

- Mark row 5 `Done`.
- Commit message: `Prove shared saved search history sync`.

**Done (2026-07-09):** Added two-clone integration test: repo A saves canonical saved-search path (head + off-HEAD), pushes; repo B fetches, checks out shared branch, and `listVersions` sees both commits; stash refs stay local-only.

## Loop 6 — saved-search open/import service

Extract open/import behavior into a small testable helper before touching the renderer heavily.

Suggested export:

```js
openSavedSearchHistory({
  git,
  workspaceRoot,
  metadata,
  currentUrl,
  remoteSettings,
  author
})
```

Suggested return:

```js
{
  relativePath,
  imported: true,
  fetched: true,
  warning: ''
}
```

Technical requirements:

- Derive canonical path with Loop 1 helper.
- Ensure containing directory exists before writing.
- First open writes `currentUrl` and commits `Import saved search` with trailers.
- Reopen must not create another import commit.
- Existing canonical file wins over current Splunk content.
- Fetch warning does not block local open.

After loop:

- Mark row 6 `Done`.
- Commit message: `Add saved search open service`.

**Done (2026-07-09):** Added `openSavedSearchHistory` in `lib/saved-search-open.js` — canonical path, ensureRepo/fetch/checkout, worktree-wins import, git restore, first-open commit with trailers; fetch failure returns warning without blocking local open. Six unit tests pass.

## Loop 7 — renderer canonical path wiring

Wire saved searches to use the canonical path. Keep local file behavior unchanged.

Technical requirements:

- Find where active file/search records are created.
- Add saved-search metadata to the record when available.
- Make `getRelativePath(file)` return canonical saved-search path for saved searches.
- Ensure history calls use that path.
- Avoid broad renderer refactor.

Manual smoke:

- Open normal local search: history still works.
- Open saved search: history path is under `saved-searches/`.

After loop:

- Mark row 7 `Done`.
- Commit message: `Use canonical paths for saved searches`.

**Done (2026-07-09):** Added `parseSavedSearchFromUrl` in `url-utils.js`; renderer attaches `file.savedSearch` from Splunk URLs, writes/moves files to canonical paths, and `getRelativePath()` returns `getSavedSearchPath()` when metadata is set. History calls unchanged (already use `getRelativePath`). Three url-utils tests pass; syntax check clean.

## Loop 8 — settings persistence

Persist remote and author settings in Electron userData, not the git repo.

Settings shape:

```js
{
  remoteUrl: '',
  remoteName: 'origin',
  sharedBranch: 'main',
  gitUserName: '',
  gitUserEmail: ''
}
```

Technical requirements:

- Add IPC handlers in `main.js` if renderer needs them.
- Store JSON under `app.getPath('userData')`.
- Blank `remoteUrl` means local-only.
- Do not store credentials.
- Existing users with no file get defaults.

After loop:

- Mark row 8 `Done`.
- Commit message: `Persist git sync settings`.

**Done (2026-07-09):** Added `lib/git-settings.js` with defaults, normalize, and userData JSON read/write; IPC handlers `get-git-sync-settings` / `set-git-sync-settings` in `main.js`. Eight unit tests pass.

## Loop 9 — settings UI

Add the smallest UI for settings.

Fields:

```txt
Remote repository URL
Remote name
Shared branch
Git author name
Git author email
```

Technical requirements:

- Load settings on startup.
- Save explicitly.
- Show simple error/status on save failure.
- Do not implement credential management.

After loop:

- Mark row 9 `Done`.
- Commit message: `Add git sync settings UI`.

**Done (2026-07-09):** Added gear-button settings modal with remote URL/name, shared branch, and git author fields; loads on startup via IPC, explicit save with error/success status; `gitSyncSettings` kept in renderer state for later loops.

## Loop 10 — fetch on saved-search open

Use Loop 4 helper during saved-search open.

Technical requirements:

- Only fetch when `remoteUrl` is configured.
- Fetch once on saved-search open/entry, not every history refresh.
- Preserve dirty drafts before/after fetch.
- Fetch failure becomes sync status, not a broken open.

Manual smoke:

- User B sees User A's pushed saved-search history after opening same saved search.
- Disconnect remote; saved search still opens locally with warning.

After loop:

- Mark row 10 `Done`.
- Commit message: `Fetch saved search history on open`.

**Done (2026-07-09):** Wired `openSavedSearchHistory` into renderer via `enterSavedSearchHistory` on tab switch and saved-search URL apply; fetches once per saved-search id when `remoteUrl` is set, stashes/restores dirty drafts around fetch, surfaces warning in `file.savedSearchSyncStatus` / status bar.

## Loop 11 — push on saved-search save

Use Loop 4 helper after successful local save.

Technical requirements:

- Save locally first.
- Push only when `remoteUrl` is configured.
- Push shared branch, search tags, and IDE version refs.
- Keep local commit/ref on push reject.
- Refresh local history after push attempt.

Manual smoke:

- User A saves; User B fetches and sees version.
- Simulated push rejection leaves User A version visible locally.
- Remote does not contain stash refs.

After loop:

- Mark row 11 `Done`.
- Commit message: `Push saved search history on save`.

**Done (2026-07-09):** After local `saveVersion`, saved searches push via `pushSharedHistory` when `remoteUrl` is set; trailers and author passed on save; push failure surfaces in `file.savedSearchSyncStatus` while local commit is kept; history refreshes after push attempt.

## Loop 12 — conflict and sync status display

Add minimal safe conflict visibility. No merge UI yet.

Technical requirements:

- Track sync status separately from dirty status.
- Set `Remote changed` when fetch sees remote advance while local draft exists.
- Set `Local version not pushed` or `Push failed` after push rejection.
- Do not reset, checkout, or overwrite local files to resolve automatically.

After loop:

- Mark row 12 `Done`.
- Commit message: `Show saved search sync status`.

**Done (2026-07-09):** Added `SAVED_SEARCH_SYNC_STATUS` labels, remote-changed detection on fetch when a local draft exists, push-rejection classification (`Local version not pushed` vs `Push failed`), and `formatQueryHistoryStatus` for saved-search history/status display separate from dirty state.

## Loop 13 — full two-instance validation

Manual checklist:

- Instance A and B have different git authors.
- A opens a saved search and imports it.
- A saves and pushes.
- B opens the same saved search and sees A history + author.
- B saves and pushes.
- A fetches/reopens and sees B history + author.
- A restores old version, edits draft, switches away/back, and draft is preserved locally.
- Remote has branch, search tags/version refs if created, and no stash refs.

After loop:

- Mark row 13 `Done`.
- Commit message: `Validate shared saved search history workflow` if any docs/test changes are committed.

## Per-loop done definition

Before handing back:

1. Only the current loop's objective is implemented.
2. Required check passes.
3. Ledger row status is updated.
4. A focused commit is created.
5. Handoff says: commit hash, check run, files changed, and any skipped follow-up.
