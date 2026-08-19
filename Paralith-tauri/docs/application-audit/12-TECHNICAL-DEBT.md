# 12 — Technical Debt

Legacy, dead, duplicated, incomplete and conflicting systems. Every item was verified, not inferred from a name.

---

## 0. How this was established

Standard debt-marker searches returned nothing:

| Pattern | Hits in `src/` + `src-tauri/src/` |
|---|---|
| `TODO` | **0** |
| `FIXME` | **0** |
| `HACK` | **0** |
| `XXX:` | **0** |

**A codebase of 139,172 lines with zero debt markers.** This is not evidence of no debt — it is evidence that debt in this repository is *structural* rather than *annotated*, and therefore had to be found by tracing reachability rather than by grepping comments.

The method used: enumerate every schema table, Tauri command and event; match each against every reachable caller; contextualise each match to reject comment-only and substring hits.

---

## 1. Dead code — implementation with no reachable caller

### 1.1 The Code Graph subsystem — ~2,400 LOC

| Component | LOC | Status |
|---|---|---|
| `services/code_parser.rs` | 1,282 | maintained, incrementally updated by the watcher |
| `database/code.rs` | 642 | written to on every relevant file change |
| `services/code_intelligence.rs` | 488 | — |
| `models/code.rs` | 507 | — |
| `commands/code_commands.rs` | 8 commands | **0 frontend callers** |
| Tables | `code_files`, `code_symbols`, `code_imports`, `code_references`, `code_index_state` | populated, never read by a user-facing path |

Verified by exhaustive diff: `code_index_state`, `code_reindex`, `code_search_symbols`, `code_file_symbols`, `code_symbol_detail`, `code_dependencies`, `code_impact`, `code_files` are all registered in `lib.rs:593-600` and have **zero** `invoke('code_…')` sites in `src/`.

**Classification: BACKEND-ONLY, actively maintained, entirely unconsumed.** This is the single largest block of working-but-unreachable capability in the product. It is *not* dead in the rot sense — it is wired into the file watcher and kept current — it simply has no consumer.

### 1.2 The Semantic index — ~800 LOC

`services/embeddings.rs` (477), `services/semantic.rs`, `database/embeddings.rs`, table `knowledge_embeddings`, `commands/semantic_commands.rs` (5 commands).

All five commands (`semantic_status`, `semantic_save_settings`, `semantic_regenerate`, `semantic_clear`, `semantic_nearest`) have **zero frontend callers**. The index cannot be configured, regenerated, cleared or queried by a user.

One adjacent command, `knowledge_semantic_health`, *is* called (`memory/api.ts:146`) — so the Memory UI can display embedding health for an index nothing can populate or search.

**Classification: BACKEND-ONLY.**

### 1.3 Dead functions (compiler-confirmed)

The audit's Rust build surfaced `dead_code` warnings:

| Symbol | Location | Superseded by |
|---|---|---|
| `SelfWriteLedger::recently_written` | `services/filesystem_service.rs:105` | `origin_of()` |
| `ChangeOrigin::as_str` | `models/filesystem.rs:163` | — |
| `ChangeOrigin::parse` | `models/filesystem.rs:96` | — |
| `CodeLanguage::…` (partial) | `models/code.rs:48` | unused because the code graph has no consumer |
| `TelemetryConfidence` variants | `models/usage_telemetry.rs:15` | in-flight feature |

These are the *only* compiler-detectable dead symbols in 89k LOC.

### 1.4 Dead event

`repository-intelligence-updated` is emitted at `commands/repository_commands.rs:449` and has **no `listen()` anywhere in `src/`**. Consequence: the Repository → Intelligence section does not live-update; it refreshes only on navigation or manual action.

---

## 2. Zombie systems — old architecture still partially connected

### 2.1 🔴 `mission_tasks` — a silent data-loss bug

```rust
// src-tauri/src/database/repository.rs:475
let valid_task = task_id.and_then(|id| {
    self.connection.lock()
        .query_row("SELECT id FROM mission_tasks WHERE id=?1", [id], …)
        .optional().ok().flatten()
});
self.connection.lock().execute(
  "INSERT INTO audit_events(id,mission_id,task_id,…) VALUES(?1,NULL,?2,…)",
  params![…, valid_task, …]);
```

`mission_tasks` is created by an old migration and **written by nothing**. The lookup therefore always returns `None`, `valid_task` is always `NULL`, and **every repository audit event loses its link to the task that caused it**.

`mission_id` is separately hardcoded to `NULL` in the same statement.

**Classification: BROKEN.** This is the clearest correctness defect the audit found. It is silent — nothing errors, the audit row is written, it is simply missing its provenance.

### 2.2 The Orchestration Kernel vs. the Swarm engine

Two control planes for the same domain:

| | Orchestration Kernel | Swarm engine |
|---|---|---|
| LOC | ~3,000 (`kernel`, `model`, `policy`, `redaction`, `registry`) | ~6,800 + 2,538 persistence |
| Capabilities | 6 (5 read, 1 write) | full agent execution |
| Model invocation | none | provider CLIs |
| State machine | 14 states, **3 reachable** | 19 states, all driven |
| Scheduler | none | 900 ms thread |
| Evidence | capability audit rows | evidence, tests, reviews, completion gate |
| UI | overlay with an Autopilot selector | full route + sidebar |

The Kernel's `missions` and `mission_sessions` tables are dead. Its UI advertises modes and states it cannot reach.

**Classification: PROTOTYPE overlapping a working system.** Either the Kernel becomes the control plane the Swarm engine plugs into, or it should be removed. Keeping both is the most expensive option.

### 2.3 Two context-delivery systems

`ContextCompiler` (1,621 LOC, 27 tests — ranking, token budgeting, citations, staleness) is reachable only from a human preview panel. Agents get `ensure_swarm_context_pack` (~50 LOC of raw SQL, `ORDER BY updated_at DESC LIMIT 8`).

**Classification: DUPLICATED, with the wrong one connected.** Detailed in `07-AGENTIC-SYSTEMS.md` §5.

### 2.4 Two Git invocation paths

| Path | Guarantees |
|---|---|
| `RepositoryService::run_program` | queued · timeout · cancellable · audited · redacted |
| Direct `Command::new("git")` at 7 sites | none of the above |

Direct sites: `commands/git_commands.rs:365,386,595`, `database/mod.rs:1870`, `services/agent_resume.rs:466,598`, `services/project_service.rs:156`.

All are read-oriented so the blast radius is small, but a hung `git` on those paths has no timeout and no cancellation.

**Classification: DUPLICATED.**

### 2.5 Two memory-read paths

`MemoryService` (32 tests) vs. raw SQL in `database/swarm.rs:326` against `memory_items`/`memory_revisions`. The two will diverge on any change to what "current revision" or "relevant" means.

**Classification: DUPLICATED.**

---

## 3. Duplicate systems

### 3.1 `require_project_scope` × 6

Implemented independently in `commands/fabric_scope.rs`, `filesystem_commands.rs`, `intelligence_commands.rs`, `memory_commands.rs`, `project_commands.rs`, `repository_commands.rs`.

The duplication is acknowledged in comments ("Kept local for the same reason that one is…"). No divergence exists today. It is nonetheless **six copies of an authorisation control with no test on any of them**.

### 3.2 Two evidence models

| Model | State |
|---|---|
| `swarm_evidence`, `swarm_test_records`, `swarm_reviews` | live, gated, used |
| `evidence_records`, `acceptance_criteria`, `task_acceptance_criteria`, `task_dependencies`, `task_events` | **entirely unused** |

The dead model has the richer shape. It appears the intended design was replaced by a simpler one.

### 3.3 Two usage models

| Model | State |
|---|---|
| `ai_usage_snapshots`, `ai_usage_daily`, `ai_usage_file_checkpoints` | live |
| `usage_snapshots`, `usage_windows`, `usage_events`, `usage_limit_events`, `usage_profiles`, `usage_providers`, `usage_reset_observations`, `usage_alerts`, `usage_alert_prefs` | **9 dead tables** |

Worse than dead: the naming does not distinguish them. A future reader will not know from the name that `usage_snapshots` is legacy and `ai_usage_snapshots` is live.

### 3.4 Two `ChangesSection` components

`features/repository/components/ChangesSection.tsx` (217 LOC) and `features/database/components/sections/ChangesSection.tsx` (358 LOC) — different domains, identical name. Not a defect; a navigation and review hazard.

---

## 4. Planned systems — schema/types exist, execution does not

| System | Artefacts | Migration |
|---|---|---|
| **MCP capability fabric** | `mcp_clients`, `mcp_permissions`, `mcp_audit`, `mcp_tasks`, `mcp_server_state` | v34 |
| **Bases** | `bases`, `base_views` | v34 |
| **Knowledge Canvas** | `canvases`, `canvas_nodes`, `canvas_edges` | v34 |
| **Skills** | `skills`, `skill_activations` | v34 |
| **Branch knowledge reconciliation** | `knowledge_branch_merges` | v34 |
| **Verification framework** | `verification_profiles`, `verification_checks`, `verification_results` | earlier |
| **Project context suggestions** | `project_contexts`, `project_context_suggestions` | earlier |
| **GitHub App + webhooks** | `repository_provider_accounts`, `repository_provider_installations`, `repository_webhook_deliveries` | earlier |
| **Repository recovery checkpoints** | `repository_recovery_checkpoints` | earlier |

The v34 migration header states the case explicitly:

> "These arrive in one migration because they are one feature. Splitting them would produce six versions that are never independently reachable — no build ships with Bases but without the code graph."

The code graph shipped. Bases, Canvas, Skills and MCP did not. The migration's own reasoning was overtaken by what actually got built — which is exactly the failure mode of migrating schema ahead of implementation.

There is one *partial* exception: `.paralith/skills/`, `.paralith/canvases/` and `.paralith/bases/` **paths** are treated as knowledge-relevant by `knowledge_lifecycle.rs:573`, so files placed there are indexed as memory sources. The tables remain unused.

---

## 5. Legacy names retained

| Item | Current value | Note |
|---|---|---|
| Rust crate | `forgemind` | never renamed |
| Rust lib | `forgemind_lib` | — |
| Thread names | `forgemind-agent-identity-*`, `forgemind-output-pipeline-*`, `forgemind-pty-output-*`, `forgemind-pty-exit-*`, `forgemind-agent-state-*` | **visible in shipped logs and debuggers** |
| Legacy identifier | `com.forgemind.workspace` | **correctly retained** — it is the migration source |
| `ForgeSpaceSidebar.tsx` | component name | a "ForgeSpace" concept no longer in the product vocabulary |
| `firebase.json` | Firebase Hosting config | documents a hosting approach the pipeline no longer uses |

Only `com.forgemind.workspace` has a functional reason to remain.

---

## 6. Structural debt

### 6.1 God modules

| File | LOC | Concern |
|---|---|---|
| `services/swarm_service.rs` | **6,764** | adapters, prompt assembly, scheduler, lifecycle, evidence, review, recovery, reporting — one file |
| `database/migrations.rs` | **5,048** | 32 migrations + their tests |
| `services/repository_service.rs` | **4,436** | Git + GitHub + queue + policy + parsing |
| `services/database_studio/adapters.rs` | 3,125 | Prisma + Drizzle parsing |
| `database/swarm.rs` | **2,538** | swarm persistence, **no tests** |
| `services/database_studio/runtime.rs` | 2,771 | — |
| `database/mod.rs` | 2,549 | core persistence |
| `screens/WorkspaceScreen.tsx` | **1,169** | the frontend's largest single component |
| `native/types.ts` | **1,285** | hand-mirrored Rust types |
| `index.css` | **3,886** | one stylesheet for the whole product |

### 6.2 Boundary debt

| Item | Detail |
|---|---|
| **No IPC type generation** | `native/types.ts` (1,285 LOC) is hand-maintained against 25 Rust model modules. A Rust field rename compiles cleanly on both sides and fails at runtime. `ts-rs`/`specta` would close this. |
| Terminal ownership split | `TerminalManager` owns PTY lifetime; `SwarmService` independently creates, monitors and stops sessions |
| Single DB connection | one `Mutex<Connection>`, 279 lock sites, all subsystems serialised |
| Command layer untested | ~3,000 LOC including every authorisation guard |
| Database layer untested | ~8,000 LOC including where two real defects were found |

### 6.3 UI debt

| Item | Detail |
|---|---|
| 6 UI primitives for a 50k-LOC frontend | no `Input`, `Select`, `Checkbox`, `Tooltip`, `Tabs`, `Menu`, `Badge`, `Card` — each feature re-implements them |
| 3,886-line `index.css` | one global stylesheet; feature CSS exists only for `code-surface` and `browser` |
| One `ErrorBoundary` | in `main.tsx`; a render error anywhere kills the whole UI |
| No command palette / global shortcuts | 7 of 11 routes have no keyboard entry point |
| No notification system | attention state exists only inside the sidebar |
| Editor state not persisted | open tabs lost on workspace switch |
| Browser URL not persisted | page lost on restart |

### 6.4 Data debt

| Item | Detail |
|---|---|
| 44 of 147 tables orphaned | 30% of the schema |
| 56 `*_json` blob columns | several relationships unqueryable in SQL |
| `swarm_evidence.payload_json` always `'{}'` | evidence content discarded |
| Free-text status columns | no `CHECK` constraints; Rust enums not enforced by the DB |
| Naming does not signal liveness | `usage_*` (dead) vs `ai_usage_*` (live) |
| `audit_events.mission_id` | always `NULL`, for a dead table |

### 6.5 Product debt — features present but not usable or coherent

| Feature | Problem |
|---|---|
| Code graph | fully maintained, zero UI |
| Semantic index | fully built, zero UI, never populated by any user action |
| Orchestrator Autopilot mode | selectable, does nothing |
| Orchestrator states | 11 of 14 labels unreachable |
| Preview channel | implemented edition with no publishing workflow |
| Repository intelligence | present but does not live-update |
| Issues / security alerts | read-only projections with no action |
| `SwarmRuntimeKind::Auto` | selectable runtime that emits no events |
| Database context pack | built for agents; no agent consumes it |

---

## 7. Debt ledger

| # | Item | Type | Severity | Effort |
|---|---|---|---|---|
| D1 | Agents receive the crudest of three retrieval systems | Product/Structural | **P0** | S — one call site + wiring |
| D2 | `mission_tasks` zombie FK discards audit provenance | Correctness | **P0** | XS |
| D3 | 44 orphan tables (30% of schema) | Data | **P0** | M — a cleanup migration |
| D4 | Orchestration Kernel duplicates the Swarm domain without working | Structural | **P0** | L — decide, then consolidate or delete |
| D5 | `swarm_evidence.payload_json` hardcoded `'{}'` | Data/Product | P1 | S |
| D6 | Code graph + semantic index unreachable (~3,200 LOC) | Product | P1 | M — needs UI |
| D7 | Single global DB mutex, 279 lock sites | Performance | P1 | M |
| D8 | No IPC type generation | Reliability | P1 | M |
| D9 | Command + database layers untested (~11,000 LOC) | Test | P1 | L |
| D10 | 5 threads per terminal session | Performance | P1 | M |
| D11 | `SwarmRuntimeKind::Auto` emits no events | Correctness | P1 | S |
| D12 | Builder completion gate is title-heuristic | Correctness | P1 | S |
| D13 | `require_project_scope` × 6 | Structural | P2 | S |
| D14 | Two Git invocation paths | Structural | P2 | S |
| D15 | `swarm_service.rs` at 6,764 LOC | Structural | P2 | L |
| D16 | `migrations.rs` at 5,048 LOC | Structural | P2 | M |
| D17 | Single `ErrorBoundary` | Reliability/UI | P2 | S |
| D18 | No notification system | Product/UI | P2 | M |
| D19 | No command palette / global shortcuts | Product/UI | P2 | M |
| D20 | Preview channel unpublishable | Infrastructure | P2 | S |
| D21 | `repository-intelligence-updated` dead event | Product | P2 | XS |
| D22 | Editor + browser state not persisted | Product | P2 | S |
| D23 | 6 UI primitives / 3,886-line CSS | UI | P3 | L |
| D24 | Legacy `forgemind` naming in crate + thread names | Cosmetic | P3 | S |
| D25 | `firebase.json` documents an unused hosting approach | Cosmetic | P3 | XS |
| D26 | No panic hook | Observability | P3 | XS |
| D27 | No coverage measurement | Test | P3 | S |
| D28 | 25 ms spin-wait on `git`/`gh` | Performance | P3 | XS |
| D29 | Log: 5 MB, one rotation | Observability | P3 | XS |
| D30 | No repository-op resume after crash | Reliability | P3 | M |

---

## 8. What is explicitly *not* debt

It is worth naming what the audit checked for and did **not** find, because it constrains how much of the above is worrying:

- No fake progress, fake agent activity, fake Git status, invented usage percentages, or mock data in production paths. `SimAdapter` is `#[cfg(test)]`-gated and cannot ship.
- No `"Something went wrong"` error path — 286 typed error codes across 41 layers.
- No SQL string interpolation.
- No shell string interpolation.
- No unbounded collections.
- No leaked event listeners.
- No unreachable routes.
- No hardcoded colours in TSX.
- ~6 `.unwrap()` calls in 89k LOC of production Rust.
- No security-boundary bypass, no "temporary" guard disablement.

The debt in this repository is almost entirely **things built and not connected**, or **things designed and not built**. It is not rot.
