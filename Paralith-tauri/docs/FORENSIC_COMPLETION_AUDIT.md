# Forensic Completion Audit — 2026-08-23

Verification of Paralith's implementation against `PARALITH_MASTER_ENGINEERING_SPEC.md`.

Method: trace each feature end to end — reachable UI surface → registered IPC → backend service →
persistence → integration → tests — rather than inferring completeness from file existence. Every
status below is backed by a citable symbol, table, route, or command result.

## Scale (measured)

| | |
| --- | --- |
| Rust | ~93k lines, `src-tauri/src` |
| TypeScript/TSX | ~50k lines, `src/` |
| Schema version | 39 (`database::migrations::CURRENT_SCHEMA_VERSION`) |
| Tauri commands | 286 declared, **all reachable** — 235 in `generate_handler!`, 51 via the `fabric_ipc` allow-list |
| Rust tests | 796 passing (+ 4 `#[ignore]`d real-provider canaries) |
| Frontend tests | 857 passing across 97 files |

## Correction to the previous audit

**"53 unregistered commands" would have been wrong.** `commands/fabric_ipc.rs` deliberately routes
51 Context Fabric operations through one typed transport seam (to bound serde monomorphization in
optimized Windows builds) rather than through `generate_handler!`. Those commands are live. The
only two non-registered functions in `commands/` are `require_project_scope` and `worker_failed`,
which are helpers, not commands. **There is no dead IPC.**

---

## Verdicts on previously-claimed-complete features

### VERIFIED COMPLETE

| Feature | Evidence |
| --- | --- |
| Projects registry | `database::get_project` / `upsert_project`, canonical-root uniqueness enforced since migration 3; `ProjectLauncher` route `/` |
| Workspace shell | `workspaces` / `workspace_panes` / layout tree, `WorkspaceScreen`, 12 `window_registry` tests |
| Multi-window / multi-monitor | `services::window_registry` (952 lines) + `database::placement`; exclusive-lease, stale-commit and detach-rollback tests |
| Terminal | `services::terminal_manager` (1856 lines), 17 tests, PTY lifecycle decoupled from React, restoration scheduler |
| Agent Runtime | `agents::adapter` + `agents::invocation`, provider detection, structured event normalization; 8 adapter tests |
| Swarm | `services::swarm_service` (7458 lines), **55 tests** — the most thoroughly verified subsystem in the repository |
| Context Fabric | `services::context_compiler` (2587 lines), 33 tests, `validate_scope`, cached compilation, real provenance persistence |
| Memory / Memory Graph | `services::memory_service` (1571) + `knowledge_intelligence` (1949) + `knowledge_lifecycle` (1284); 90 tests combined |
| Database Studio | `services::database_studio/*` (~9.9k lines), 35+ tests, destructive-change acknowledgement gate |
| Worktree Engine | `repository_worktree_leases` + `RepositoryOperation::CreateAgentWorktree`, idempotency keys, conflict risks |
| Source Control | `services::repository_service` (4313 lines), 20 tests |
| Updater | `services::update_service` (1266 lines) 13 tests + `tests/updater_signature.rs` (signature tamper rejection) |
| Usage | `services::usage_service` + `usage_telemetry_service`, real provider parsing, no synthesized percentages |

### FUNCTIONALLY COMPLETE / NEEDS HARDENING

| Feature | Gap |
| --- | --- |
| Project Explorer | Works and is path-guarded; watch integration present. Keyboard/a11y depth unverified. |
| Development Browser | `services::browser_service` + `BrowserSurface`; child-webview lifecycle real. Downloads and popup policy not evidenced. |
| Element/source inspection | `browserSetInspect` command is live and wired; the visual-to-source bridge depth (spec §36) is not fully realized. |
| GitHub integration | Real remote/PR/workflow surfaces in `features/repository`. Coverage against spec §42 is partial. |
| Diagnostics | `DiagnosticsDrawer` + diagnostics commands are live; not an observability system (spec §75). |
| Agent Profiles / Sessions | `agent_profiles`, `agent_sessions` with `agent_state`, `recovery_status`, `worktree_path`; resume service (614 lines) real. Profile inheritance (spec §19) not implemented. |
| Project Graph / Impact Intelligence | `code_files`/`code_symbols`/`code_references`/`code_imports` + `repository_intelligence`; genuinely built. Impact surfacing is thinner than spec §27. |
| Review infrastructure | Diff/staging/merge-gate components exist; not the Review Center of spec §43. |

### PARTIAL

- **Code Editor** — Monaco is integrated and saving works. **There is no LSP: zero `lsp` references
  in the entire repository.** Spec §14's LSP architecture is not started.
- **Policy Engine** — `orchestration::policy` is a single `evaluate` returning a `GateDecision`.
  Real, but far from spec §65.
- **Home** — **no route exists.** `App.tsx` has no `/home`; `/` is the Project launcher.

### NOT IMPLEMENTED

- **Search** — no global search surface, no command palette. One command,
  `search_project_files`. Spec §15's multi-engine unified search does not exist.
- **Universal command system** — no palette component anywhere in `src/`.
- **Run Profiles / Service Manager**, **Host abstraction**, **WSL** as a host — `AgentProvider::Wsl`
  exists as a terminal provider only.

### STUB / DEAD SCHEMA — the most significant finding

Nineteen tables are created by migrations and have **zero read or write code** outside
`migrations.rs`:

```
missions            mission_tasks       acceptance_criteria     ← retired in migration 39
task_dependencies   task_acceptance_criteria                worktrees   ← retired in migration 39
skills              skill_activations
mcp_clients         mcp_permissions     mcp_audit           mcp_tasks
bases               base_views
canvases            canvas_nodes        canvas_edges
knowledge_branch_merges
```

> **Superseded for the Mission cluster.** Migration 39 retired every table on the first two lines
> and rebuilt Mission Control canonically. See *The gap the Mission Control mission closed* below.
> The remaining names on this list are still dead.

Verification:

```
for t in missions mission_tasks ... ; do
  grep -rn "FROM $t\b|INTO $t\b|UPDATE $t\b|DELETE FROM $t\b" --include=*.rs . | grep -v migrations.rs | wc -l
done
# → 0 for every table listed above
```

This matters for three reasons:

1. It confirms **Mission Control (§22), Task Graph (§23), Skills (§52) and MCP Gateway (§51) are
   NOT IMPLEMENTED**, not "partial" — the schema is a ghost of a plan, not a foundation in use.
2. The `worktrees` table is dead *and misleading*: real worktree state lives in
   `repository_worktree_leases`. Anyone reading the schema would model this wrong.
3. `missions.project_id` is `ON DELETE RESTRICT`, so a table nothing writes can still block
   Project deletion.

None of this is a data-loss or security risk, so per the mission's triage rule it is **recorded,
not fixed** — cleaning it up is its own migration with its own review.

### The gap this mission closed

- **Run Engine (§24)** — was NOT IMPLEMENTED. Now implemented; see `docs/RUN_ENGINE.md`.
- **Agent Inbox (§21)** — was NOT IMPLEMENTED. Query and state foundation now exists
  (`run_inbox_summary`, attention filters, `idx_runs_attention`), surfaced as a working inbox strip
  on the Runs surface. The full fleet-supervision surface remains future work.

Still NOT IMPLEMENTED and untouched by this mission: Long-running Goals, Automations, Proof Ledger,
Verification Orchestrator, QA Mode, Security Review, Visual Verification, Android/iOS Device Lab,
Tasks Queue, Connections, Plugin Platform, SSH, Paralith Node, Mobile Companion, Voice,
Notifications, Ship Center, Credential Vault, Team Mode.

---

## Updated completion map

Judged against what the master spec actually asks for, not against whether code exists.

| Spec | Feature | Status | Frontend | Backend | Persistence | Integration | Tests |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 9 | Home | NOT IMPLEMENTED | — | — | — | — | — |
| 10 | Projects | VERIFIED | ✓ | ✓ | ✓ | ✓ | ✓ |
| 11 | Workspace shell | VERIFIED | ✓ | ✓ | ✓ | ✓ | ✓ |
| 12 | Command system | NOT IMPLEMENTED | — | — | — | — | — |
| 13 | Project Explorer | HARDENING | ✓ | ✓ | ✓ | ✓ | partial |
| 14 | Code Editor | PARTIAL (no LSP) | ✓ | ✓ | ✓ | partial | partial |
| 15 | Search | NOT IMPLEMENTED | — | 1 cmd | — | — | — |
| 16 | Terminal | VERIFIED | ✓ | ✓ | ✓ | ✓ | ✓ |
| 17 | Run Profiles / Services | NOT IMPLEMENTED | — | — | — | — | — |
| 18 | Agent Runtime | VERIFIED | ✓ | ✓ | ✓ | ✓ | ✓ |
| 19 | Agent Profiles | HARDENING | ✓ | ✓ | ✓ | ✓ | partial |
| 20 | Agent Sessions | HARDENING | ✓ | ✓ | ✓ | ✓ | ✓ |
| 21 | Agent Inbox | FOUNDATION | partial | ✓ | ✓ | ✓ | ✓ |
| **22** | **Mission Control** | **FUNCTIONALLY COMPLETE / NEEDS HARDENING** | ✓ | ✓ | ✓ | ✓ | ✓ |
| **23** | **Task Graph** | **FUNCTIONALLY COMPLETE** | ✓ | ✓ | ✓ | ✓ | ✓ |
| **24** | **Run Engine** | **FUNCTIONALLY COMPLETE** | ✓ | ✓ | ✓ | ✓ | ✓ |
| 25 | Context Fabric | VERIFIED | ✓ | ✓ | ✓ | ✓ | ✓ |
| 26 | Project Graph | HARDENING | ✓ | ✓ | ✓ | ✓ | ✓ |
| 27 | Impact Intelligence | PARTIAL | partial | ✓ | ✓ | partial | ✓ |
| 28/29 | Memory + Graph | VERIFIED | ✓ | ✓ | ✓ | ✓ | ✓ |
| 30 | Worktree Engine | VERIFIED | ✓ | ✓ | ✓ | ✓ | ✓ |
| 31 | Swarm | VERIFIED | ✓ | ✓ | ✓ | ✓ | ✓ (55) |
| 34 | Development Browser | HARDENING | ✓ | ✓ | ✓ | ✓ | partial |
| 36 | Element Picker | PARTIAL | partial | ✓ | — | partial | — |
| 40 | Database Studio | VERIFIED | ✓ | ✓ | ✓ | ✓ | ✓ |
| 41 | Source Control | VERIFIED | ✓ | ✓ | ✓ | ✓ | ✓ |
| 42 | Forge integration | HARDENING | ✓ | ✓ | ✓ | ✓ | partial |
| 43 | Review Center | PARTIAL | partial | ✓ | ✓ | partial | partial |
| 48 | Diagnostics | HARDENING | ✓ | ✓ | ✓ | partial | partial |
| 51/52 | MCP / Skills | NOT IMPLEMENTED (dead schema) | — | — | ghost | — | — |
| 60 | Usage | VERIFIED | ✓ | ✓ | ✓ | ✓ | ✓ |
| 63 | Self-update | VERIFIED | ✓ | ✓ | ✓ | ✓ | ✓ |
| 65 | Policy Engine | PARTIAL | — | ✓ | — | partial | partial |
| 54–57 | Hosts / WSL / SSH / Node | NOT IMPLEMENTED | — | — | — | — | — |

**No percentage is given because none would be honest.** Paralith's *execution core* — projects,
workspaces, terminals, agents, worktrees, context, memory, Swarm, and now Runs — is genuinely
strong and well tested. Its *product surface area* against a 115-section spec is early.

## Notable surprises

1. **Swarm was already most of a Run Engine.** `ProductionAgentRuntime` already did worktree
   resolution, context compilation, provider launch, structured completion gating and evidence.
   The gap was not capability — it was that all of it was reachable only *through a Swarm*.
2. **Provider CLI knowledge was duplicated,** and would have been triplicated by any new engine.
   Now extracted to `agents::invocation` and shared.
3. **The dead-schema surface is large,** and reads as more product than exists.
4. **Test quality is high where tests exist** — behavioral, invariant-focused, honestly named
   (`restart_reconciliation_does_not_leave_lost_processes_running`), not coverage theater.

## Defects found and fixed during this mission

| Defect | Where | Resolution |
| --- | --- | --- |
| Re-entrant lock deadlock: denying an approval took the per-Run lock twice and hung the scheduler thread permanently | `RunService::decide_approval` → `cancel` (new code) | Split into `cancel` / `cancel_locked`; the deny path is now a regression test |

No pre-existing defect met the mission's "fix immediately" bar (data loss, containment violation,
state corruption, restart-recovery failure, severe security risk). The dead schema is recorded
above for a separate cleanup.


---

# Mission Control addendum — 2026-08-23

The mission that produced this addendum closed §22 and §23 and, in the process, found two defects
that made the Run Engine's *production* path unusable on Windows. Both were found by the canary
this audit's previous section said was still missing, which is the strongest argument for having
run it.

## Defects found and fixed

| Defect | Where | Impact before the fix | Resolution |
| --- | --- | --- | --- |
| Run Engine provider sessions were given human terminal geometry (120×36) despite streaming JSON-lines output. ConPTY wrapped the provider's multi-kilobyte records and the stream stalled — 4 bytes in 7 minutes. | `services::terminal_manager::is_machine_protocol_workspace` matched only `swarm-runtime-` | **Every single-agent Run hung in `running` forever.** The Run Engine had never completed a real provider execution. | The predicate now covers `run-engine-` too, and its doc comment states *why* the geometry matters. Regression test: `structured_agent_workspaces_keep_a_stable_machine_protocol_surface` |
| The completion gate treated Paralith's own stdin close as a provider failure. Closing stdin so Codex `exec` can exit makes ConPTY deliver `STATUS_CONTROL_C_EXIT` (`0xC000013A`), which the gate read as a non-zero exit. | Duplicated in `run_executor::SingleAgentExecutor::poll` **and** `swarm_service` | **Every Codex session — Run *and* Swarm — was recorded as failed after doing the work correctly.** | One shared gate, `agents::invocation::provider_session_succeeded` / `provider_session_failure_code`, used by both engines. A real non-zero exit still vetoes a reported completion; only host-teardown statuses are exempt. 4 tests |

Neither was reachable by the existing test suite: both engines' tests script the executor, so the
last link — an actual provider process behind an actual PTY — had never been exercised. Two
`#[ignore]`d canaries now exercise it deliberately.

## Run Engine canary — verdict: **PASSES**

`cargo test --lib run_engine_canary -- --ignored --nocapture --test-threads=1`

Real database, real Repository control plane, real Context Fabric, real `TerminalManager` PTY,
real provider. Claude (15s) and Codex (23s) both walk the full path:

```
created → preparing → worktree_attached (paralith/run-…) → context_compiled
        → started → agent activity → provider terminal event → succeeded
```

with `CANARY.txt` actually written into the leased worktree, `context_pack_id` recorded, and the
lease retained. Assertions cover each link individually so a failure names the link.

## The gap the Mission Control mission closed

- **Mission Control (§22)** — was NOT IMPLEMENTED (dead schema). Now implemented end to end:
  `models::mission` (state machines + DAG), `database::missions`, `services::mission_service`,
  `services::mission_planner`, `commands::mission_commands`, `src/features/missions/*`,
  route `/missions/:projectId`. See `docs/MISSION_CONTROL.md`.
- **Task Graph (§23)** — was NOT IMPLEMENTED (dead schema). Now a validated DAG with cycle
  detection, dependency-aware scheduling, exactly-once claiming, retries as new Runs, and plan
  revision that preserves executed work.

### Dead schema decision

Migration **39** retires the v7 Mission cluster rather than evolving it — it modelled an
architecture Paralith no longer has (a second worktree table, a second execution record, a
verification engine that a later mission will design). Retired: `missions`, `mission_tasks`,
`acceptance_criteria`, `task_dependencies`, `task_acceptance_criteria`, `worktrees`,
`mission_sessions`, `task_events`, `evidence_records`, `verification_results`, `recovery_states`.
A table holding rows is preserved as `<name>_legacy_v7` rather than dropped.

Two findings from the previous audit are now closed:

- **`missions.project_id ON DELETE RESTRICT`** — a table nothing wrote could block a Project
  deletion. Now `ON DELETE CASCADE`, with a test that deletes a Project and asserts its Missions
  and Tasks cascade.
- **The dead `worktrees` table** — gone. `repository_worktree_leases` is the only worktree source
  of truth, and a Mission Task reaches it only through its Run.

Still dead and untouched: `skills`, `skill_activations`, `mcp_*`, `bases`, `base_views`,
`canvases`, `canvas_*`, `knowledge_branch_merges`, `verification_profiles`,
`verification_checks`, `project_contexts`, `project_context_suggestions`, and the vestigial
`workspaces.mission_id` column. Each is its own cleanup with its own review.

## Mission Control canary — verdict: **PASSES**

`cargo test --lib mission_control_canary -- --ignored --nocapture --test-threads=1`

A real two-Task Mission against a real provider, in a throwaway Git repository. Claude (35s) and
Codex (48s) both produce:

```
created → preflight_started → preflight_completed → plan_created → ready
        → plan_revised → started
        → task_ready → task_started (T1) → task_completed
        → task_ready → task_started (T2) → task_completed      ← dependency unlock
        → execution_completed → review_ready
```

Two Runs, each with its own worktree and branch, each carrying `mission_id` and
`mission_task_id`, each with a recorded context pack; both files written for real; and the
Acceptance Criterion still `unverified`, because nothing verified it.

## Why "FUNCTIONALLY COMPLETE / NEEDS HARDENING", not "COMPLETE"

Mission Control is honest about what it does not do, and the classification follows:

- `VERIFYING` is reachable in the state machine and entered by nothing. No criterion can become
  `VERIFIED`; `COMPLETED` requires an explicit human acceptance that records
  `accepted_without_verification`.
- Mission-level **integration is manual**. Task branches are linked and queryable; merging is a
  human decision in Source Control.
- **Pause is not implemented**, deliberately — the Run Engine has no suspend primitive, and a
  pause that only stopped UI updates would be a lie.
- The **agent planner** (`planning_mode: agent`) is unit-tested end to end but is not what the
  real-provider canary drives; the deterministic planner is.

## Updated verdicts

| Feature | Before | Now |
| --- | --- | --- |
| Run Engine (§24) | FUNCTIONALLY COMPLETE, **real provider path unproven** | **VERIFIED** — two provider canaries pass; two blocking defects fixed |
| Mission Control (§22) | NOT IMPLEMENTED (dead schema) | **FUNCTIONALLY COMPLETE / NEEDS HARDENING** |
| Task Graph (§23) | NOT IMPLEMENTED (dead schema) | **FUNCTIONALLY COMPLETE** |
| Swarm (§31) | VERIFIED | **VERIFIED** — 55 tests still green; its Codex completion gate is fixed by the shared gate above |

## Validation actually run

```
cargo fmt --check                clean
cargo clippy --all-targets       no warnings
cargo test                       796 passed, 0 failed, 4 ignored
npm run typecheck                clean
npm run lint                     clean
npm test                         857 passed across 97 files
npm run build                    clean
cargo test --lib run_engine_canary      -- --ignored   2 passed (Claude, Codex)
cargo test --lib mission_control_canary -- --ignored   2 passed (Claude, Codex)
```
