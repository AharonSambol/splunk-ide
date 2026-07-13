# Native Object Git History Ledger

This file is the handoff contract for loop-based implementation. A subagent
should be able to open this file, take the first `Open` loop, implement only
that loop, run its check, update the status row, and commit.

Supersedes the `.spl` canonical-path model in `SAVED_SEARCH_GIT_LEDGER.md` for
new work. That ledger remains history for completed loops 0–13.

## Non-negotiables

- Worktree: `/Users/ilais/Projects/kedem/splunk-ide-git-overhaul`
- Branch: `git-overhaul`
- Current base commit: `3a07064 Fix shared saved-search history sync between instances.`
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
| 0 | Open | Conf stanza parse / extract / upsert | `lib/conf-stanza.js`, `test/conf-stanza.test.js` | unit: Error Rate replace-in-place, no duplicate |
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

## Loop 0 — conf stanza parse / extract / upsert

Pure module. No git, no renderer.

Suggested exports:

```js
extractStanza(confText, name) → string | null
upsertStanza(confText, name, stanzaText) → string
listStanzaNames(confText) → string[]
```

Requirements:

- Exact name match for `Error Rate` (case-sensitive).
- `upsertStanza` on existing name replaces in place; conf must contain exactly one
  `[Error Rate]` after upsert.
- Upsert of missing name appends one stanza (for import).
- Preserve other stanzas byte-stable enough that unchanged siblings stay equal.

Tests:

- replace in place (no duplicate headers)
- extract missing → null
- names with spaces / dots
- multiple stanzas; upsert middle

Commit message: `Add conf stanza extract/upsert helper`.

## Loop 1 — native path helpers

Map metadata → conf path and dashboard view path. Reuse slug only for path
segments, not for identity matching.

Tests:

- `nobody` / app-shared → `apps/<app>/local/savedsearches.conf`
- user owner → `users/<owner>/<app>/local/savedsearches.conf` (document chosen rule)
- dashboard path includes views dir + extension
- instance prefix behavior

Commit message: `Add native Splunk object path helpers`.

## Loop 2 — per-stanza draft refs + recompose

Extend stash refs with stanza slug. Store stanza-only blob. `recompose` writes
worktree conf from HEAD + all drafts for that path.

Tests:

- two drafts coexist
- restart simulation: load refs → recompose
- draft body is stanza-only

Commit message: `Add per-stanza durable draft stashes`.

## Loop 3 — stanza-filtered history

`listVersions(git, path, maxCount?, { stanza })` filters commits by stanza text
change. Diff helper returns stanza text for UI.

Tests:

- commit touching only Other Search hidden when listing Error Rate
- commit touching Error Rate shown
- dashboards / no stanza option keeps file-scoped behavior

Commit message: `Filter version history by conf stanza`.

## Loop 4 — single-stanza save

Save builds commit blob from `upsert(HEAD, active, draft)`, not from dirty
worktree. Clear only that draft; recompose after.

Tests:

- with drafts A+B dirty, save A → commit blob has new A + HEAD B
- B draft ref still present after save A

Commit message: `Commit only the active saved-search stanza`.

## Loop 5 — restore to draft

Restore extracts historical stanza into draft ref; recomposes; does not commit;
does not whole-file checkout.

Tests:

- sibling stanzas in worktree remain HEAD (or their drafts)
- still dirty / unsaved after restore
- missing historical stanza → error

Commit message: `Restore saved search as stanza draft`.

## Loop 6 — reset one draft

Delete one draft ref; recompose.

Tests:

- reset A keeps draft B
- A matches HEAD after reset

Commit message: `Discard a single stanza draft`.

## Loop 7 — serialize per conf

Queue/mutex so concurrent tab save/reset/recompose cannot drop sibling drafts.

Tests:

- overlapping save A + save B do not lose either commit or draft incorrectly
  (deterministic queue acceptance test)

Commit message: `Serialize stanza ops per conf file`.

## Loop 8 — stale baseHash

When HEAD moves under a draft, surface `Stale draft base` (or auto-rebase draft
onto new HEAD keeping draft text — pick one rule and test it).

Recommended v1: keep draft text; update status; on save still
`upsert(newHEAD, name, draftText)` (content-winning save). Prompt only if remote
stanza also changed vs draft base (Loop 13 can deepen).

Commit message: `Detect stale stanza draft bases`.

## Loop 9 — REST GET mirror

Minimal client: auth + GET saved search → stanza-ish text; GET view → body.
Normalize key order enough that identical Splunk state → identical bytes when
possible (document normalization).

Tests with mocked HTTP.

Commit message: `Add Splunk REST export helpers`.

## Loop 10 — open/import on conf paths

Adapt open flow to conf path + stanza; import via REST + upsert + optional commit.

Commit message: `Open saved searches from native conf paths`.

## Loop 11 — renderer multi-tab wiring

Wire save / restore / reset / draft status to stanza APIs. Multiple tabs on
different searches must stay independent.

Commit message: `Wire stanza drafts into the editor UI`.

## Loop 12 — dashboards

Path + open/save/history for view files. File-scoped drafts OK.

Commit message: `Version dashboards as native view files`.

## Loop 13 — reconcile on diverge

Non-ff push/fetch path: REST re-export → commit if needed → push. Preserve
unrelated local drafts via recompose.

Commit message: `Reconcile shared conf history from Splunk REST`.

## Loop 14 — trailers and tags

Object-Type + Saved-Search trailers; tag paths include stanza slug.

Commit message: `Tag and trailer native object commits`.

## Loop 15 — remove `.spl` hot path

Stop writing canonical `saved-searches/...spl` for saved searches. Leave orphan
file cleanup optional / later.

Commit message: `Stop using URL .spl files for saved searches`.

## Loop 16 — two-tab independence proof

Automated test: dirty A+B; save A; assert commit + draft B; reset B; assert A
unaffected.

Commit message: `Prove multi-tab stanza draft isolation`.

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
