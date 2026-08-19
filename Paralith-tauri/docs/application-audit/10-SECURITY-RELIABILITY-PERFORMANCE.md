# 10 — Security, Reliability, Performance, Observability

Defensive architectural audit. No exploitation was performed and no offensive procedure is described.

---

## 1. Security posture summary

Paralith's security model is unusually coherent for its stage. Three decisions carry most of the weight:

1. **No credentials are held.** No LLM API key, no GitHub token, no OAuth flow. Provider authentication lives entirely in the vendor CLIs (`claude`, `codex`, `gh`). Paralith cannot leak what it does not store.
2. **No shell interpolation, anywhere.** All 14 process-spawn sites pass argv arrays. There is no `sh -c`, no `cmd /c "<composed string>"`, no user string ever reaching a shell parser.
3. **Guards are architecture, not checks.** Path containment, window authority, workspace leases and browser isolation are all enforced in Rust at the command boundary, not in the renderer.

### Findings by severity

| Severity | Count | Items |
|---|---|---|
| Critical | **0** | — |
| High | **0** | — |
| Medium | 2 | S-M1, S-M2 |
| Low | 3 | S-L1, S-L2, S-L3 |
| Hardening | 5 | S-H1 … S-H5 |

---

## 2. Filesystem containment (the primary trust boundary)

`ProjectPathGuard` (`services/filesystem_service.rs:528-617`).

### 2.1 `normalize_relative` — input rejection

| Attack class | Handling |
|---|---|
| `..` traversal | **rejected** — any `..` component errors with `Path traversal is not permitted` |
| NUL byte injection | **rejected** — `unified.contains('\0')` |
| Windows drive prefix (`C:\…`) | **rejected** — any component containing `:` |
| Scheme injection (`file:`, `\\?\`) | **rejected** by the same `:` rule |
| UNC (`\\server\share`) | backslashes are normalised to `/`, leading separators collapse, and a `:` in the component is rejected; a `\\server\share` path degrades to `server/share` **under the project root** |
| Absolute POSIX path (`/etc/passwd`) | **neutralised, not rejected** — normalises to `etc/passwd`, resolved under the project root like any relative path. Documented as deliberate. |
| `.` components | stripped |

### 2.2 `resolve_existing` — real-location assertion

```rust
let canonical = canonicalize_plain(&joined)?;      // follows symlinks
if !canonical.starts_with(&self.root) { return Err(path_escape(relative)); }
```

`canonicalize` resolves symlinks, so a symlink inside the project pointing outside it fails the containment check. `canonicalize_plain` additionally strips the Windows `\\?\` verbatim prefix so `starts_with` compares like-for-like — and `Path::starts_with` is **component-wise** in Rust, so a sibling directory named `project-evil` cannot match a root of `project`.

### 2.3 `resolve_new` — create/rename destinations

The parent must exist and pass `resolve_existing`; the leaf is validated by `validate_leaf_name` (rejects empty, `.`, `..`, `/`, `\`, NUL). Because the parent is already canonical-and-contained and the leaf cannot contain a separator, the target is necessarily inside the root.

### 2.4 Write path

`write_file_as` tries `resolve_existing` first and only falls back to `resolve_new` on `file_not_found`. **An existing symlink is therefore always canonicalised and containment-checked before a write.** A symlink pointing outside the project cannot be written through.

### 2.5 Delete path

`delete_entry` uses `fs::symlink_metadata` — it inspects the link itself rather than following it, so deleting a symlink removes the link, not the target.

### 2.6 Verdict

**No path-traversal, symlink-escape, drive-prefix or NUL-injection weakness was found.** This boundary is correctly implemented and tested.

**S-H1 (hardening, LOW):** `resolve_existing` canonicalises and then the caller operates on the path — a classic TOCTOU window. Exploiting it requires an attacker who can already create symlinks inside the user's own project directory, which is not a meaningful threat for a local developer tool. No change recommended; noted for completeness.

**S-H2 (hardening, LOW):** `guard(project_id)` performs a database read on **every** filesystem operation to fetch the project root. Correct for safety (the root cannot go stale), but see §5.3.

---

## 3. IPC and window authority

| Boundary | Enforcement | Applies to |
|---|---|---|
| Administrative commands | `require_main_window(&window)` → `main_window_required` error, layer `window_security` (`lib.rs:72-82`) | detached windows blocked |
| Workspace-scoped commands | `WindowRegistry::validate_workspace_caller(workspace_id, label, …)` | browser, database, filesystem, git commands |
| Terminal input/resize | `WindowRegistry::assert_input_allowed(workspace_id, label)` — requires the **exclusive lease** | `write_terminal_input`, `resize_terminal_session` |
| Project-scoped commands | `require_project_scope(&window, &state, project_id)` | memory, intelligence, repository, filesystem, project |
| Embedded browser pages | **no capability granted to the webview label** — `invoke` is ACL-denied | all browser content |

**S-M1 (MEDIUM — maintainability of a security control):** `require_project_scope` is **implemented six times** — `fabric_scope.rs`, `filesystem_commands.rs`, `intelligence_commands.rs`, `memory_commands.rs`, `project_commands.rs`, `repository_commands.rs`. The duplication is acknowledged in comments ("Kept local for the same reason that one is…"), but six copies of an authorisation check is six places for a future divergence. No divergence found today. **Recommendation: consolidate into one module.** *(Documenting only — not implemented as part of this audit.)*

---

## 4. Process execution

### 4.1 Command injection

**None found.** Every spawn site was inspected:

| Site | Form |
|---|---|
| `terminal_manager.rs:250` | `CommandBuilder::new(&spec.executable)` + `.args(argv_vec)` |
| `repository_service.rs:2897` | `background_command(program).args(args.iter().map(OsStr::new))` |
| `usage_service.rs:844` | `Command::new(executable).args(["-s","read-only","-a","untrusted","app-server"])` |
| `agents/adapter.rs:284`, `agent_detector.rs`, `git_commands.rs`, `project_service.rs`, `agent_resume.rs` | argv arrays |

No composed shell string is ever executed.

### 4.2 Executable resolution

- Agent CLIs are located by `which::which(...)` or by an explicit user-configured path (`claude_executable_path`, `codex_executable_path`, `opencode_executable_path`), validated by `validate_custom_executable`.
- Windows `.ps1` npm shims are handled explicitly (`adapter.rs:127`) rather than being launched directly.
- `background_command` sets `CREATE_NO_WINDOW` (`0x08000000`) so no console window flashes.

**S-L1 (LOW):** a user-configured `claude_executable_path` is user-supplied input that becomes an executed binary. This is inherent to the feature (the user is configuring their own tool on their own machine) and `validate_custom_executable` checks it, but it is the widest input→execution path in the product.

### 4.3 Agent sandboxing

Paralith delegates to each vendor's own controls rather than inventing its own:

| Role capability | Claude | Codex |
|---|---|---|
| may write code | `--permission-mode acceptEdits` | `--sandbox workspace-write` |
| read-only | `--permission-mode plan` + `--disallowedTools Edit,Write,NotebookEdit,Task,EnterWorktree,ExitWorktree` | `--sandbox read-only` |
| test execution | `--allowedTools` whitelist of 22 exact test-runner patterns | inherited from sandbox |

**S-M2 (MEDIUM):** the instruction *"Do not push or perform remote Git operations"* is delivered in the **prompt**, not enforced by a hard boundary, for agents running in their own PTY. On Codex, `--sandbox` provides real enforcement. On Claude with `acceptEdits`, the `--allowedTools` whitelist is what actually constrains Bash — and it lists only test runners, so `git push` should be denied. **This was verified statically but not at runtime; confidence MEDIUM.** Recommend a runtime confirmation that an `acceptEdits` agent cannot invoke an un-whitelisted Bash command.

---

## 5. Secrets, logging and redaction

| Channel | Protection |
|---|---|
| Git/`gh` stderr | `redact()` strips `Authorization: Bearer …` and `https://user:token@host/…`; tested (`repository_service.rs:3867`) |
| Browser URLs in logs | `redact_for_log()` keeps scheme+host+path only — query strings (which carry tokens), fragments and embedded credentials are dropped |
| Orchestration capability I/O | `orchestration/redaction.rs` redacts before persisting **and** before emitting; tested |
| Startup diagnostics | explicitly "free of paths, arguments and environment values" (`lib.rs:145`) |
| Support bundle | `export_redacted_support_bundle` |
| CI runner | `sweep-credentials.ps1` as the final release step |
| Signing secrets | environment-scoped to `stable-release`; never echoed |

**S-L2 (LOW):** `AppError.detail` frequently carries a raw `error.to_string()` from the OS or SQLite, which can contain absolute filesystem paths. These reach the renderer and the log file. Not a credential leak, but it does expose the user's directory structure in diagnostics they might share. `redact()` is applied to Git stderr specifically, not to `detail` generally.

**S-L3 (LOW):** the rotating log is 5 MB with `KeepOne` — a single rotation. Under heavy terminal or swarm activity, diagnostic history for an incident may be lost before the user reports it.

---

## 6. Other security surfaces

| Surface | Assessment |
|---|---|
| SQL injection | **Not possible in practice** — every query inspected uses `params![]` / `?N` placeholders. No string-formatted SQL found. |
| Updater | minisign signature verification with a compiled-in per-edition pubkey; HTTPS enforced at config-render time; placeholder keys rejected in release mode; updater plugin not even registered in debug builds |
| Single-instance | registered as the **first** plugin so a second launch cannot start a competing backend against the same SQLite file or PTYs |
| Browser navigation | scheme allow-list enforced in the navigation hook, not the UI |
| Browser → app bridge | one-way only; the inspect payload arrives via an intercepted-and-cancelled navigation to a non-resolving synthetic host |
| Send-to-agent | written without a trailing newline so it cannot auto-execute |
| Repository destructive ops | approval policy + worktree leases + `--force-with-lease` (never bare `--force`) + `--match-head-commit` on merges |
| DB destructive ops | `DESIGN_ONLY` never reaches the write path; destructive changes require acknowledgement of that exact change set |
| External content | the embedded browser is the only path; it has no capability grant |
| Plugin/extension trust | **no plugin system exists** — no third-party code loading surface |

**S-H3 (hardening):** CSP `connect-src` permits any `localhost`/`127.0.0.1` port over `ws`/`http`. Necessary for a developer tool that must reach local dev servers; it does mean the renderer can reach any locally-listening service.
**S-H4 (hardening):** `style-src 'unsafe-inline'` — required by Monaco and dynamic token styles; bounded and conventional.
**S-H5 (hardening):** no rate-limit accounting against the GitHub API; Paralith relies on `gh`'s behaviour. At one refresh per 2 minutes per open Project this is unlikely to matter.

---

## 7. Reliability and concurrency

### 7.1 Locking model

| Lock | Scope | Risk |
|---|---|---|
| `Mutex<Connection>` | **global** — one per application | see §8.1 |
| `RwLock<HashMap<id, TerminalHandle>>` | terminal session registry | fine |
| per-handle `Mutex` (master/writer/child/output_tail/agent_state) | one terminal | fine |
| `operation_locks: Mutex<HashMap<swarm_id, Arc<Mutex<()>>>>` | per swarm | correct — explicitly prevents command/scheduler races |
| `SelfWriteLedger` internal lock | path ledger | fine |
| `RwLock<HashMap<CanvasScope, …>>` | Database Studio canvases | fine |

**Lock-ordering risk:** several paths acquire a per-swarm operation lock and then the global DB mutex. No path was found that acquires them in the opposite order, so no deadlock cycle was identified. **Confidence: MEDIUM** — this was established by reading, not by instrumentation.

### 7.2 Idempotency and de-duplication

| Mechanism | Where |
|---|---|
| Content-hash event keys | `swarm_runtime_event_receipts` — `sha256(line):offset` |
| Job dedup keys | `memory_jobs` — one pending `AnalyzeImpact` per project, one `AnalyzeProject` per project, one `ProcessCandidates` |
| Idempotency key | `repository_operations` — `request.context.idempotency_key` |
| `INSERT OR IGNORE` | `swarm_context_packs` |
| Overlapping-check rejection | update coordinator rejects concurrent `check_for_updates` |

This is a consistently applied discipline.

### 7.3 Crash recovery

| Scenario | Behaviour |
|---|---|
| Crash mid-migration | pre-migration backup exists; `apply_staged_restore` + recovery mode on next boot |
| Crash with jobs `retrying` | worker starts at boot (not on project open) and drains them |
| Crash with a repository operation in flight | detected and logged by `recover_on_startup()`; **not resumed** (`repository_recovery_checkpoints` never written) |
| Crash with swarms running | `swarm_recovery_states` + `Recovering` lifecycle state |
| Corrupt workspace metadata | `repair_metadata()` at boot → `metadata_quarantine` + `migration_repair_history`; a failure is **fatal by design** rather than silently proceeding |
| Stale window placements | `hydrate_from_disk()` is best-effort; a stale placement never blocks startup |
| Orphaned PTYs after a hard crash | **UNKNOWN** — the graceful paths all terminate sessions, but a process kill leaves children. Not verifiable statically. |

### 7.4 Reliability risks

| # | Risk | Confidence |
|---|---|---|
| R1 | Global DB mutex under concurrent scheduler + worker + command load | HIGH (structural) / MEDIUM (impact) |
| R2 | Repository operations detected-but-not-resumed after a crash | HIGH |
| R3 | Orphan PTYs after an ungraceful process termination | MEDIUM |
| R4 | A detached window that fails to claim its lease renders output but silently rejects input | MEDIUM |
| R5 | `SwarmRuntimeKind::Auto` emits no events — an `Auto` agent cannot progress or fail | MEDIUM |
| R6 | A single `ErrorBoundary` means one render error takes down the whole UI | HIGH |

---

## 8. Performance

### 8.1 🔴 The global database mutex

`DatabaseService` holds **one** `Mutex<Connection>`; there are **279 `connection.lock()` sites**.

Contending parties:
- 257 Tauri commands (user-driven)
- the Swarm scheduler, every 900 ms, for every schedulable swarm
- the knowledge lifecycle worker (impact analysis, project walks, candidate processing)
- the file-watch dispatcher
- terminal session recording and output-tail persistence
- Database Studio discovery, which walks the repository

WAL mode is enabled and enforced — but WAL's reader/writer concurrency benefit requires **multiple connections**. With one connection, WAL only helps durability and checkpoint behaviour.

**Concrete scenario:** a `Building`-phase swarm ticking every 900 ms while the knowledge worker analyses impact for a branch switch (bounded by `MAX_PATHS_PER_JOB` but still a batch) while the user types in the editor (each save = a DB read for the path guard, then a write). All of it serialises.

**No profiling was performed**, so the user-visible severity is unmeasured. Structurally, this is the highest-leverage performance item in the codebase, and it is a bounded change: a small connection pool, or splitting the hot read paths onto read-only connections.

### 8.2 Thread scaling

**5 OS threads per terminal session** (`06-RUNTIME-AND-AUTOMATION.md` §1.2). A 4-pane workspace is 20 threads; several open workspaces plus swarm agents can approach 100+. Two of the five per session are pollers (100 ms exit watch, 5 s agent state).

Mitigations already present: the output pipeline uses a bounded channel with explicit drop accounting; the agent-identity thread self-terminates after its poll budget.

### 8.3 Repeated work

| Pattern | Location | Note |
|---|---|---|
| DB read per filesystem op | `filesystem_service.rs:121` `guard()` | correct for safety, cacheable per project with invalidation |
| 25 ms spin while waiting on `git`/`gh` | `repository_service.rs:2975` | `wait-timeout` is already a dependency and would be cheaper |
| Full project walk | `project_analyzer.rs` | **well controlled** — only manifest/shape changes re-trigger it, deduped to one pending job |
| Repository scan for DB discovery | `database_studio/discovery.rs` | cached; invalidated by the file watcher |
| Code reindex | incremental via the watcher | correct |
| Global event broadcasts | `swarm-changed`, `memory-knowledge-updated`, `repository-*` | fan out to every window; payloads are small ids so cost is low |

### 8.4 Frontend performance

**Notably good.** Verified positives:
- The tool-panel divider mutates a CSS variable and the store only — the layout tree is never rebuilt, so **terminals never remount on resize** (`WorkspaceScreen.tsx:327`).
- All route screens are `React.lazy` + `Suspense`.
- The Database Studio canvas layout runs in a **web worker** with a large-schema benchmark test.
- Zustand selectors are used with narrow slices rather than whole-store subscriptions.
- Only 50 inline-`style` sites across 311 files, nearly all dynamic geometry.
- Polling is restrained: 45 min updates, 120 s repository refresh, 30 s clock ticks.

Remaining concerns:
- `WorkspaceScreen.tsx` at 1,169 LOC holds a large amount of state in one component; a change to any of it re-renders the shell (though not the terminals, which are isolated).
- `index.css` is 3,886 lines in one file — parsed once, so a load-time cost only, but a maintainability problem.
- The terminal output path goes bytes → Tauri event (JSON-serialised) → JS → xterm. For a very chatty process the serialisation cost is non-trivial. The bounded channel prevents unbounded growth but back-pressures by **dropping** (accounted for, but still lossy).

### 8.5 Unbounded collections

Searched for; the notable ones are all bounded:

| Collection | Bound |
|---|---|
| Terminal output | `OUTPUT_QUEUE_DEPTH` channel + `output_tail` cap + `dropped_output_bytes` accounting |
| `git`/`gh` output | `read_bounded` + truncation flag |
| Directory listing | `MAX_DIRECTORY_ENTRIES` = 5,000 |
| File search index | `MAX_INDEXED_FILES` = 20,000 |
| Impact job paths | `MAX_PATHS_PER_JOB` |
| Swarm memory context | `LIMIT 8` |
| Operator instructions in prompt | `.take(20)` |
| Log file | 5 MB, `KeepOne` |
| Concurrent agents | `global_active_limit` |

**No unbounded accumulator was found.** This is a well-disciplined area.

---

## 9. Error handling

### 9.1 The model

`AppError` (`errors/app_error.rs`) is a structured, serialisable error:

```rust
pub struct AppError {
    code: String,               // 286 distinct codes
    message: String,            // user-facing
    recoverable: bool,
    detail: Option<Box<str>>,   // diagnostic
    affected_entity: Option<Box<str>>,
    recommended_action: Option<Box<str>>,
    source_layer: Box<str>,     // 41 distinct layers
}
```

**286 distinct error codes across 41 source layers.** Layers include `filesystem_security`, `window_security`, `repository_policy`, `repository_concurrency`, `repository_lease`, `github_provider`, `git_cli`, `update_recovery`, `legacy_data_migration`.

Errors carry a `recommended_action` — e.g. `"Retry the operation or run Diagnostics health check."`

**There is no `"Something went wrong"` path.** The audit specifically searched for generic catch-all messages and found none.

### 9.2 `.unwrap()` discipline

Of 1,481 `.unwrap()` occurrences in the Rust tree, **approximately 6 are outside test modules**:
- `database_studio/adapters.rs:2052,2566` — `content[index..].chars().next().unwrap()` after an index guarantee (safe by construction)
- `database_studio/discovery.rs:598` — `current_model.take().unwrap()` behind an is-some check
- `database_studio/graph.rs:1157-1173` — inside a test-shaped helper (contains `println!`)

For 89k lines of Rust, this is exceptional.

### 9.3 Deliberate error swallowing

491 `let _ = …` / `.ok()` / `unwrap_or_default()` / `unwrap_or_else(|_| …)` sites. Sampling shows these are overwhelmingly **intentional best-effort paths with an adjacent comment explaining why**, e.g.:
- `windows.hydrate_from_disk()` — "a stale placement must never stop the app from opening"
- `updates.retry()` — best effort
- event emission — a failed emit must not fail the operation

**No silently-swallowed error was found on a path where the user needed to know.** The pattern is used correctly.

### 9.4 Frontend error handling

| Aspect | State |
|---|---|
| Typed errors from IPC | `asNativeError` in `native/commands.ts` preserves `code`/`message`/`layer` |
| Display | `ErrorNotice`, `SectionError`, `LayerUnavailableNotice`, `ConnectedPlaceholder` |
| Crash containment | **one** `ErrorBoundary`, in `main.tsx` — a render error anywhere takes down the entire UI |
| `.catch(() => undefined)` | used for genuinely optional background work (update poll, session seeding) |

**Recommendation (documented, not implemented):** per-route and per-surface `ErrorBoundary`s so a Database Studio render failure degrades one panel instead of the application.

---

## 10. Observability

| Capability | State |
|---|---|
| Framework | `tauri-plugin-log` 2 |
| Level | `Info` |
| Destinations | rotating file in the platform log dir (`paralith`), plus stdout in debug builds |
| Rotation | 5 MB, `KeepOne` |
| Duplicate-target guard | `clear_targets()` first, so nothing is logged twice or double-written |
| Structured logging | **partial** — key lifecycle lines use consistent `key=value` form, e.g. `terminal lifecycle workspace_id=… pane_id=… session_id=… provider=… event=started pid=…` (`terminal_manager.rs:341`) |
| Startup diagnostics | `startup_diagnostic(subsystem, message)` writes to both stderr and the log, deliberately excluding paths/args/env |
| Fatal startup | native error dialog + log + `exit(1)` — a released build never vanishes silently |
| Tracing / spans | **none** — no `tracing` crate, no request/operation correlation ids in logs |
| Metrics | **none** |
| Crash reporting | **none** — no remote crash SDK |
| Remote telemetry | **none** (by design) |
| Support bundle | `export_redacted_support_bundle` |
| In-app diagnostics | `get_diagnostics`, `run_health_check`, `DiagnosticsDrawer` |
| Domain-level audit trails | strong — `repository_operations`, `audit_events`, `orchestration_capability_executions`, `swarm_events`, `swarm_lifecycle_history`, `knowledge_timeline`, the update journal |

### Can a developer reconstruct a failure from existing telemetry?

**For domain failures: yes.** The audit tables are rich and durable. A failed repository operation, swarm task or knowledge job leaves a queryable record with status, timing and error detail.

**For runtime failures: partially.** The log has no correlation ids, so relating a terminal event to the swarm task that caused it means matching on `session_id` by hand. There is no tracing, no metrics, and one rotation of 5 MB — a long-running session that fails late may have overwritten the relevant lines.

**For crashes: no.** There is no crash handler, no minidump, no panic hook writing to the log. A Rust panic in a background thread will kill that thread silently (the swarm scheduler is protected against this; other threads are not).

**Highest-value observability gap:** a panic hook that logs the panic with its thread name before the thread dies.
