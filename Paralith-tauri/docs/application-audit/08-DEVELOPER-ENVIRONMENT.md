# 08 — Developer Environment

Files, editor, terminal, browser, Git, GitHub and database tooling — the non-AI half of the product.

---

## 1. Filesystem layer

### 1.1 Capabilities

| Operation | Command | Guard |
|---|---|---|
| List directory | `list_project_directory` | `resolve_existing` |
| Read file | `read_project_file` | `resolve_existing` + binary sniff + size cap |
| Write file | `write_project_file` | `resolve_existing`, falls back to `resolve_new`; optimistic-concurrency |
| Create file | `create_project_file` | `resolve_new` + `create_new(true)` |
| Create directory | `create_project_directory` | `resolve_new` |
| Rename / move | `rename_project_entry` | both endpoints guarded; refuses to clobber |
| Copy | `copy_project_entry` | both endpoints guarded |
| Delete | `delete_project_entry` | `symlink_metadata` (does not follow the link) |
| Search | `search_project_files` | skips symlinked dirs, excludes non-source dirs |
| Watch / unwatch | `watch_project_files` / `unwatch_project_files` | per-window registration |

### 1.2 Limits

| Constant | Value | Purpose |
|---|---|---|
| `MAX_TEXT_FILE_BYTES` | 5,000,000 | refuse to open/write huge files |
| `MAX_DIRECTORY_ENTRIES` | 5,000 | bound a directory listing |
| `MAX_INDEXED_FILES` | 20,000 | bound Quick Open indexing |
| `BINARY_SNIFF_BYTES` | 8,192 | binary detection window |
| `SELF_WRITE_TTL` | 2 s | how long a self-write suppresses a watcher event |
| `NON_SOURCE_DIRECTORIES` | list | `node_modules`, build output, etc. excluded from search |

### 1.3 The self-write ledger

`SelfWriteLedger` is shared between `FileSystemService` and `FileWatchService`. Every Paralith write stamps `(path, ChangeOrigin, timestamp)`; the watcher reads it back within a 2-second TTL.

This is what lets the memory Markdown mirror write into `.paralith/` without triggering its own impact analysis, while a *user's* edit to a file in the same directory still does. `write_file_as(…, origin)` names the responsible subsystem explicitly.

**Dead code found:** `SelfWriteLedger::recently_written` and `ChangeOrigin::as_str` / `ChangeOrigin::parse` are never called (compiler `dead_code` warnings, confirmed in this audit's build). The origin-aware `origin_of()` superseded the boolean `recently_written()`.

### 1.4 Optimistic concurrency

`write_project_file(… expected_sha256)`:
- `None` → unconditional write
- `Some(hash)` → read current bytes, compare; mismatch returns `file_changed_since_read` with the current hash in `detail`
- `Some("")` → asserts the file does not yet exist

This is the correct design and is what makes the editor safe against the file watcher and against an agent editing the same file. **COMPLETE · HIGH.**

---

## 2. Editor

| Aspect | Implementation |
|---|---|
| Engine | Monaco 0.54 via `@monaco-editor/react` |
| Tabs | `editorStore.ts` (433 LOC, tested) |
| Dirty state | per-tab, drives the save path |
| Save | `Ctrl+Shift+S` = save all; individual saves via UI |
| Autosave | **none** |
| Language detection | by extension, mapped to Monaco languages |
| Syntax highlighting | Monaco built-in |
| Diagnostics / LSP | **none** |
| Find / replace | Monaco's in-file widget only; **no cross-file find/replace** |
| Multi-file | tabs only; **no split editor** |
| Diff view | separate `DiffSurface` (working-tree oriented), plus a `comparing` mode in `editorStore` |
| Conflict handling | `file_changed_since_read` error surfaced to the user |
| External change | `project-file-changed` event → reload prompt |
| Quick Open | `Ctrl+P`, fuzzy matcher in `fuzzy.ts` (tested) |
| Persistence of open tabs | **none** — editor state is in-memory and lost on workspace switch |

**No abandoned or duplicated editor implementation was found.** There is exactly one editor.

---

## 3. Terminal

Covered in depth in `06-RUNTIME-AND-AUTOMATION.md` §1.2. Developer-relevant specifics:

| Aspect | Implementation |
|---|---|
| Backend | `portable-pty` 0.9 → ConPTY on Windows |
| Frontend | `@xterm/xterm` 6 + fit, search, web-links addons |
| Spawn | `CommandBuilder` with argv array; `TERM=xterm-256color`, `COLORTERM=truecolor`; inherited colour-suppression env cleared |
| Environment | per-session `environment_overrides` |
| Working directory | per-pane, may be a Git worktree |
| Output backpressure | bounded `sync_channel`; saturation increments `dropped_output_bytes` (recorded, not hidden) |
| Scrollback | `scrollback_size` setting (default 10,000) in xterm; backend keeps `output_tail` + optional full log |
| Unicode | UTF-8 lossy conversion at the JSONL-recovery boundary; xterm handles rendering |
| Machine protocol | fixed rows/cols for agent panes so provider JSONL is not wrapped |
| Resize | `resize_terminal_session`, lease-gated |
| Branch awareness | per-pane via `pane_worktrees` + `get_pane_git_review` — **the product correctly refuses to assume one global branch** |

### 3.1 Detached-window typing

The audit specifically looked for the "typing does not work in detached windows" class of bug.

**Finding: the design is correct.** `write_terminal_input` calls `assert_input_allowed(workspace_id, window.label())`, and `WindowRegistry` grants exactly one lease per Workspace. Terminal events are emitted with two explicit `emit_to` calls (main label + detached label) rather than relying on a broadcast. Tests cover the lease denial and grant paths (`window_registry.rs:644-768`).

The failure mode that remains possible is a **lease not being claimed** — a detached window that never calls `claim_workspace_lease`, or whose claim fails, will render output but silently reject input. Whether the UI surfaces that clearly could not be verified statically. **Confidence: MEDIUM.**

### 3.2 Duplicate listeners

None found. Every `listen()` in `src/` captures and calls its `unlisten`, with a `cancelled` flag for the unmount-before-resolve race.

---

## 4. Browser

| Aspect | Implementation |
|---|---|
| Engine | Tauri child webview (`WebviewBuilder` + `Window::add_child`) — WebView2 on Windows |
| Instances | **one per Workspace**, reused across tool switches so page state survives |
| Isolation | the webview label is granted **no capability** — `invoke` from a page is ACL-denied |
| Navigation guard | `ALLOWED_SCHEMES = ["http", "https"]`; `file:`, `javascript:`, `data:`, `about:`, `blob:` refused in the navigation hook (`about:blank` allowed only as the initial page) |
| Inspect bridge | injected script "navigates" to a synthetic non-resolving host with a base64url payload; the hook intercepts, emits `browser-event`, and **cancels the navigation** so no request is made |
| Send to agent | sanitised context typed into the active pane **without a trailing newline** — cannot auto-execute |
| Logging | `redact_for_log` keeps scheme+host+path only |
| Zoom | `browser_set_zoom` + Ctrl +/−/0 |
| Bounds | `browser_set_bounds` keeps the native child aligned with the React panel |

### 4.1 What the browser cannot do

Verified absent: **tabs, back/forward controls, DevTools, downloads, cookie/session management, console reading, network inspection, screenshot capture, permission prompts**.

`current_url` is held in an in-memory `Mutex` on `BrowserView` plus a frontend store — **it is not persisted**, so a restart loses the page.

**Assessment:** the browser is a genuinely well-secured embedded view with one strong feature (Inspect → agent). It is not a general-purpose browser and should not be described as one.

---

## 5. Git

### 5.1 Implementation strategy

**CLI-only.** No `git2`/libgit2 dependency exists. All Git work shells out to the installed `git` binary with argv arrays.

Subcommands used: `add`, `apply`, `branch`, `checkout`, `commit`, `config`, `diff`, `fetch`, `log`, `ls-files`, `merge`, `pull`, `push`, `remote`, `rev-list`, `rev-parse`, `stash`, `status`, `tag`, `worktree`.

### 5.2 Two invocation paths — an ownership split

| Path | Sites | Queued | Timeout | Cancellable | Audited | Redacted |
|---|---|---|---|---|---|---|
| `RepositoryService::run_program` | all 36 typed operations | ✅ | ✅ | ✅ | ✅ `repository_operations` | ✅ |
| Direct `Command::new("git")` | `git_commands.rs:365,386,595`, `database/mod.rs:1870`, `agent_resume.rs:466,598`, `project_service.rs:156` | ❌ | ad hoc | ❌ | ❌ | ❌ |

The direct calls are read-oriented (`rev-parse`, `status`, worktree checks) so the blast radius is small, but they bypass every guarantee the service layer provides. See `12-TECHNICAL-DEBT.md`.

### 5.3 The operation model

36 typed variants in `RepositoryOperation` (`models/repository.rs:79-292`). Notable design choices:

- **`StageHunks { patch }`** feeds a patch to `git apply` via **stdin**, not a temp file — no path exposure, no cleanup.
- **`PushBranch { force_with_lease }`** — force-push is expressed as `--force-with-lease`, never bare `--force`.
- **`MergePullRequest { …, expected_head_sha }`** passes `--match-head-commit` to `gh`, so a merge cannot land on a head the user did not review.
- **`CreateAgentWorktree { branch, base_commit, agent_id, task_id, file_scope, expires_at }`** — worktrees are leased, scoped and expiring, not just created.
- **`CreateCheckpoint`** — a distinct concept from `CommitChangeSet`, for agent-safe rollback points.

### 5.4 Execution safety

`run_program` (`repository_service.rs:2888-2995`):
- argv array, `stdin` explicitly `null` unless input is supplied
- stdout/stderr read on **dedicated threads** with `read_bounded` (no unbounded buffering)
- a 25 ms poll loop checking both a cancellation `AtomicBool` and a timeout, calling `terminate_child` on either
- `gh` failures go through `classify_github_error`; `git` failures return `git_command_failed` with **redacted** stderr

`redact()` strips `Authorization: Bearer …` and `https://user:token@host/…` — tested at `repository_service.rs:3867`.

### 5.5 Approval and policy

`repository_policies` + `repository_approvals` gate mutating operations. `repository-approval-required` / `repository-approval-decision` events drive the UI. Combined with worktree leases and `get_worktree_conflict_risks`, this is a coherent story for letting agents touch Git safely.

### 5.6 Gaps

- **Interrupted operations are detected, not resumed.** `recover_on_startup()` logs a warning; `repository_recovery_checkpoints` is never written.
- **Conflict resolution has no UI.** Conflicted files are counted in status; resolving them means dropping to a terminal.
- **`repository_graph_*` tables are written but never displayed.**

---

## 6. GitHub (Repository Command Center)

### 6.1 Integration strategy

**`gh` CLI only.** No `api.github.com` request, no token stored, no OAuth flow, no GitHub App. Paralith inherits whatever authentication `gh auth login` established.

This is a defensible choice: zero credential handling is the safest credential handling. The trade-off is a hard dependency on `gh` being installed and authenticated, surfaced honestly by `get_github_provider_status`.

### 6.2 What a user can do without leaving Paralith

| Task | Supported |
|---|---|
| See branch/ahead/behind/status | ✅ |
| Stage, unstage, discard, stage individual hunks | ✅ |
| Commit, amend, checkpoint | ✅ |
| Create/switch/delete branches | ✅ |
| Fetch, pull (rebase or ff-only), push (with lease), publish | ✅ |
| Stash, revert, cherry-pick, rebase, merge | ✅ |
| Create and delete tags | ✅ |
| Create/remove agent worktrees | ✅ |
| Open, update, mark-ready a PR | ✅ |
| Request review, submit review, resolve a review thread | ✅ |
| Merge a PR (merge/squash/rebase, head-matched) | ✅ |
| Delete a remote branch | ✅ |
| Rerun / cancel a workflow run | ✅ |
| Create a release | ✅ |
| **Read** issues, security alerts, releases | ✅ |
| **Create/comment/close** an issue | ❌ |
| Dismiss a security alert | ❌ |
| Download a workflow artifact | ❌ |
| Browse repository files on the remote | ❌ |

### 6.3 Caching and rate limiting

- Remote objects are projected into `repository_remote_cache` keyed by kind, with `repository_sync_cursors` tracking freshness.
- Refresh is manual or on a **120-second** interval, guarded so a background timer for a Project the user has navigated away from does nothing.
- `repository-sync-health` reports staleness honestly.
- **No explicit rate-limit accounting** — Paralith relies on `gh`'s own behaviour. With one refresh per 2 minutes per open Project this is unlikely to matter, but it is not defended against.

---

## 7. Database Studio

### 7.1 What it actually is

A **schema design and drift tool that writes migrations into the repository**. It is not a query client and it does not execute DDL against a live production database.

### 7.2 Pipeline

```mermaid
flowchart LR
  A[Discovery: compose services, connection config,<br/>SQLite files, ORM code usage, explicit profiles] --> B[(database_sources<br/>+ evidence + provenance)]
  B --> C[Introspection<br/>SQLite file / declared ORM schema]
  C --> D[ExtractedDatabaseGraph<br/>tables · columns · PK · FK · unique · indexes]
  D --> E[Canvas + Inspector]
  D --> F[database_compare:<br/>declared vs observed drift]
  E --> G[Design draft]
  G --> H[apply_design_operation ×N<br/>versioned revisions]
  H --> I{approve?}
  I -->|reject/archive| Z[end]
  I -->|approve| J[database_implement_design]
  J --> K[semantic delta]
  K --> L[risk classification]
  L --> M{destructive?}
  M -->|yes, unacknowledged| Z2[refused]
  M -->|no, or acknowledged| N[repository-native change:<br/>Prisma schema OR SQL migration<br/>in the repo's existing style]
  N --> O[write into repository]
  O --> P[re-extract]
  P --> Q[independent target-vs-result comparison]
```

### 7.3 Rules enforced in code

From `pipeline/execute.rs:1-7`:
- **`DESIGN_ONLY` never reaches the write path.**
- **A destructive change never reaches it either, unless the caller acknowledged that exact destructive change set.**

From `pipeline/native.rs:1-4`:
- "A Prisma repository gets a Prisma schema and a Prisma-style migration. A raw-SQL repository gets a SQL migration in the style it already uses. Paralith never dumps arbitrary SQL into an ORM-managed project, and it never invents a technology the repository does not already use."

`preserved_prisma_blocks()` retains generator/datasource blocks the tool did not author, so regeneration is non-destructive.

### 7.4 Coverage

| Dimension | Supported |
|---|---|
| Engines | Postgres, SQLite (`MySql` present in the enum; `supported_engine()` gates DDL generation) |
| ORMs | Prisma, Drizzle |
| Discovery kinds | `compose_service`, `connection_config`, `sqlite_file`, `code_usage`, `explicit_profile` |
| Read | tables, columns, PKs, FKs (with referential actions), unique constraints, indexes |
| Visualise | ER canvas with a **layout web-worker** and a large-schema benchmark test |
| Author | ✅ via approved designs → repository-native migrations |
| Execute DDL live | ❌ by design |
| Run ad-hoc queries | ❌ |
| Browse table data | ❌ |
| Seed / fixtures | ❌ |

### 7.5 Assessment

This is a **surprisingly complete subsystem** (~9,500 backend LOC + ~4,000 frontend LOC) with an honest scope. The `LayerUnavailableNotice` component and the `database_issues` surface mean the tool tells the user what it *cannot* see rather than rendering an incomplete diagram as if it were complete.

The one loose end is `database_build_context_pack` / `agent_ops.rs` — a context pack for agents exists, but no agent-launch path consumes it (same pattern as `ContextCompiler`).

---

## 8. Cross-cutting developer-experience gaps

| Gap | Impact |
|---|---|
| No global command palette | every surface is mouse-reachable only |
| No cross-file find/replace | a core editor expectation is missing |
| No merge-conflict UI | conflicts force a drop to the terminal |
| Editor state not persisted | open tabs and cursor positions are lost on workspace switch |
| Browser page not persisted | restart loses the page |
| No LSP | no go-to-definition, no rename symbol, no inline diagnostics — **despite a full symbol graph existing in the backend** |
| Single `ErrorBoundary` | one render error takes down the whole UI |

The LSP gap is the most striking: `code_symbols` and `code_references` are populated and incrementally maintained, and `code_symbol_detail` / `code_dependencies` / `code_impact` commands exist. A "go to definition" and "find references" experience is closer than it looks.
