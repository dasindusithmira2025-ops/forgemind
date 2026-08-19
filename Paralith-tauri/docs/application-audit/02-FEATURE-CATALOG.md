# 02 — Feature Catalog

The canonical answer to *"what features does Paralith have?"* — 118 features, derived from implementation, not documentation.

**Status vocabulary:** COMPLETE · FUNCTIONAL-INCOMPLETE · PARTIAL · PROTOTYPE · UI-ONLY · BACKEND-ONLY · STUB · LEGACY · DEAD · BROKEN · UNKNOWN
**Confidence:** HIGH (verified in implementation and/or tests) · MEDIUM (strong static evidence, runtime not exercised) · LOW (incomplete or contradictory evidence)

---

## A. Project System (9)

### A1 — Open a project folder
Pick a directory via the native dialog; it is validated, canonicalised and recorded as a Project.
**Access:** `/` ProjectLauncher → "Open folder".
**Path:** `ProjectLauncher.tsx` → `native.openProject` → `open_project` → `project_service.rs` → `projects` table.
**Persistence:** Project row (id, name, path, timestamps). **Status:** COMPLETE · HIGH

### A2 — Working-directory validation
Rejects non-directories/unreadable paths before a Project is created.
`validate_working_directory` → `project_commands.rs`. **Status:** COMPLETE · HIGH

### A3 — Git repository detection on open
`project_service.rs:156` runs `git` in the chosen folder to record repository status.
**Status:** COMPLETE · HIGH

### A4 — Recent projects list
`list_recent_projects`, `remove_project_from_recent`. Rendered on the launcher. **Status:** COMPLETE · HIGH

### A5 — Projects overview
`list_projects_overview` — projects with workspace counts for the launcher grid. **Status:** COMPLETE · HIGH

### A6 — Relocate a moved project
`relocate_project` re-points a Project whose folder moved, preserving its id and all child rows. **Status:** COMPLETE · HIGH

### A7 — Multiple projects open simultaneously
`open_project_session`, `set_active_project`, `close_project_session`, `list_open_projects` backed by `open_project_sessions`. The sidebar shows all open Projects; the active one drives the workspace.
**Status:** COMPLETE · HIGH

### A8 — Project-scoped path guard
Every filesystem command resolves through `ProjectPathGuard` bound to the canonical Project root.
`filesystem_service.rs:528-617`. **Status:** COMPLETE · HIGH — see `10-SECURITY-RELIABILITY-PERFORMANCE.md` §2

### A9 — Missing-project handling
`projectMissing` flag on recent workspaces; the launcher filters them from auto-restore (`App.tsx:49`).
**Status:** FUNCTIONAL-INCOMPLETE · MEDIUM — the flag exists and gates restore, but there is no repair/relocate prompt in the launcher UI.

---

## B. Workspace System (14)

### B1 — Workspace setup wizard
`/setup/:projectId` — choose layout, pane count, agent allocation, startup command.
`WorkspaceSetup.tsx` (383 LOC), `setupStore.ts` (497), `allocationCompiler.ts` (254).
**Status:** COMPLETE · HIGH

### B2 — Agent allocation compiler
Turns "2 Claude, 1 Codex, 1 shell" into concrete pane assignments. Unit-tested (`allocationCompiler.test.ts`).
**Status:** COMPLETE · HIGH

### B3 — Setup draft persistence
`draftPersistence.ts` keeps a partially-filled wizard across navigation. **Status:** COMPLETE · MEDIUM

### B4 — Preset migration
`presetMigration.ts` upgrades saved layout presets across versions; tested. **Status:** COMPLETE · HIGH

### B5 — Layout presets
`get_layout_preset`, `split_layout_pane`, `remove_layout_pane`. **Status:** COMPLETE · HIGH

### B6 — Save / load workspace
`save_workspace`, `get_workspace` → `workspaces` + `workspace_panes`. **Status:** COMPLETE · HIGH

### B7 — Workspace canvas (docking, splitting, dragging, resizing)
A hand-built pane engine: `geometryEngine.ts`, `snapResolver.ts`, `dragController.ts`, `resizeController.ts`, `layoutOperations.ts` (459 LOC) — all unit-tested.
**Status:** COMPLETE · HIGH — one of the strongest frontend subsystems.

### B8 — Canvas layout persistence
`get_workspace_canvas_layout` / `save_workspace_canvas_layout`, versioned by `WORKSPACE_CANVAS_LAYOUT_VERSION`, with `normalizeRestoredLayout` for forward compatibility.
**Status:** COMPLETE · HIGH

### B9 — Workspace list, rename, reorder, duplicate, delete
`rename_workspace`, `reorder_workspaces`, `duplicate_workspace`, `delete_workspace_configuration`. **Status:** COMPLETE · HIGH

### B10 — Suggested workspace names
`suggest_workspace_name`. **Status:** COMPLETE · MEDIUM

### B11 — Recent workspaces
`list_recent_workspaces`, `remove_recent_workspace`. **Status:** COMPLETE · HIGH

### B12 — Last-active workspace + reopen on startup
`set_last_active_workspace` + `reopenLastWorkspace` setting; `StartupWorkspaceRedirect` fires only when the URL hash is empty.
**Status:** COMPLETE · HIGH

### B13 — "Open with fresh terminals"
Reuses a saved Workspace but forces new PTY sessions (`WorkspaceScreen.tsx:52`). **Status:** COMPLETE · MEDIUM

### B14 — Workspace startup command
The wizard's startup command runs once in the first pane after its session goes live, guarded by a `sessionStorage` flag so it never re-fires on restore.
**Status:** COMPLETE · HIGH

---

## C. Multi-Window & Multi-Monitor (11)

### C1 — Detach a workspace to its own OS window
`detach_workspace` → new `WebviewWindow` labelled `ws-<workspaceId>`; the renderer detects the label and renders `DetachedWorkspaceWindow` instead of the router.
**Status:** COMPLETE · HIGH

### C2 — Attach a detached workspace back
`attach_workspace` + `workspace-attach-requested` event → main window navigates to the workspace. **Status:** COMPLETE · HIGH

### C3 — Exclusive interactive lease
`claim_workspace_lease` issues a token; `assert_input_allowed` gates `write_terminal_input` and `resize_terminal_session`. Two windows can display one Workspace; only one can type into it.
`window_registry.rs:154-247`, enforced at `terminal_commands.rs:65,81`. Tested.
**Status:** COMPLETE · HIGH — a genuinely well-designed invariant.

### C4 — Two-phase handoff with rollback
`begin_handoff` → `commit_handoff` / `rollback_handoff`, plus `complete_workspace_handoff` / `fail_workspace_handoff` commands.
**Status:** COMPLETE · HIGH

### C5 — Window registry hydration from disk
`hydrate_from_disk()` rebuilds detached bookkeeping from `workspace_placements` at boot; best-effort so a stale placement never blocks startup.
**Status:** COMPLETE · HIGH

### C6 — Detached window restoration at boot
`lib.rs:474-503` rebuilds each detached window with persisted geometry and paints native dark chrome before showing it.
**Status:** COMPLETE · HIGH

### C7 — Monitor enumeration and aliasing
`list_monitors`, `set_monitor_alias` → `monitor_aliases`. `reconcile_monitor_identity` migrates legacy monitor ids to stable ones.
**Status:** COMPLETE · HIGH

### C8 — Move workspace to another monitor
`move_workspace_to_monitor`. **Status:** COMPLETE · MEDIUM

### C9 — Off-screen window recovery
`recover_offscreen_detached` + `recover_workspace_windows` + `MonitorRecoveryWatcher.tsx` (polling sweep) bring back windows stranded on a disconnected display.
**Status:** COMPLETE · HIGH

### C10 — Window geometry persistence
`persist_workspace_window_geometry`. **Status:** COMPLETE · HIGH

### C11 — Native dark window chrome
`window_chrome.rs` uses `windows-sys` DWM APIs so the OS caption is painted before the window is visible.
**Status:** COMPLETE · HIGH (Windows only)

---

## D. Terminal System (16)

### D1 — Create a terminal session
`create_terminal_session` → `CommandBuilder` (argv array, **no shell interpolation**) → `portable-pty` → `terminal_sessions` row.
**Status:** COMPLETE · HIGH

### D2 — Shell detection
`detect_shells` discovers `pwsh`, `cmd`, WSL distributions. **Status:** COMPLETE · HIGH

### D3 — Custom shell profiles
`save_custom_shell`, `validate_custom_executable` → `shell_profiles`. **Status:** COMPLETE · MEDIUM

### D4 — Agent CLI detection
`agent_detector.rs` (601 LOC) probes `claude`, `codex`, `opencode` — including `.ps1` npm shims on Windows — with version parsing and a scoped-thread parallel probe. `detect_agents`, `list_agent_profiles`.
**Status:** COMPLETE · HIGH

### D5 — Terminal input
`write_terminal_input`, lease-gated. **Status:** COMPLETE · HIGH

### D6 — Terminal output streaming
A bounded `sync_channel` (`OUTPUT_QUEUE_DEPTH`) between the PTY reader thread and the emitter thread; `dropped_output_bytes` is recorded when the queue saturates rather than silently losing data.
`terminal-output` event → `runtimeStore.ts` → xterm.
**Status:** COMPLETE · HIGH

### D7 — Resize / PTY geometry
`resize_terminal_session`, lease-gated. **Status:** COMPLETE · HIGH

### D8 — Machine-protocol mode
Agent panes are created with fixed `MACHINE_PROTOCOL_ROWS/COLS` so provider JSONL is not line-wrapped by ConPTY.
**Status:** COMPLETE · HIGH — a subtle, correct decision.

### D9 — Agent state detection
Per-session 5 s poller + an output-signal buffer classify the agent as working/idle/waiting, emitted as `agent-state`.
`terminal_manager.rs:706-1340`. **Status:** FUNCTIONAL-INCOMPLETE · MEDIUM — states are derived from output heuristics and a timer, not a provider contract; accuracy not verifiable statically.

### D10 — Provider session identity discovery
A per-session thread polls up to 80 times to discover the provider's own session id (for later resume).
**Status:** COMPLETE · MEDIUM

### D11 — Exit watcher
Dedicated thread per session polling `try_wait` every 100 ms; emits `terminal-exit` with the exit code.
**Status:** COMPLETE · HIGH

### D12 — Output logging + retention
`output_log` per session, `output_log_retention` setting (`tail_only` default). **Status:** COMPLETE · MEDIUM

### D13 — Terminate session / workspace sessions / all
`terminate_terminal_session`, `terminate_workspace_sessions`, `terminate_all_sessions()` on exit.
**Status:** COMPLETE · HIGH

### D14 — Session restoration
`RestorationScheduler` + `restore_workspace_sessions` + `restoration-progress` event, with a **circuit breaker** (`reset_restoration_circuit`) and a `restoration_launch_budget` setting.
**Status:** COMPLETE · HIGH

### D15 — Drop an image into a terminal
`save_dropped_image` writes the image and `terminalImageInput.ts` types the path into the agent.
**Status:** COMPLETE · MEDIUM

### D16 — Pane menu / terminal actions
`PaneMenu.tsx`, `terminalActions.ts` — split, close, focus, provider switch. **Status:** COMPLETE · HIGH

---

## E. Code Surface — Files & Editor (12)

### E1 — Docked tool panel
A resizable right-hand panel beside the terminal canvas. Width changes are rAF-throttled and mutate only a CSS variable, so **terminals never remount** (`WorkspaceScreen.tsx:327`).
**Status:** COMPLETE · HIGH — deliberately engineered against remount churn.

### E2 — Surface registry
4 singleton surfaces: Files, Browser, Diff, Agents (`surfaceRegistry.ts`). Terminal is deliberately excluded (it lives on the canvas).
**Status:** COMPLETE · HIGH

### E3 — File explorer
`list_project_directory`, lazy expansion, file-type icons, `MAX_DIRECTORY_ENTRIES = 5,000`.
**Status:** COMPLETE · HIGH

### E4 — Monaco editor pane
`MonacoEditorPane.tsx` with language detection and theme binding. **Status:** COMPLETE · HIGH

### E5 — Editor tabs + dirty state
`editorStore.ts` (433 LOC, tested). **Status:** COMPLETE · HIGH

### E6 — Optimistic-concurrency save
`write_project_file` takes `expected_sha256`; a mismatch returns `file_changed_since_read` rather than clobbering.
**Status:** COMPLETE · HIGH — a genuinely correct design.

### E7 — External-change detection
`SelfWriteLedger` (2 s TTL, origin-stamped) lets the watcher distinguish Paralith's own writes from external edits. `project-file-changed` event.
**Status:** COMPLETE · HIGH

### E8 — File operations
create file, create directory, rename/move, copy, delete — all path-guarded; rename refuses to clobber an existing destination.
**Status:** COMPLETE · HIGH

### E9 — Quick Open (Ctrl+P)
`QuickOpen.tsx` + `fuzzy.ts` (tested) over `search_project_files`, which skips symlinked directories, excludes `NON_SOURCE_DIRECTORIES`, and caps at `MAX_INDEXED_FILES = 20,000`.
**Status:** COMPLETE · HIGH

### E10 — Binary detection and size limits
8 KB sniff; `MAX_TEXT_FILE_BYTES = 5 MB`. **Status:** COMPLETE · HIGH

### E11 — Diff surface
`DiffSurface.tsx` — working-tree review inside the panel, with "open full Repository" escape hatch.
**Status:** FUNCTIONAL-INCOMPLETE · MEDIUM — review and navigation only; staging/commit require the full Repository route.

### E12 — Agents surface
`AgentsSurface.tsx` — live agent activity per pane, click-to-focus a pane's terminal.
**Status:** COMPLETE · MEDIUM

**Absent (verified):** find/replace across files, multi-cursor beyond Monaco defaults, editor-side diagnostics/LSP, merge-conflict resolution UI, split editor panes.

---

## F. Embedded Browser (10)

### F1 — Native child webview browser
`WebviewBuilder` adds a child webview beside the canvas (requires Tauri `unstable`). One per Workspace, reused across tool switches so page state survives.
**Status:** COMPLETE · HIGH

### F2 — Scheme allow-list
Only `http`/`https` navigate; `file:`, `javascript:`, `data:`, `about:`, `blob:` are refused in the navigation hook.
`browser_service.rs:17-20`. **Status:** COMPLETE · HIGH — a real, enforced security boundary.

### F3 — Zero-capability isolation
The browser webview label is granted no capability, so `invoke` from a page is denied by the ACL.
**Status:** COMPLETE · HIGH

### F4 — Navigate / reload / stop
`browser_navigate`, `browser_reload`, `browser_stop`. **Status:** COMPLETE · HIGH

### F5 — Address bar + URL normalisation
`browserUrl.ts` (tested) — typed text becomes a URL or a search. **Status:** COMPLETE · HIGH

### F6 — Bounds, visibility, zoom
`browser_set_bounds`, `browser_set_visible`, `browser_set_zoom`; Ctrl +/−/0 shortcuts.
**Status:** COMPLETE · HIGH

### F7 — Inspect mode (element → agent)
An injected script "navigates" to a synthetic non-resolving host with a base64url payload; the navigation hook intercepts, forwards it as `browser-event`, and cancels the navigation so no request is ever made.
`browser_service.rs:22-30`, `browserInspectBridge.ts`, `inspectContext.ts` (302 LOC, tested).
**Status:** COMPLETE · HIGH — an elegant one-way page→Rust bridge.

### F8 — "Send to active agent"
The sanitised inspect package is typed into the active pane's terminal **without a trailing newline**, so it can never auto-execute in a plain shell (`WorkspaceScreen.tsx:310`).
**Status:** COMPLETE · HIGH

### F9 — URL redaction in logs
`redact_for_log` keeps scheme+host+path only; query strings, fragments and embedded credentials never reach the log file.
**Status:** COMPLETE · HIGH

### F10 — Browser session store
Zoom, current URL, history state per workspace (`browserSessionStore.ts`, tested).
**Status:** COMPLETE · HIGH

**Absent (verified):** browser tabs (one view per Workspace), back/forward UI buttons (history state is stored but no verified UI control), DevTools, download handling, cookie/session management, console/network inspection, screenshot capture.
**Status of those:** NOT PRESENT — do not assume from the "Browser" name.

---

## G. Git (12)

### G1 — Repository inspection
`inspect_repository` — branch, ahead/behind, staged/unstaged/untracked/conflicted counts. **Status:** COMPLETE · HIGH

### G2 — Branch listing
`list_repository_branches`. **Status:** COMPLETE · HIGH

### G3 — Diff viewing
`get_repository_diff` + `DiffViewer.tsx`. **Status:** COMPLETE · HIGH

### G4 — History and commit detail
`get_repository_history`, `get_repository_commit_detail`. **Status:** COMPLETE · HIGH

### G5 — 36 typed repository operations
Stage/unstage paths, **stage hunks** (patch via stdin), restore, branch create/switch/delete, checkpoint, commit, amend, fetch, pull (rebase/ff-only), push (with `--force-with-lease`), publish, tag create/delete, stash create/apply/pop, revert, cherry-pick, rebase, merge (ff-only/no-ff), worktree create/remove, and 13 GitHub operations.
`models/repository.rs:79-292`. **Status:** COMPLETE · HIGH

### G6 — Operation queue with cancellation and timeout
`execute_repository_operation`, `cancel_repository_operation`, `get_repository_operation`; `repository-operation-progress` event; per-run timeout and `AtomicBool` cancellation checked every 25 ms.
**Status:** COMPLETE · HIGH

### G7 — Approval policy
`get_repository_policy` / `save_repository_policy` / `list_repository_approvals` / `decide_repository_approval`; `repository-approval-required` and `repository-approval-decision` events.
**Status:** COMPLETE · HIGH

### G8 — Worktree leases for agents
`CreateAgentWorktree { branch, base_commit, agent_id, task_id, file_scope, expires_at }`, `list_repository_worktree_leases`, `RemoveWorktree`.
**Status:** COMPLETE · HIGH

### G9 — Worktree conflict risk
`get_worktree_conflict_risks` — overlapping file scope between concurrent agent worktrees.
**Status:** COMPLETE · MEDIUM

### G10 — Per-pane Git review
`get_pane_git_review`, `stage_pane_file`, `restore_pane_file`, `create_isolated_pane_worktree` — Git scoped to one terminal pane's branch/worktree, honouring the rule that one global branch does not describe every terminal.
**Status:** COMPLETE · HIGH

### G11 — Interrupted-operation recovery
`repository.recover_on_startup()` inspects `repository_operations` for interrupted runs at boot.
**Status:** FUNCTIONAL-INCOMPLETE · MEDIUM — it detects and logs interrupted operations; the audit found no automatic resume path, and `repository_recovery_checkpoints` is an **orphan table**.

### G12 — Stderr redaction
`redact()` strips `Authorization: Bearer …` and `https://user:token@…` from Git stderr before it reaches an error detail. Tested (`repository_service.rs:3867`).
**Status:** COMPLETE · HIGH

---

## H. Repository Command Center — GitHub (11)

All GitHub access goes through the **`gh` CLI**. There is no direct `api.github.com` call and no token stored by Paralith (verified).

### H1 — Provider status
`get_github_provider_status` — is `gh` installed and authenticated. **Status:** COMPLETE · HIGH

### H2 — Remote projection refresh
`refresh_repository_remote_projection` → `repository_remote_cache` + `repository_sync_cursors`; 120 s UI poll; `repository-sync-health` event.
**Status:** COMPLETE · HIGH

### H3 — Pull requests
List + `get_repository_pull_request_detail`; operations: open draft PR, update, mark ready, request review, submit review, resolve review thread, merge (merge/squash/rebase with `--match-head-commit`).
**Status:** COMPLETE · HIGH

### H4 — Workflow runs
List, `get_repository_workflow_run_detail`, `RerunWorkflow`, `CancelWorkflow`. **Status:** COMPLETE · HIGH

### H5 — Releases
`CreateRelease` operation. **Status:** FUNCTIONAL-INCOMPLETE · MEDIUM — create exists; no list/edit/delete surface found.

### H6 — Issues
Fetched into the remote projection; `repositorySelectors.ts` parses them.
**Status:** PARTIAL · MEDIUM — read-only projection; no create/comment/close operation in `RepositoryOperation`.

### H7 — Security surfaces
Dependabot, code-scanning and secret-scanning alerts + rulesets parsed into `SecurityAlertView`.
**Status:** PARTIAL · MEDIUM — read-only; alert dismissal not implemented.

### H8 — Repository intelligence
`refresh_repository_intelligence` / `get_repository_intelligence` (`repository_intelligence.rs`, 1,119 LOC) + `IntelligenceSection.tsx`.
**Status:** FUNCTIONAL-INCOMPLETE · MEDIUM — the `repository-intelligence-updated` event it emits has **no frontend listener** (`repository_commands.rs:449`), so the section only updates when manually refreshed.

### H9 — Merge readiness gate
`evaluate_merge_readiness` + `MergeGate.tsx` — checks, conflicts, approvals. **Status:** COMPLETE · MEDIUM

### H10 — Operation ledger
`OperationLedger.tsx` over `repository_operations` — an inspectable history of every mutation.
**Status:** COMPLETE · HIGH

### H11 — Context rail / stat strip
`ContextRail.tsx`, `RepositoryStatStrip.tsx` — remote category status at a glance. **Status:** COMPLETE · MEDIUM

**Absent (verified):** GitHub webhooks (`repository_webhook_deliveries` is an orphan table), GitHub App installation flow (`repository_provider_installations`, `repository_provider_accounts` are orphan tables), Actions artifact download, repository graph browsing (`repository_graph_*` tables exist and are written, but no UI was found).

---

## I. Database Studio (14)

### I1 — Source discovery
`database_discover_sources` scans the Project for databases via compose services, connection config, SQLite files, ORM code usage, and explicit profiles.
`database_studio/discovery.rs` (1,100 LOC). **Status:** COMPLETE · HIGH

### I2 — Source relevance classification + evidence
`database_source_evidence`, `database_object_provenance` record *why* a source was inferred.
**Status:** COMPLETE · HIGH

### I3 — SQLite introspection
`database_introspect_sqlite_file`, `sqlite_introspect.rs`. **Status:** COMPLETE · HIGH

### I4 — Declared-schema extraction (ORM)
Prisma and Drizzle schemas parsed into a common graph (`adapters.rs`, 3,125 LOC).
**Status:** COMPLETE · HIGH

### I5 — Schema graph
`database_get_schema`, `database_get_object` — tables, columns, PKs, FKs, unique constraints, indexes, referential actions.
**Status:** COMPLETE · HIGH

### I6 — ER canvas
`SchemaCanvas.tsx` + `TableNode.tsx` + a **layout web-worker** (`layoutWorker.ts`, `layoutCore.ts`) with a large-schema benchmark test (`largeSchema.bench.test.ts`).
**Status:** COMPLETE · HIGH

### I7 — Canvas layout persistence
`database_save_layout` / `database_get_layout` → `database_layouts`. **Status:** COMPLETE · HIGH

### I8 — Declared-vs-observed comparison
`database_compare` — drift between the ORM schema and the live database.
**Status:** COMPLETE · HIGH

### I9 — Migration listing
`database_list_migrations`. **Status:** COMPLETE · HIGH

### I10 — Code usage references
`database_list_usage` → `database_usage_refs` — where a table is used in code. **Status:** COMPLETE · MEDIUM

### I11 — Health and issues
`database_list_issues`, `health.rs`, `HealthSection.tsx`, plus `LayerUnavailableNotice.tsx` for honest unavailable states.
**Status:** COMPLETE · HIGH

### I12 — Design drafts with review workflow
`database_create_draft` → `database_apply_design_operation` → `database_approve_design` / `database_reject_design` / `database_archive_design`, versioned by `database_design_revisions` + `database_design_operations`.
**Status:** COMPLETE · HIGH

### I13 — Repository-native implementation
`database_implement_design` runs: approved target → declared current → semantic delta → risk classification → **repository-native change** (Prisma schema or SQL migration in the repo's existing style) → repository write → re-extraction → independent target-vs-result comparison.
Two absolute rules enforced: `DESIGN_ONLY` never reaches the write path; a destructive change requires acknowledgement of that exact change set.
`pipeline/execute.rs`, `pipeline/native.rs`. **Status:** COMPLETE · HIGH — this is real schema authoring, not visualisation.

### I14 — Agent context pack for schema
`database_build_context_pack`, `context_pack.rs`, `agent_ops.rs`. **Status:** BACKEND-ONLY · MEDIUM — a command exists and is called from the DB UI, but no evidence it is injected into an agent launch.

**Important scope fact:** Database Studio **writes migrations into the repository**; it does not execute DDL against a live production database. `supported_engine()` gates generation to engines whose DDL Paralith knows how to spell (Postgres, SQLite; MySQL present in the enum).

---

## J. Memory / Context Fabric (16)

### J1 — Memory items with revisions
`memory_save`, `memory_get`, `memory_list`, `memory_history`, `memory_revision_body` → `memory_items` + `memory_revisions`. Every edit is a new revision.
**Status:** COMPLETE · HIGH

### J2 — Full-text search
`memory_search` over an FTS index (`database/search.rs`, 832 LOC). **Status:** COMPLETE · HIGH

### J3 — Claims with sources
`memory_save_claim`, `memory_delete_claim`, `memory_attach_source` → `memory_claims`, `memory_claim_sources`, `memory_sources`, `memory_revision_sources`.
**Status:** COMPLETE · HIGH

### J4 — Relations and link graph
`memory_save_relation`, `memory_delete_relation`, `memory_connections`, `memory_graph` → `memory_relations`, `memory_links`.
**Status:** COMPLETE · HIGH

### J5 — Memory graph visualisation
`MemoryGraph.tsx` + `memoryGraphLayout.ts` (hand-rolled layout, tested). **Status:** COMPLETE · HIGH

### J6 — Quality, pinning, archiving
`memory_set_quality`, `memory_set_pinned`, `memory_archive`. **Status:** COMPLETE · HIGH

### J7 — Staleness marking
`memory_mark_stale` — both manual and automatic (see J9). **Status:** COMPLETE · HIGH

### J8 — Impact analysis
`memory_impact`, `memory_analyze_impact` — which memories a set of changed paths affects. **Status:** COMPLETE · HIGH

### J9 — Automatic change→impact→staleness loop
`file change → debounced batch → knowledge job → impact report → staleness policy → memory_mark_stale → memory-knowledge-updated event`.
Enforced properties: nothing runs on the UI or watcher thread; the queue coalesces per Project; `staleness_decision()` is a **pure function with no database, no clock, no model**, returning what it flagged *and what it refused to flag, with reasons*.
`knowledge_lifecycle.rs:1-30`, `MAX_PATHS_PER_JOB` bound. **Status:** COMPLETE · HIGH — the best-designed subsystem in the repository.

### J10 — Durable knowledge job queue
`memory_jobs`, `memory_job_cancel`; 4 job kinds (`AnalyzeImpact`, `AnalyzeProject`, `ProcessCandidates`, `ExtractHandoff`); one worker thread; retry state survives a crash because the worker starts at boot, not on Project open.
**Status:** COMPLETE · HIGH

### J11 — Deterministic project analysis
`knowledge_analyze_project` → `project_analyzer.rs` (1,568 LOC) walks the Project and records what it is built from. Re-triggered only by shape-changing paths (manifests), never by an ordinary source save.
**Status:** COMPLETE · HIGH

### J12 — Candidate → review pipeline
`knowledge_candidates`, `knowledge_review_queue`, `knowledge_decide_candidates` → `knowledge_candidates`, `knowledge_candidate_evidence`. Only a **deterministic reading of the repository** earns an automatic write; a model's proposal never does (`knowledge_intelligence.rs:286`).
**Status:** COMPLETE · HIGH

### J13 — Conflict detection and resolution
`knowledge_conflicts`, `knowledge_resolve_conflict` → `knowledge_conflicts`. Distinguishes temporal change from contradiction, and ranks deterministic evidence above inferred.
**Status:** COMPLETE · HIGH

### J14 — Timeline and actors
`knowledge_timeline`, `knowledge_timeline_actors` → `knowledge_timeline` + `MemoryTimeline.tsx`, `MemoryActivity.tsx`.
**Status:** COMPLETE · HIGH

### J15 — Agent handoffs → knowledge
`knowledge_handoffs`; `agent_handoff.rs` turns a finished Swarm agent run into a structured handoff (**never fabricating a field** — a run with no tests reports no tests), which `ExtractHandoff` converts into candidates under the same policy.
**Status:** COMPLETE · HIGH — but **only Swarm runs feed it**; ordinary terminal agents do not (see `07-AGENTIC-SYSTEMS.md` §6).

### J16 — Markdown mirror
`memory_markdown.rs` writes memories to disk as Markdown via the origin-stamped write path so the mirror never triggers its own impact analysis.
**Status:** COMPLETE · HIGH

### J17 — Context pack compilation (preview only)
`context_compile` → `ContextCompiler` (1,621 LOC): retrieval, ranking, token budgeting, citations, staleness handling.
**Only caller:** `MemoryContext.tsx` — a human-facing preview panel.
**Status:** **BACKEND-ONLY for its intended purpose · HIGH** — the compiler works and is reachable, but nothing that launches an agent uses it.

### J18 — Structured knowledge query
`knowledge_parse_query`, `knowledge_search` → `query_engine.rs` (883 LOC). **Status:** COMPLETE · MEDIUM

### J19 — Health reports
`knowledge_health_report`, `memory_health`, `knowledge_understanding`, `memory_vocabulary`. **Status:** COMPLETE · MEDIUM

---

## K. Code Graph (5) — **BACKEND-ONLY**

`code_parser.rs` (1,282 LOC) + `code_intelligence.rs` (488) + `database/code.rs` (642) + 4 tables (`code_files`, `code_symbols`, `code_imports`, `code_references`) + `code_index_state`, kept current incrementally by the file watcher.

| Feature | Command | Frontend caller |
|---|---|---|
| K1 Index state | `code_index_state` | **none** |
| K2 Reindex | `code_reindex` | **none** |
| K3 Symbol search | `code_search_symbols` | **none** |
| K4 File symbols / symbol detail | `code_file_symbols`, `code_symbol_detail` | **none** |
| K5 Dependencies / impact / files | `code_dependencies`, `code_impact`, `code_files` | **none** |

**Status: BACKEND-ONLY · HIGH.** All 8 commands are registered in `lib.rs` and have zero `invoke` sites in `src/`. Verified by exhaustive diff of registered vs. called commands. Symbol identity is a content-addressed hash of (project, path, kind, container, name) so references survive a reindex — the design is sound; it simply has no consumer.

---

## L. Semantic Index (5) — **BACKEND-ONLY**

`embeddings.rs` (477 LOC, `reqwest` client to a configurable embedding provider) + `semantic.rs` + `database/embeddings.rs` + `knowledge_embeddings` table.

| Feature | Command | Frontend caller |
|---|---|---|
| L1 Status | `semantic_status` | **none** |
| L2 Save settings | `semantic_save_settings` | **none** |
| L3 Regenerate | `semantic_regenerate` | **none** |
| L4 Clear | `semantic_clear` | **none** |
| L5 Nearest neighbour | `semantic_nearest` | **none** |

**Status: BACKEND-ONLY · HIGH.** One adjacent command, `knowledge_semantic_health`, *is* called (`memory/api.ts:146`), so the Memory UI can display embedding health — but cannot configure, regenerate, clear or query the index. Design intent (`lib.rs:41`) is that semantic "contributes candidates; never reranks a deterministic result".

---

## M. Swarms / Multi-Agent (18)

### M1 — Swarm creation with roles
`create_swarm`, `preview_swarm_launch`; roles include Planner/Builder/Reviewer/Debugger/Integrator (`SwarmRole`), with `may_write_code()` gating.
**Status:** COMPLETE · HIGH

### M2 — Role pools (multiple agents per role)
`swarm_role_allocations`, `RolePoolEditor.tsx`. **Status:** COMPLETE · HIGH

### M3 — Presets
`list_swarm_presets`, `save_swarm_preset`, `delete_swarm_preset` → `swarm_presets`. A launched Swarm snapshot is immutable when its preset is later edited (tested: `launched_snapshot_is_immutable_when_its_preset_is_edited`).
**Status:** COMPLETE · HIGH

### M4 — Execution defaults + model config
`get/save/apply_swarm_execution_defaults`, `validate_swarm_member_model_config`, `update_swarm_member_model_config`, `list_swarm_model_registry`.
**Status:** COMPLETE · HIGH

### M5 — Runtime readiness gate
`list_swarm_runtime_readiness` — a Swarm may be *saved* with an unavailable runtime but not *launched* with one.
**Status:** COMPLETE · HIGH

### M6 — Background scheduler
A dedicated `swarm-scheduler` thread ticks every 900 ms; `tick_all_schedulable()`; a failed tick logs and continues rather than killing the scheduler.
**Status:** COMPLETE · HIGH

### M7 — Lifecycle: start/pause/resume/stop/archive/delete
Plus `swarm_lifecycle_history`, `set_swarm_priority`, `retry_swarm`, `add_swarm_builder`.
**Status:** COMPLETE · HIGH

### M8 — Task graph with dependencies
`swarm_tasks`, `swarm_task_deps`. **Status:** COMPLETE · HIGH

### M9 — Real agent execution
`ProductionAgentRuntime.advance()` spawns a provider CLI in a PTY per agent and advances one task per tick. The simulated runtime (`SimAdapter`) is `#[cfg(test)]`-gated — **no fake progress ships**.
**Status:** COMPLETE · HIGH

### M10 — Structured provider event normalisation
`normalize_runtime_events` parses **provider JSONL** (Claude and Codex stream formats) recovered from the transcript: ConPTY control sequences are stripped, only complete JSON objects are accepted, and each provider normaliser whitelists event types. Events are keyed by a SHA-256 of the source line for idempotency.
**Status:** COMPLETE · HIGH — this is a genuine machine protocol, not text scraping.
**Gap:** `SwarmRuntimeKind::Auto => {}` produces **no events at all** (`swarm_service.rs:1165`). An agent configured `Auto` cannot report progress. **Status of `Auto`: BROKEN · MEDIUM.**

### M11 — Worktree isolation
`swarm_worktrees`, `swarm_file_ownership` — parallel agents get isolated Git worktrees with declared file scope.
**Status:** COMPLETE · HIGH

### M12 — Evidence records
`swarm_evidence` with a `verified` flag; reviews require a verified Reviewer trace (`swarm_service.rs:4240`).
**Status:** FUNCTIONAL-INCOMPLETE · HIGH — **`payload_json` is hardcoded to `'{}'` on insert** (`database/swarm.rs:1547`), and `SwarmEvidence` has no payload field. The column exists but no evidence payload is ever stored.

### M13 — Test records and retry
`swarm_test_records`, `retry_swarm_test`, `is_test_command()` recognises 13 test runners. **Status:** COMPLETE · HIGH

### M14 — Reviews
`swarm_reviews` with verdict, risk level, and linked evidence ids. **Status:** COMPLETE · MEDIUM

### M15 — Attention, decisions, messages
`swarm_attention_requests`, `swarm_decisions`, `swarm_messages`; `resolve_swarm_attention`, `resolve_swarm_decision`, `send_swarm_message`, `accept_swarm_result`, `generate_swarm_fix_task`.
**Status:** COMPLETE · HIGH

### M16 — Command drafts
`get/save_swarm_command_draft` → `swarm_command_drafts` — an autosaved composer. **Status:** COMPLETE · MEDIUM

### M17 — Report export
`export_swarm_report` writes a run report to a chosen destination. **Status:** COMPLETE · MEDIUM

### M18 — Recovery and project-close policy
`swarm_recovery_states`, `prepare_project_close`, `ProjectCloseSwarmBehavior`, `swarm_runtime_event_receipts` (idempotent event delivery).
**Status:** COMPLETE · HIGH

### M19 — Global concurrency ceiling
`global_active_limit` caps simultaneously-working agents across all Swarms. **Status:** COMPLETE · HIGH

### M20 — Per-swarm operation lock
`operation_locks: Mutex<HashMap<String, Arc<Mutex<()>>>>` serialises lifecycle and scheduler mutations so a Tauri command and the scheduler cannot race into duplicate task graphs or duplicate provider processes.
**Status:** COMPLETE · HIGH

---

## N. Agent Session Resume (6)

### N1 — Reconcile prior sessions
`reconcile_agent_resume_sessions` discovers resumable provider sessions on disk. **Status:** COMPLETE · MEDIUM

### N2 — List / dismiss / remove
`list_agent_resume_sessions`, `dismiss_agent_resume_session`, `dismiss_all_agent_resume_sessions`, `remove_agent_resume_session`.
**Status:** COMPLETE · HIGH

### N3 — Resume a session
`resume_agent_session` relaunches the provider CLI with its resume flag in a new PTY.
**Status:** COMPLETE · MEDIUM

### N4 — Relocate a moved worktree
`relocate_agent_resume_worktree`. **Status:** COMPLETE · MEDIUM

### N5 — Resume Center overlay
`AgentResumeCenter.tsx`, mounted globally, opened via a custom DOM event. **Status:** COMPLETE · HIGH

### N6 — Swarm provider-session resume
`latest_swarm_provider_session_id` feeds `resume_session_id` into the adapter so a resumed Swarm agent continues its own provider session.
**Status:** COMPLETE · HIGH

---

## O. Orchestration Kernel (6) — **PROTOTYPE**

### O1 — Sessions with a lifecycle state machine
`orchestration_sessions`, `orchestration_turns`, `orchestration_events`, `orchestration_capability_executions`. 14 states declared (`idle`, `understanding`, `collecting_context`, `planning`, `awaiting_approval`, `executing`, `waiting_for_agent`, `verifying`, `paused`, `recovering`, `completed`, `partially_completed`, `cancelled`, `failed`).
**Status:** PARTIAL · HIGH — the state machine and its transition validation are real and backend-authoritative, but **only `pause`, `resume` and `cancel` are exposed**. No code path reaches `planning`, `executing`, `verifying`, or `partially_completed`.

### O2 — Typed capability registry
Exactly **6** capabilities: `project.list`, `workspace.list`, `terminal.list`, `setting.read`, `file.read`, `file.write` (`orchestration/registry.rs`).
**Status:** PROTOTYPE · HIGH

### O3 — Risk / approval policy gate
`orchestration/policy.rs` — every capability execution is validated, policy-evaluated, audited, then dispatched.
**Status:** COMPLETE (for the 6 capabilities) · HIGH

### O4 — Redaction of capability I/O
`orchestration/redaction.rs` redacts before persisting or emitting (tested: `Authorization: Bearer …` → `[redacted]`).
**Status:** COMPLETE · HIGH

### O5 — Message recording
`orchestrator_send_message` → `record_user_turn` persists the turn and emits `transcript_updated`. **It invokes no model and triggers no work.**
**Status:** STUB · HIGH

### O6 — Operating modes UI
`observe | assist | execute | autopilot` selector in `OrchestratorLauncher.tsx:238`.
**Status:** UI-ONLY · HIGH — the selected mode is stored in a Zustand store; no backend behaviour differs by mode.

**Verdict:** the Orchestration Kernel is a well-built *scaffold for* an orchestrator. It is not an orchestrator today. See `07-AGENTIC-SYSTEMS.md` §7.

---

## P. Provider Usage (9)

### P1 — Claude usage snapshot
`usage_service.rs` parses Claude's local usage records into windows with limits and utilisation. Tested against malformed and negative data.
**Status:** COMPLETE · HIGH

### P2 — Codex usage snapshot
Spawns `codex app-server` with `-s read-only -a untrusted`, speaks its JSON protocol over stdin/stdout, converts cumulative counters to deltas. Windows are classified **by duration, not by position** (tested).
**Status:** COMPLETE · HIGH

### P3 — Authentication detection
Checks for `auth.json` under `CODEX_HOME`; returns a typed `Unauthenticated` status rather than fabricating numbers.
**Status:** COMPLETE · HIGH

### P4 — Typed unavailable states
`Unsupported`, `Unauthenticated`, `Error` with stable codes (`codex_cli_missing`, `codex_auth_missing`, …). **No parser failure becomes plausible-looking fake data.**
**Status:** COMPLETE · HIGH — directly satisfies the product's "no invented usage percentages" rule.

### P5 — History and daily rollup
`get_ai_usage_history` → `ai_usage_daily`, `ai_usage_snapshots`, `ai_usage_file_checkpoints`. **Status:** COMPLETE · HIGH

### P6 — Usage status bar
`AiUsageStatusBar.tsx` with a 30 s clock tick for reset countdowns. **Status:** COMPLETE · HIGH

### P7 — Usage page
`/usage` — `UsagePage.tsx`, `DailyUsageChart.tsx`, `UsageBreakdown.tsx`, `UsageMetricStrip.tsx`, `UsageInstrument.tsx`, `RawCostSummary.tsx`.
**Status:** COMPLETE · MEDIUM (partly in-flight on the current branch)

### P8 — Cost estimation
`usagePricing.ts`, `usageCost.ts` (tested). **Status:** FUNCTIONAL-INCOMPLETE · MEDIUM — pricing is a hardcoded frontend table; it will silently drift from vendor pricing.

### P9 — Usage telemetry (system + GitHub)
`usage_telemetry_service.rs` samples system metrics via `sysinfo` and GitHub activity via `gh`. Untracked/new on this branch.
**Status:** PARTIAL · MEDIUM

### P10 — Usage diagnostics
`get_ai_usage_diagnostics` — why a provider reading failed. **Status:** COMPLETE · HIGH

---

## Q. Updates & Recovery (14)

### Q1 — Update status and journal
`get_update_status`, `update_service.rs` (1,266 LOC) with a persisted journal (`phase`, `targetVersion`). **Status:** COMPLETE · HIGH

### Q2 — Check for updates
`check_for_updates`; overlapping checks rejected by the coordinator; 45-min background poll + manual Settings check + one-shot post-startup check.
**Status:** COMPLETE · HIGH

### Q3 — Download with progress
`download_update`, `update-progress` event broadcast to **all** windows via the attached app handle.
**Status:** COMPLETE · HIGH

### Q4 — Signature verification
`tauri-plugin-updater` with a minisign pubkey compiled in per edition; both `release/updater.stable.pubkey` and `release/updater.pubkey` are provisioned with real keys (verified — not placeholders).
**Status:** COMPLETE · HIGH

### Q5 — Safe-restart assessment
`assess_safe_restart` checks for running work before restarting. **Status:** COMPLETE · MEDIUM

### Q6 — Install now / install on exit
`install_downloaded_update`, `install_update_on_exit`; `perform_install(..., true)` runs on `ExitRequested`.
**Status:** COMPLETE · HIGH

### Q7 — Pre-migration database backup
`create_pre_migration_backup` before any schema upgrade when `version>0` and not in recovery. **Status:** COMPLETE · HIGH

### Q8 — Staged backup restore
`apply_staged_restore` at boot; `stage_database_backup_restore` command. **Status:** COMPLETE · HIGH

### Q9 — Recovery mode
`startup_status.recoveryMode` → `RecoveryScreen.tsx`; in recovery, the knowledge worker, repository recovery, detached-window restore and health check are all **skipped**.
**Status:** COMPLETE · HIGH

### Q10 — Safe mode / restart after recovery
`start_in_safe_mode`, `restart_after_recovery`, `retry_update`. **Status:** COMPLETE · MEDIUM

### Q11 — Post-update health confirmation
`confirm_healthy_startup` → if the journal reached `healthy_startup_confirmed` for the current version, the "What's new" banner shows.
**Status:** COMPLETE · HIGH

### Q12 — Legacy profile migration
`com.forgemind.workspace` → `com.corelith.paralith`, one-time, run **before** the logger initialises so the new log file cannot make the destination look non-empty.
**Status:** COMPLETE · HIGH

### Q13 — Metadata repair + quarantine
`repair_metadata()` at boot, `repair_database_metadata` command, `metadata_quarantine` + `migration_repair_history` tables.
**Status:** COMPLETE · HIGH

### Q14 — Preview channel
`tauri.preview.conf.json`, `PREVIEW_IDENTIFIER`, `release/updater.pubkey`, `build:preview`, `ProductEdition::Preview`.
**Status:** PARTIAL · HIGH — the edition is fully implemented in the app, but **there is no `release-preview.yml` workflow**. Only Stable can actually be published.

---

## R. Diagnostics & Support (4)

### R1 — Diagnostics panel
`get_diagnostics` + `DiagnosticsDrawer.tsx`. **Status:** COMPLETE · HIGH

### R2 — Health check
`run_health_check` — readiness checks including `git` presence and agent detection. **Status:** COMPLETE · HIGH

### R3 — Redacted support bundle
`export_redacted_support_bundle`. **Status:** COMPLETE · MEDIUM

### R4 — Rotating file log
5 MB, `KeepOne`, in the platform log dir; stdout additionally in debug builds. **Status:** COMPLETE · HIGH

---

## S. Settings, Theme, Shell (10)

### S1 — Settings screen
`/settings` — 39 persisted fields in `AppSettings`. **Status:** COMPLETE · HIGH

### S2 — 5 themes
`paralith-dark`, `graphite`, `obsidian`, `ember`, `arctic-light`; 151 design tokens. **Status:** COMPLETE · HIGH

### S3 — System-appearance follow + cross-window sync
`theme/system.ts`; `theme-changed` event keeps every window in sync. **Status:** COMPLETE · HIGH

### S4 — Pre-mount theme paint
Inline script in `index.html` applies the cached theme before React mounts. **Status:** COMPLETE · HIGH

### S5 — UI scale and density
`--ui-scale` CSS variable, `data-density` attribute. **Status:** COMPLETE · HIGH

### S6 — Sidebar preferences
Grouping (`project`/`flat`), sort (`manual`/`attention`), width, collapsed groups; persisted server-side and broadcast via `sidebar-preferences-changed`.
**Status:** COMPLETE · HIGH

### S7 — Sidebar attention routing
`sidebarAttention.ts`, `sidebarAgentStatus.ts` (tested) surface which Workspace needs the user.
**Status:** COMPLETE · HIGH

### S8 — Collapsed sidebar rail
`CollapsedSidebar.tsx`. **Status:** COMPLETE · HIGH

### S9 — Terminal appearance settings
Font family/size, line height, cursor style, scrollback, copy-on-select, paste confirmation. **Status:** COMPLETE · HIGH

### S10 — Inactive-workspace policy
`inactive_workspace_processes` (`keep_running`), `inactive_workspace_rendering` (`hibernate`). **Status:** COMPLETE · MEDIUM

---

## T. Dead, legacy and unreachable (11)

| # | Item | Evidence | Status |
|---|---|---|---|
| T1 | MCP capability fabric | `mcp_clients`, `mcp_permissions`, `mcp_audit`, `mcp_tasks`, `mcp_server_state` — 5 tables, zero code references | DEAD (planned) |
| T2 | Bases | `bases`, `base_views` — zero code references | DEAD (planned) |
| T3 | Canvases (knowledge) | `canvases`, `canvas_nodes`, `canvas_edges` — zero references (the `canvases` field in `database_studio/runtime.rs` is an unrelated in-memory map) | DEAD (planned) |
| T4 | Skills | `skills`, `skill_activations` — only `.paralith/skills/` *paths* are referenced, never the tables | DEAD (planned) |
| T5 | Missions | `missions`, `mission_sessions` — zero references; `missions` matches are prose in comments | DEAD (legacy) |
| T6 | `mission_tasks` zombie FK | `database/repository.rs:475` validates `task_id` against `mission_tasks`, a table nothing populates ⇒ `valid_task` is always `NULL` | **BROKEN · HIGH** |
| T7 | Verification profiles | `verification_profiles`, `verification_checks`, `verification_results` — zero references | DEAD (planned) |
| T8 | Usage alerting / windows / events | `usage_alerts`, `usage_alert_prefs`, `usage_events`, `usage_limit_events`, `usage_profiles`, `usage_providers`, `usage_reset_observations`, `usage_snapshots`, `usage_windows` — 9 tables superseded by the `ai_usage_*` tables | LEGACY |
| T9 | Second evidence model | `evidence_records`, `acceptance_criteria`, `task_acceptance_criteria`, `task_dependencies`, `task_events` — superseded by `swarm_evidence` etc. | LEGACY |
| T10 | GitHub App / webhooks | `repository_provider_accounts`, `repository_provider_installations`, `repository_webhook_deliveries` — zero references (GitHub is `gh`-CLI-only) | DEAD (planned) |
| T11 | `repository-intelligence-updated` event | emitted at `repository_commands.rs:449`; **no `listen()` anywhere in `src/`** | DEAD |

Also legacy but harmless: crate name `forgemind`, lib name `forgemind_lib`, and thread-name prefix `forgemind-*` in shipped logs.

---

## U. Capabilities that do NOT exist (verified absent)

These are named in adjacent industry products or implied by feature names; the audit confirms they are **not implemented**:

- Notification centre, toast system, OS notifications, unread badges, persisted notifications
- Global command palette; global keyboard-shortcut registry (only per-surface handlers: Ctrl+P, Ctrl+Shift+S, Ctrl+, , Ctrl+Shift+G, Ctrl+L/R/+/−/0)
- Browser tabs, DevTools, downloads, cookie management, console/network inspection, screenshot capture
- Any direct LLM API client (Anthropic/OpenAI/other)
- LSP / editor diagnostics / find-in-files / merge-conflict resolution UI
- Telemetry, analytics or crash reporting to any remote service
- Plugin/extension system
- macOS or Linux packaging (Windows-only `bundle.targets`, Windows-only chrome APIs)
- Mission Control as a distinct product surface — **no mission UI, route, store or live table exists**; only orphan schema. (Requested Phase 11 answer: Mission Control does **not** exist in this build; the Orchestration Kernel is the only thing occupying that conceptual space, and it is a prototype.)
