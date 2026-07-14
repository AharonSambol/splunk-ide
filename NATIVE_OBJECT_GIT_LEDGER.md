# Native Object Git History Ledger

This file is the handoff contract for loop-based implementation. A subagent
should be able to open this file, take the first `Open` loop, implement only
that loop, run its check, update the status row, and commit.

Supersedes the `.spl` canonical-path model in `SAVED_SEARCH_GIT_LEDGER.md` for
new work. That ledger remains history for completed loops 0–13.

## Non-negotiables

- Worktree: `/Users/ilais/Projects/kedem/splunk-ide-git-overhaul`
- Branch: `git-overhaul`
- Current base commit: `70d922e Tag Splunk UI saves and add native object versioning ledger.`
- Do **not** create real git branches per saved search / dashboard.
- Do **not** force-push.
- Do **not** push draft stashes.
- Do **not** add dependencies for conf parsing, slugging, hashing, or git.
  Use Node stdlib + `simple-git`.
- Do **not** keep `.spl` URL files as the source of truth for saved searches.
  No dual-write / backwards-compat requirement for the old path model.
- Shared history coexists with a server-side midnight **watchdog** that commits
  the same Splunk-like tree on the same shared branch.
- Splunk live state wins on divergence: reconcile via REST re-export, not
  three-way conf merge.

## Target design in one paragraph

All users (and the watchdog) share one git repository and one shared branch
whose tree mirrors Splunk on-disk layout (`apps/<app>/local/savedsearches.conf`,
`data/ui/views/*`). The IDE mirrors objects over Splunk REST into those paths.
Saved-search UX is **stanza-scoped** over a shared conf file: durable local
draft refs hold one stanza each; save commits `upsert(HEAD, that stanza only)`;
history/diff/restore filter to the open search’s exact name. Dashboards stay
file-scoped (one view file = one object). Multi-tab independent commit / reset /
stash is required and persistent across restarts.

## Confirmed decisions

| Decision | Choice |
| --- | --- |
| Source | REST mirror into project git (not `$SPLUNK_HOME`) |
| Layout | Splunk-like: `apps/<app>/local/…` (+ optional `users/…`) |
| Unit | Whole `savedsearches.conf` on disk; **stanza** as UX/history grain |
| Draft model | Model A — stanza overlays + local stash refs (no per-search branches) |
| Writers | IDE (realtime) + watchdog (midnight) on same shared branch |
| Conflict | REST re-export from Splunk; no hand-merge of conf |
| `.spl` compat | Drop for this design |

Consult verdicts (composer / terra / luna): Model A YES — ship after parser,
serialize, and stale-`baseHash` guards.

---

## Identity

Input metadata (unchanged shape):

```js
{
  instance: 'prod',
  app: 'search',
  owner: 'nobody',
  name: 'Error Rate'   // exact Splunk name — NOT slug, NOT "[Error Rate]"
}
```

| Layer | Value | Use |
| --- | --- | --- |
| Object name / REST / URL `s=` | `Error Rate` | Match, upsert, trailers, history filter |
| Conf header | `[Error Rate]` | Syntax only; brackets are not part of the name |
| Path / ref slug | `error-rate` | Ref paths and display paths only — **never** for stanza match |
| Canonical id | `prod\|search\|nobody\|Error Rate` | Stable id string (case-sensitive name) |

Rules:

- Upsert / extract / history filter match the **exact** name string.
- Slug collisions (`Error Rate` vs `error rate`) are different objects if Splunk
  treats them as different; never collapse via slug for identity.
- Two tabs on the **same** search share one draft ref (last write wins).

---

## Repo layout (shared with watchdog)

```txt
<instance>/
  apps/
    <app>/
      local/
        savedsearches.conf
        data/ui/views/
          <dashboard>.xml
          <dashboard>.json
  users/                                 # optional private objects
    <owner>/
      <app>/
        local/
          savedsearches.conf
          data/ui/views/...
```

Drop `<instance>/` prefix only if the remote repo is already per-instance.

| Object | Git path | History / draft grain |
| --- | --- | --- |
| Saved search | `…/savedsearches.conf` | `(path, exact stanza name)` |
| Dashboard | `…/data/ui/views/<name>.{xml,json}` | whole file |

Path helpers (replace `getSavedSearchPath` returning `.spl`):

```js
getSavedSearchConfPath({ instance, app, owner })  // users/ vs apps/ by owner
getDashboardViewPath({ instance, app, owner, name, ext })
```

---

## Ref policy

Shared remotely (same spirit as prior ledger):

```txt
refs/heads/*
refs/tags/search-tag/*
refs/splunk-ide/versions/*
```

Local-only:

```txt
refs/splunk-ide/stashes/*
```

### Draft stash ref shape (per stanza / per view)

```txt
# Saved search
refs/splunk-ide/stashes/<conf-slug>/<stanza-slug>/<baseHash>

# Dashboard (file-scoped; stanza-slug omitted or fixed "view")
refs/splunk-ide/stashes/<view-path-slug>/<baseHash>
```

Blob body for saved-search drafts: **stanza text only** (header + keys), not the
whole conf.

No push command may mention `refs/splunk-ide/stashes/*`.

Fetch / push refspecs: keep existing `git-sync` policy; extend only if new
shared ref namespaces are added (prefer not to).

---

## Core helpers (new)

```js
extractStanza(confText, name)           // exact name; null if missing
upsertStanza(confText, name, stanzaText) // replace in place; never append duplicate
listStanzaNames(confText)
recompose(headConfText, drafts[])       // HEAD + all durable drafts for that conf
```

Invariants:

1. `upsertStanza` replaces an existing `[name]` block in place.
2. If name is missing and the operation is **import/create**, append once; restore
   of a missing historical stanza must **error**, not invent.
3. Parser must not split on substrings inside values; stanza starts at `^[name]`.
4. Serialize all recompose / save / reset ops per conf path (mutex / queue).

---

## Single-stanza ops (Model A)

### recompose (worktree)

```txt
confView = HEAD:savedsearches.conf
for each local draft D for that confPath:
  confView = upsertStanza(confView, D.name, D.text)
write worktree conf = confView
```

### checkout / restore (saved search)

Same UX as today: become that content, remain unsaved draft, run/edit, save later.

```txt
text = extractStanza(H:conf, "Error Rate")
write draft ref (name, text, baseHash=H)
recompose()
# no commit, no push, no REST yet
# never: git checkout H -- savedsearches.conf
```

### stash

Draft refs **are** the durable stash. Multi-open = multiple refs. Survives restart.
No stash-on-switch required for isolation.

### commit / save (active search only)

```txt
draft = loadDraft(activeName) or extract(worktree, activeName)
base  = HEAD:savedsearches.conf
toCommit = upsertStanza(base, activeName, draft)
  # siblings in toCommit come from HEAD, NOT from sibling drafts
commit toCommit on shared branch via temp index (reuse commitFileOnParent pattern)
delete draft(activeName)
recompose()   # remaining drafts re-applied onto new HEAD
push shared branch
```

Never `git add` the composed dirty worktree as the commit blob for a single-search save.

### reset / discard draft

```txt
delete draft(activeName)
recompose()
```

### future revert of a committed change

Same as restore → optional later “revert + save” one-shot. Still exact-name upsert.

### dashboards

File-scoped: existing `saveVersion` / `restoreVersion` / file draft stash patterns
apply to the view path. No stanza filter.

---

## Watchdog coexistence

| Writer | When | Action |
| --- | --- | --- |
| IDE | Realtime on save | REST snapshot → upsert/write path → commit if changed → push |
| Watchdog | Midnight cron | Full tree dump → commit if changed → push |

Both must no-op when file bytes match HEAD.

On non-fast-forward / diverge:

```txt
fetch
→ REST re-export affected app(s) into native paths
→ commit "Reconcile from Splunk" if changed
→ push
```

Local drafts for unchanged-elsewhere stanzas survive via recompose onto new HEAD.
If remote changed the same stanza as a local draft → conflict UI for that stanza
only (keep draft / take remote / diff).

---

## History and diff

```txt
listVersions(git, confPath, { stanza: "Error Rate" })
  → git log -- confPath
  → keep commit only if extract(commit) !== extract(parent) for that name
  → UI diff = stanza text (or changed keys)
```

Watchdog commits that did not touch the open stanza do not appear in its timeline.

Trailers (IDE commits; optional on watchdog):

```txt
Object-Type: savedsearch|dashboard
Splunk-Instance: prod
Splunk-App: search
Splunk-Owner: nobody
Saved-Search: Error Rate
Saved-Search-Id: <canonical-id-or-hash>
```

Tags: include stanza slug in tag path so conf-level tags are not shared across
all searches in an app.

---

## Open / save flows

### Open saved search

```txt
parse URL → { instance, app, owner, name }
→ confPath = getSavedSearchConfPath(...)
→ ensure repo / remote / fetch
→ if draft exists: recompose and show draft
→ else if stanza in HEAD conf: use it
→ else REST GET → upsert into conf → optional "Import" commit
→ listVersions(confPath, { stanza: name })
```

### Save saved search

```txt
optional REST GET/PUT for write-back product choice
→ commit path = upsert(HEAD, name, draft) as above
→ push
→ on failure: keep local commit + draft semantics; show sync status
```

### Open / save dashboard

```txt
parse dashboard URL → view path
→ REST GET view body if missing
→ file-scoped saveVersion / history (no stanza filter)
```

---

## Author policy

Unchanged from prior ledger:

1. Repo-local `user.name` + `user.email`
2. App settings `gitUserName` + `gitUserEmail`
3. Fallback `Splunk IDE <splunk-ide@local>`

Do not write global git config.

---

## Conflict / status model

Minimum statuses:

```txt
Up to date
Unsaved draft
Remote changed
Stale draft base          # local draft baseHash behind HEAD for that stanza
Local version not pushed
Push failed
Stanza conflict           # remote and local draft both changed same name
```

Keep sync status separate from draft dirty state.

---

## Explicitly out of scope (v1)

- Real git branch per search
- `.spl` dual-write / migration of old URL files (delete/ignore later if needed)
- Three-way merge of `savedsearches.conf`
- ACL / `local.meta` versioning
- Writing directly into `$SPLUNK_HOME`
- Off-HEAD nonlinear shared refs for conf stanzas (linear main + stanza filter
  first; revisit only if product still needs it)
- In-memory-only drafts

---

## Ledger table

| ID | Status | Commit goal | Primary files | Required check |
| --- | --- | --- | --- | --- |
| 0 | Done | Conf stanza parse / extract / upsert | `lib/conf-stanza.js`, `test/conf-stanza.test.js` | unit: Error Rate replace-in-place, no duplicate |
| 1 | Open | Native path helpers (conf + dashboard) | `lib/saved-search-id.js` or `lib/object-paths.js`, tests | unit: apps vs users, slug not used for match |
| 2 | Open | Per-stanza draft stash refs + recompose | `lib/query-versions.js` or `lib/stanza-drafts.js`, tests | multi-draft persist; recompose roundtrip |
| 3 | Open | Stanza-filtered `listVersions` + diff text | `lib/query-versions.js`, tests | watchdog-like sibling commit hidden |
| 4 | Open | Save = upsert(HEAD, one stanza) via temp index | `lib/query-versions.js`, tests | sibling draft not in commit blob |
| 5 | Open | Restore = draft only (no whole-conf checkout) | `lib/query-versions.js`, tests | siblings unchanged; Exact name replace |
| 6 | Open | Reset / discard one draft | drafts module, tests | other drafts survive |
| 7 | Open | Serialize ops per conf path | drafts/save module, tests | concurrent save/reset safe |
| 8 | Open | Stale `baseHash` detection | drafts module, tests | HEAD moved → status / rebase rule |
| 9 | Open | REST client GET saved search + view | `lib/splunk-rest.js`, tests (mock) | fetch → stanza/view text |
| 10 | Open | Open/import flow uses conf paths + REST | `lib/saved-search-open.js` (adapt), tests | import upserts stanza |
| 11 | Open | Renderer: multi-tab save/restore/reset/stash | `renderer.js` | smoke + unit where possible |
| 12 | Open | Dashboard path + file-scoped history wiring | path helper, renderer, tests | view file roundtrip |
| 13 | Open | Push/fetch + REST reconcile on diverge | `lib/git-sync.js`, renderer | non-ff → re-export path |
| 14 | Open | Trailers / tags include object type + stanza | `lib/query-versions.js`, tests | trailer present on IDE save |
| 15 | Open | Drop `.spl` canonical save path from hot path | renderer, open helpers | no new `.spl` writes for saved searches |
| 16 | Open | Two-tab independence proof test | integration test | save A leaves B draft intact |

---

# Loop specs

Each loop: implement only that row, run its check, mark `Done`, commit with the
given message. Do not start the next loop until DoD is met.

---

## Loop 0 — conf stanza parse / extract / upsert

**Rationale:** Every later op (save, restore, history filter, recompose) needs
safe stanza surgery on a shared conf. Wrong parse = duplicate searches or
sibling corruption. Pure module first so git/UI cannot paper over parser bugs.

**Scope:** New `lib/conf-stanza.js` only. No git, no renderer, no REST.

```js
extractStanza(confText, name) → string | null
upsertStanza(confText, name, stanzaText) → string
listStanzaNames(confText) → string[]
```

**Requirements:**

- Exact name match for `Error Rate` (case-sensitive; not slug; not `[Error Rate]`).
- Existing name → replace in place; afterward exactly one `[Error Rate]` header.
- Missing name → append once (import/create only).
- Unchanged siblings stay equal (byte-stable enough for git no-op).
- Stanza boundaries only at `^[name]` lines; do not split inside values.

**DoD:**

- [x] Exports above exist and are documented in module header
- [x] Unit tests cover: replace-in-place, no duplicate, missing→null, spaces/dots,
      upsert middle of multi-stanza conf
- [x] `npm test -- test/conf-stanza.test.js` passes
- [x] No other files changed

**Commit:** `Add conf stanza extract/upsert helper`

**Done 2026-07-14:** Added `lib/conf-stanza.js`, `test/conf-stanza.test.js`. `npm test -- test/conf-stanza.test.js` → 13 pass; full `npm test` → exit 0, no regressions.

---

## Loop 1 — native path helpers

**Rationale:** Watchdog and IDE must land on the same paths. Wrong path =
parallel histories. Separate from Loop 0 so path policy (apps vs users,
instance prefix) can change without touching the parser.

**Scope:** Path helpers only (`lib/object-paths.js` or extend
`lib/saved-search-id.js`). Slug for path segments only — never for stanza match.

```js
getSavedSearchConfPath({ instance, app, owner })
getDashboardViewPath({ instance, app, owner, name, ext })
```

**Requirements:**

- Document apps-shared vs user-private rule (`nobody` → `apps/…`, else `users/…`
  — or match watchdog layout exactly if known).
- Instance prefix included unless documented otherwise.
- Dashboard paths under `…/local/data/ui/views/<name>.{xml,json}`.

**DoD:**

- [ ] Helpers return stable relative paths for given metadata
- [ ] Unit tests: apps vs users, dashboard ext, instance prefix
- [ ] Explicit comment/test that slug is not used for stanza identity
- [ ] Targeted path tests pass

**Commit:** `Add native Splunk object path helpers`

---

## Loop 2 — per-stanza draft stash refs + recompose

**Rationale:** Multi-tab WIP must be durable and independent without per-search
branches. File-scoped stashes today couple siblings on one conf. Per-stanza local
refs + recompose is Model A’s core.

**Scope:** Extend stash ref shape; store stanza-only blob; `recompose(head,
drafts)` → worktree conf text. Prefer extending existing stash helpers over a
new storage system.

```txt
refs/splunk-ide/stashes/<conf-slug>/<stanza-slug>/<baseHash>
```

**Requirements:**

- Draft body = stanza text only (not whole conf)
- Two drafts on same conf coexist
- Recompose = HEAD conf + upsert each draft by exact name
- Refs remain local-only (still not in push refspec)

**DoD:**

- [ ] Save/load/delete draft by `(confPath, stanzaName, baseHash)`
- [ ] Recompose roundtrip test: HEAD + drafts A,B → worktree has both
- [ ] Restart simulation: write refs, new process/load, recompose matches
- [ ] Draft blob assertion: no sibling stanzas inside draft body
- [ ] Targeted tests pass; drafts still not pushed

**Commit:** `Add per-stanza durable draft stashes`

---

## Loop 3 — stanza-filtered history

**Rationale:** Watchdog/IDE commits touch the whole conf. Without filtering,
Search A’s timeline is noise from every other search. UX grain is stanza;
storage grain stays file.

**Scope:** Extend `listVersions` (and a small diff/read helper) with optional
`{ stanza }`. No UI wiring yet.

**Requirements:**

- Keep commit iff `extract(commit) !== extract(parent)` for that exact name
- Omit `{ stanza }` → current file-scoped behavior (dashboards / later)
- Diff text for UI = stanza body (not whole conf, not URL extract)

**DoD:**

- [ ] `listVersions(git, confPath, n, { stanza: 'Error Rate' })` API works
- [ ] Test: sibling-only commit hidden; Error Rate commit shown
- [ ] Test: no-stanza option unchanged for plain file history
- [ ] Targeted tests pass

**Commit:** `Filter version history by conf stanza`

---

## Loop 4 — single-stanza save

**Rationale:** Composed worktree includes all tab drafts. Staging that file on
save would commit sibling WIP. Save must build `upsert(HEAD, active, draft)` via
temp index (same idea as `commitFileOnParent`).

**Scope:** Save/commit path for conf+stanza. Clear only active draft; recompose
after. No renderer yet if callable from lib tests.

**Requirements:**

- Commit blob siblings come from HEAD, not sibling drafts
- Active draft cleared after successful save
- Other draft refs untouched
- No-op when active stanza unchanged vs HEAD (`no-changes`)

**DoD:**

- [ ] With drafts A+B dirty, save A → commit has new A + HEAD B
- [ ] After save A, draft B still loadable
- [ ] Worktree recomposed: A=HEAD, B=draft
- [ ] Targeted tests pass

**Commit:** `Commit only the active saved-search stanza`

---

## Loop 5 — restore to draft

**Rationale:** Today’s whole-file checkout rewinds every search in the conf.
Product needs same feel as now (become old content, stay unsaved, edit/run,
save later) but only for one stanza — replace, never create a second search.

**Scope:** Restore API writes draft from historical extract; recomposes; no
commit/push/REST.

**Requirements:**

- Never `git checkout <hash> -- savedsearches.conf`
- Exact-name replace into draft + worktree
- Missing historical stanza → error (do not invent)
- Remains dirty / unsaved until Loop 4 save

**DoD:**

- [ ] Restore H for A: worktree A matches H; siblings unchanged (or keep their drafts)
- [ ] No new commit created
- [ ] Missing stanza → explicit failure
- [ ] Targeted tests pass

**Commit:** `Restore saved search as stanza draft`

---

## Loop 6 — reset / discard one draft

**Rationale:** Per-tab discard must not wipe other tabs’ WIP. Symmetric to save
clearing only the active draft.

**Scope:** Delete one draft ref + recompose.

**DoD:**

- [ ] Reset A keeps draft B
- [ ] After reset, extract(worktree, A) === extract(HEAD, A)
- [ ] Targeted tests pass

**Commit:** `Discard a single stanza draft`

---

## Loop 7 — serialize ops per conf

**Rationale:** Composer/terra/luna all flagged races: concurrent tab
save/reset/recompose can drop sibling drafts. Mutex/queue per conf path is the
lazy fix (not per-search branches).

**Scope:** Single queue/mutex wrapping recompose + save + reset + draft write
for a given conf path. Document `# ponytail: global per-conf lock; finer locks
if contention matters`.

**DoD:**

- [ ] Overlapping save A + save B deterministic: both commits correct, no lost draft
- [ ] Overlapping reset/save does not corrupt conf (no duplicate headers)
- [ ] Acceptance test for queued ops passes

**Commit:** `Serialize stanza ops per conf file`

---

## Loop 8 — stale baseHash detection

**Rationale:** After another tab save or watchdog fetch, HEAD moves under an
existing draft. Ignoring that hides “you’re editing against an old base.”
Full conflict UI waits for Loop 13; v1 only needs detection + safe save rule.

**Scope:** Status when draft `baseHash` is not current tip for that stanza’s
history (or not ancestor of HEAD as defined in tests).

**v1 rule (lock this):** Keep draft text; mark `Stale draft base`; save still
`upsert(newHEAD, name, draftText)` (content wins). Deeper “remote stanza also
changed” prompts → Loop 13.

**DoD:**

- [ ] Status exposed when base is stale
- [ ] Save still succeeds with content-winning upsert on new HEAD
- [ ] Unit test for stale detection
- [ ] Targeted tests pass

**Commit:** `Detect stale stanza draft bases`

---

## Loop 9 — REST GET mirror

**Rationale:** IDE has no `$SPLUNK_HOME`. Watchdog dumps native files; IDE must
produce comparable content via REST so both writers share one tree. GET-only in
this loop (write-back optional later).

**Scope:** `lib/splunk-rest.js` — auth + GET saved search → stanza-ish text; GET
view → body. Mocked HTTP tests. Document key normalization so identical Splunk
state tends toward identical bytes (reduces noisy midnight commits).

**DoD:**

- [ ] GET saved search returns text usable by `upsertStanza`
- [ ] GET view returns raw XML/JSON body
- [ ] Mock tests for success + auth failure
- [ ] Normalization documented in module comment
- [ ] No live Splunk required for CI

**Commit:** `Add Splunk REST export helpers`

---

## Loop 10 — open/import on conf paths

**Rationale:** Bridge identity (URL metadata) to native paths + drafts. First
place REST + conf + git meet. Without this, Loops 0–8 are unreachable from the
product open flow.

**Scope:** Adapt `lib/saved-search-open.js` (or successor): resolve conf path,
fetch if needed, upsert missing stanza, optional import commit, return path +
stanza context.

**DoD:**

- [ ] Open with existing HEAD stanza → no unnecessary import commit if unchanged
- [ ] Open missing stanza → REST GET → upsert → import commit (or documented skip)
- [ ] Existing draft preferred over HEAD on open
- [ ] Unit tests with temp repo + mocked REST
- [ ] Targeted tests pass

**Commit:** `Open saved searches from native conf paths`

---

## Loop 11 — renderer multi-tab wiring

**Rationale:** Product surface. Lib isolation is useless if UI still whole-file
checkouts or commits dirty worktree. Wire save/restore/reset/history/status to
stanza APIs; tabs on different searches stay independent.

**Scope:** `renderer.js` (+ minimal HTML if status strings need it). Prefer
calling lib APIs; no new business logic in the renderer.

**DoD:**

- [ ] Save / restore / discard / history use stanza APIs for saved searches
- [ ] History panel shows stanza-filtered list + stanza diff text
- [ ] Status strings include draft / stale / sync as already modeled
- [ ] Manual smoke notes in commit body or checklist tick where automatable
- [ ] No regression: syntax/load OK; existing non-conf flows don’t crash

**Commit:** `Wire stanza drafts into the editor UI`

---

## Loop 12 — dashboards

**Rationale:** Same watchdog tree includes `data/ui/views/*`. Dashboards are
already one-file-per-object — reuse file-scoped versioning, don’t force stanza
machinery.

**Scope:** Path helper usage + open/save/history for view files. File-scoped
drafts OK. URL parse for dashboards as needed.

**DoD:**

- [ ] Dashboard open resolves native view path
- [ ] Save/history/restore work file-scoped
- [ ] Unit or integration roundtrip for a sample `.xml`/`.json` view
- [ ] Does not break saved-search stanza path

**Commit:** `Version dashboards as native view files`

---

## Loop 13 — reconcile on diverge

**Rationale:** Dual writers (IDE + watchdog) will non-ff occasionally. Hand-merging
conf is a bug farm; Splunk live state is semantic truth. REST re-export then
commit keeps the ledger honest without three-way merge.

**Scope:** On fetch/push non-ff (or explicit reconcile): REST re-export affected
apps → write native paths → commit if changed → push. Recompose so unrelated
local drafts survive. Same-stanza remote+local draft → `Stanza conflict` status
(keep / take remote / diff) — minimal UI ok.

**DoD:**

- [ ] Simulated diverge path runs re-export + commit + push (test or scripted)
- [ ] Unrelated local draft still present after reconcile
- [ ] Same-stanza conflict surfaced (not silently overwritten without status)
- [ ] No three-way conf merge code

**Commit:** `Reconcile shared conf history from Splunk REST`

---

## Loop 14 — trailers and tags

**Rationale:** Stanza filter works from file content alone, but trailers/tags
make IDE commits greppable and prevent search-tag collisions across all
searches sharing one conf slug.

**Scope:** Extend commit trailers (`Object-Type`, existing Splunk_* /
Saved-Search_*). Tag paths include stanza slug. Watchdog commits may omit
trailers — still fine.

**DoD:**

- [ ] IDE saved-search save writes Object-Type + Saved-Search trailers
- [ ] Tag ref/path includes stanza slug (two searches don’t share one tag namespace)
- [ ] Unit tests for trailer/tag format
- [ ] Targeted tests pass

**Commit:** `Tag and trailer native object commits`

---

## Loop 15 — remove `.spl` hot path

**Rationale:** Dual formats = dual bugs. Design dropped `.spl` truth; leaving the
canonical URL-file writer active will keep creating the old tree beside native
conf.

**Scope:** Stop writing/using `saved-searches/...spl` for saved searches in open
and save hot paths. Orphan cleanup optional/later (YAGNI unless it confuses UI).

**DoD:**

- [ ] Saving/opening a saved search does not create new `.spl` canonical files
- [ ] Grep/hot-path check: no `getSavedSearchPath` → `.spl` for new saves
- [ ] Smoke or unit proving conf path is used instead
- [ ] Old `.spl` files may still exist on disk without breaking open (ignore OK)

**Commit:** `Stop using URL .spl files for saved searches`

---

## Loop 16 — two-tab independence proof

**Rationale:** End-to-end acceptance for the product promise. Unit tests per loop
can miss cross-op bugs; one integration test locks the contract composer/terra/luna
said to ship.

**Scope:** Automated test only (temp repo, no Electron required if APIs are
lib-exposed). Scenario:

```txt
dirty A + dirty B
→ save A
→ assert commit blob + draft B intact
→ reset B
→ assert A still at saved content / no draft A
```

**DoD:**

- [ ] Integration test implements the scenario above
- [ ] Also asserts: restore A does not duplicate stanza headers
- [ ] Test passes under `npm test` (targeted file)
- [ ] Smoke checklist below reviewed; unchecked items filed or done

**Commit:** `Prove multi-tab stanza draft isolation`

---

## Implementation notes for subagents

- Prefer extending `lib/query-versions.js` patterns (`commitFileOnParent`,
  stash refs) over new branch machinery.
- One loop per commit unless the ledger row says otherwise.
- After each loop: mark status `Done`, note date, run the row’s check.
- If a loop discovers the design must change, stop and update this ledger
  before coding further — do not silently invent per-search branches or
  `.spl` dual-write.

## Smoke checklist (after loop 16)

- [ ] Two tabs, two searches, independent dirty drafts survive restart
- [ ] Save tab A does not commit tab B’s draft
- [ ] Restore old A → edit → save replaces A only; no duplicate stanza
- [ ] Reset A leaves B draft
- [ ] History for A hides commits that only changed B
- [ ] Simulated watchdog commit on conf appears in A’s history only if A changed
- [ ] Dashboard view file save/history works
- [ ] Diverged remote + local draft reconciles without losing unrelated drafts
