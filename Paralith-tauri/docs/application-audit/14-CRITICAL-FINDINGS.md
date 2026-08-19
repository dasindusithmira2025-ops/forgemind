# 14 — Critical Findings

Ranked P0–P3. Each finding states the problem, its evidence, its consequence, the systems it touches, and a recommended *direction* — **no recommendation in this document was implemented.**

---

# P0 — Architectural blockers

Issues that make future development dangerous or disproportionately expensive.

---

## P0-1 — Agents receive the crudest of three available knowledge systems

**Problem.** Paralith contains three knowledge-retrieval implementations. The one wired into agent launch is a 50-line raw SQL query with no relevance ranking.

**Evidence.**
- `database/swarm.rs:326-351` — `SELECT … FROM memory_items … ORDER BY item.pinned DESC, item.updated_at DESC LIMIT 8`
- `services/context_compiler.rs` — 1,621 LOC, 27 tests: retrieval, ranking, token budgeting, citations, staleness. Its **only** caller chain is `memoryStore.ts:634` ← `MemoryContext.tsx:86`, a human preview panel.
- `services/embeddings.rs` + `semantic.rs` + `knowledge_embeddings` — 5 commands, **zero callers**.
- `services/code_parser.rs` + `code_intelligence.rs` + 4 tables — 8 commands, **zero callers**.
- `swarm_service.rs:1639-1673` — `runtime_instruction()`, the complete prompt an agent receives.

**Consequence.** The product's stated thesis — agents reasoning from typed, provenanced evidence — is not delivered. An agent fixing a CSS bug is handed whichever eight memories were most recently edited. Every downstream quality problem in agent output has this as a contributing cause, and no amount of prompt tuning compensates for retrieving the wrong eight facts.

**Systems affected.** Memory Fabric · Context Compiler · Semantic Index · Code Graph · Swarm · Agent runtime · Proof.

**Direction.** Route agent context through `ContextCompiler`, with the code graph supplying task-relevant file/symbol scope and the semantic index contributing candidates in the role its own design already specifies ("contributes candidates; never reranks a deterministic result"). Both ends exist and are tested; this is a wiring change at `swarm_service.rs:1026`, not new architecture. Keep `swarm_context_packs` provenance recording exactly as it is — it is already correct.

---

## P0-2 — Two control planes claim the agentic domain; the advertised one does not work

**Problem.** The Orchestration Kernel presents itself (and its UI presents it to users) as an autonomous orchestrator. It has no model invocation, 6 capabilities, and no code path that moves a session past `idle`.

**Evidence.**
- `orchestration/registry.rs` — exactly 6 capabilities: `project.list`, `workspace.list`, `terminal.list`, `setting.read`, `file.read`, `file.write`.
- `kernel.rs:141-181` — `record_user_turn` persists a row and emits `transcript_updated`. Nothing else.
- `orchestration_commands.rs` — only `pause`, `resume`, `cancel` are exposed. 11 of 14 declared states are unreachable.
- `OrchestratorLauncher.tsx:238` — an **Autopilot** mode selector whose value no backend code reads.
- `missions`, `mission_sessions` — dead tables.
- Meanwhile `SwarmService` (6,764 LOC + 2,538 persistence) genuinely schedules, isolates, verifies and reviews multi-agent work.

**Consequence.** Two competing owners of the same domain. Every future agentic feature must be built twice or a choice must be made. The Autopilot selector and the unreachable state labels are direct violations of the product's own "no dead controls, no fake progress" rule.

**Systems affected.** Orchestration Kernel · Swarm · Agent runtime · UI honesty.

**Direction.** Decide. Either (a) the Kernel becomes the supervisory layer and `SwarmService` becomes a capability it executes — in which case its capability registry must grow to reach the Swarm engine — or (b) the Kernel is removed and the Swarm engine is extended with the Kernel's genuinely good parts (typed capability validation, policy gate, redaction). Until then, the unreachable UI affordances should be hidden.

---

## P0-3 — 30% of the database schema is dead

**Problem.** 44 of 147 persistent tables are never read or written by any code.

**Evidence.** Full list in `05-DOMAIN-AND-DATA-MODEL.md` §4. Groups:
- 18 planned-never-built (MCP fabric ×5, Bases ×2, Canvas ×3, Skills ×2, verification ×3, project contexts ×2, branch merges ×1)
- 16 legacy-superseded (usage v1 ×9, evidence/task v1 ×5, missions ×2)
- 9 dead/never-wired (incl. GitHub App + webhooks ×3, repository recovery checkpoints ×1)

The v34 migration header explains the intent — "no build ships with Bases but without the code graph" — but the code graph shipped and Bases did not.

**Consequence.** Anyone reading the schema to understand the product will be badly misled: they will believe Paralith has an MCP capability fabric, a Bases feature, a Canvas, a Skills system and a verification framework. None exist. Migration authoring becomes riskier because it is unclear what may be depended upon. `migrations.rs` is 5,048 lines partly because of this.

**Systems affected.** Persistence · migrations · any future schema work.

**Direction.** A cleanup migration removing the 44 orphans, preceded by a decision on which planned systems are genuinely coming. Rename `usage_*`→ archived or drop, so `ai_usage_*` is unambiguous. This is mechanical but must precede the next large schema change, not follow it.

---

## P0-4 — `mission_tasks` zombie FK silently discards audit provenance

**Problem.** Every repository audit event loses its link to the task that caused it.

**Evidence.**
```rust
// database/repository.rs:475
let valid_task = task_id.and_then(|id| {
    …query_row("SELECT id FROM mission_tasks WHERE id=?1", …)…
});
…"INSERT INTO audit_events(id,mission_id,task_id,…) VALUES(?1,NULL,?2,…)"…
```
`mission_tasks` is written by nothing. The lookup always returns `None`; `valid_task` is always `NULL`. `mission_id` is separately hardcoded `NULL`.

**Consequence.** `audit_events` cannot answer "which task caused this repository change?" — precisely the question an evidence-based product needs it to answer. The failure is silent: no error, a row is written, provenance is simply absent.

**Systems affected.** Repository audit · Proof · any future traceability work.

**Direction.** Point the validation at the live task table (`swarm_tasks`), or drop the validation and store the id as given. Either is small. The larger lesson is that this lives in `database/repository.rs`, part of the ~8,000 LOC of persistence code with no boundary tests.

---

# P1 — Major gaps

Important systems needing completion or consolidation.

---

## P1-1 — ~3,200 LOC of maintained capability has no user surface

**Evidence.** 13 registered Tauri commands with **zero** frontend callers: `code_index_state`, `code_reindex`, `code_search_symbols`, `code_file_symbols`, `code_symbol_detail`, `code_dependencies`, `code_impact`, `code_files`, `semantic_status`, `semantic_save_settings`, `semantic_regenerate`, `semantic_clear`, `semantic_nearest`. Verified by exhaustive registered-vs-called diff.

The code graph is *actively maintained* — the file watcher updates it on every relevant change (`lib.rs:388`).

**Consequence.** Real cost is paid (parsing, indexing, storage, watcher work) for zero delivered value. Meanwhile the editor has no go-to-definition and no find-references despite the data existing.

**Direction.** Surface it. Either as agent context (see P0-1), as editor navigation, or both. This is the cheapest large feature in the repository.

---

## P1-2 — Evidence content is discarded

**Evidence.** `database/swarm.rs:1547` binds the literal `'{}'` in place of `payload_json`, and `models/swarm.rs:1012` has no payload field. Evidence is `title` + `summary` + `source_uri` strings.

**Consequence.** The completion gate (`swarm_service.rs:4208`) can verify that evidence *exists* but never what it *says*. A claim cannot be re-verified after the fact. This is the gap between the product's "evidence over claims" principle and what it stores.

**Direction.** Add a payload to `SwarmEvidence` and store structured proof — command, exit code, changed paths, test output digest.

---

## P1-3 — The Builder completion gate is a title substring match

**Evidence.** `swarm_service.rs:4216-4219` — a Builder task requires a passing test record only if `task.title` contains `test`, `verify` or `regression`.

**Consequence.** A task titled "Fix the login redirect" completes with no verification requirement whatsoever. The gate's strength depends on how the task was named.

**Direction.** Derive the requirement from the task's declared acceptance criteria or from whether it changed code, not from its title.

---

## P1-4 — Single global database mutex

**Evidence.** `DatabaseService { connection: Mutex<Connection> }` (`database/mod.rs:37`) with **279 `connection.lock()` sites**. WAL is enforced but delivers no concurrency benefit with one connection.

**Consequence.** The 900 ms swarm scheduler, the knowledge worker, the file-watch dispatcher, terminal session recording, Database Studio discovery and all 257 commands serialise through one lock. Unmeasured, but structurally the ceiling on multi-swarm and many-terminal scenarios.

**Direction.** A small connection pool, or read-only connections for the hot read paths. Measure first.

---

## P1-5 — No IPC type generation

**Evidence.** `src/native/types.ts` is 1,285 hand-maintained lines mirroring 25 Rust model modules. `npm run typecheck` passes cleanly on both sides of a Rust field rename.

**Consequence.** The single largest silent-failure surface in the product. No test, lint or typecheck can catch a contract break; it fails at runtime in the user's hands.

**Direction.** `ts-rs` or `specta` to generate `types.ts` from the Rust models, with a CI check that the generated file is current.

---

## P1-6 — The command and database layers are untested

**Evidence.** `commands/*.rs` (~3,000 LOC) and `database/swarm.rs` (2,538), `database/database_studio.rs` (1,536), `database/intelligence.rs` (1,421), `database/graph.rs` (837), `database/code.rs` (642) have **no `mod tests`**.

Two of this audit's real defects (P0-4 and P1-2) live in exactly that untested persistence code.

The command layer is where every authorisation guard lives — `require_project_scope` (6 copies), `validate_workspace_caller`, `assert_input_allowed`, `require_main_window` — and **not one has a test asserting it rejects an unauthorised caller.**

**Direction.** Authorisation-guard tests first (security), then `database/swarm.rs` and `database/database_studio.rs`.

---

## P1-7 — `SwarmRuntimeKind::Auto` emits no events

**Evidence.** `swarm_service.rs:1165` — `SwarmRuntimeKind::Auto => {}` in `normalize_runtime_events`.

**Consequence.** An agent configured with the `Auto` runtime produces zero normalised events, so it can neither report completion nor satisfy the completion gate. A selectable option that cannot succeed.

**Direction.** Either resolve `Auto` to a concrete runtime before launch, or remove it from the selectable set.

---

## P1-8 — Terminal-pane agents are cut off from the knowledge loop

**Evidence.** `agent_handoff::from_agent_run` is called only from `swarm_service.rs:4311`.

**Consequence.** The most common user action — running Claude or Codex in a pane — teaches Paralith nothing. All accumulated project knowledge comes from Swarms.

**Direction.** Extend handoff extraction to terminal-pane agent sessions. The provider JSONL is already parsed for those sessions (`agent-state` detection), and `agent_handoff.rs`'s "never fabricate a field" rule means a sparse handoff is safe.

---

## P1-9 — Five OS threads per terminal session

**Evidence.** `terminal_manager.rs:411, 506, 554, 625, 712` — agent-identity, output pipeline, PTY reader, exit watcher (100 ms poll), agent-state (5 s poll).

**Consequence.** 4 panes = 20 threads; several workspaces plus swarm agents approach 100+. Two of the five are pollers.

**Direction.** Consolidate the exit watcher and agent-state poller across sessions into shared workers.

---

# P2 — Product coherence issues

Working features that are poorly integrated or incompletely surfaced.

| # | Issue | Evidence | Direction |
|---|---|---|---|
| P2-1 | **No notification system** | no toast, no notification centre, no OS notification, no unread state; only sidebar attention | one aggregation point for swarm attention, repository approvals, knowledge conflicts, updates |
| P2-2 | **No command palette / global shortcuts** | 7 of 11 routes have no keyboard entry point; all handlers are surface-local | a command registry that surfaces can contribute to |
| P2-3 | `repository-intelligence-updated` is a dead event | emitted `repository_commands.rs:449`, no `listen()` | add the listener, or remove the emit |
| P2-4 | Preview channel cannot ship | full edition support, `build:preview`, provisioned pubkey — **no `release-preview.yml`** | add the workflow, or remove the edition |
| P2-5 | Editor and browser state not persisted | `editorStore` in-memory; browser `current_url` in a `Mutex`, never written | persist per workspace |
| P2-6 | Database Studio is nearly isolated | reads the project, writes migrations, informs no other subsystem | feed schema context into agent launch (`agent_ops.rs` already exists) |
| P2-7 | Swarms do not compose onto the workspace canvas | Swarms are a separate full-screen route; agent terminals cannot be detached as panes | allow swarm agent terminals to appear as canvas panes |
| P2-8 | Issues and security alerts are read-only | no `RepositoryOperation` variant creates or acts on them | add operations, or label the surfaces read-only |
| P2-9 | Single `ErrorBoundary` | only `main.tsx:10` | per-route boundaries |
| P2-10 | `require_project_scope` duplicated 6× | `fabric_scope`, `filesystem`, `intelligence`, `memory`, `project`, `repository` commands | consolidate into one module |
| P2-11 | Two Git invocation paths | 7 direct `Command::new("git")` sites bypass the queue, timeout, cancellation and audit | route through `RepositoryService` |
| P2-12 | Interrupted repository operations detected but not resumed | `recover_on_startup()` logs; `repository_recovery_checkpoints` never written | implement resume, or drop the table and the claim |

---

# P3 — Quality debt

Worth doing; does not block architectural progress.

| # | Issue | Evidence |
|---|---|---|
| P3-1 | `swarm_service.rs` at 6,764 LOC | adapters + prompts + scheduler + lifecycle + evidence + review + reporting in one file |
| P3-2 | `migrations.rs` at 5,048 LOC | 32 migrations + tests in one file |
| P3-3 | `index.css` at 3,886 LOC | one global stylesheet |
| P3-4 | 6 UI primitives for a 50k-LOC frontend | no `Input`, `Select`, `Tooltip`, `Tabs`, `Menu`, `Badge`, `Card` |
| P3-5 | `WorkspaceScreen.tsx` at 1,169 LOC | the frontend's god component |
| P3-6 | Legacy `forgemind` naming | crate, lib, and 5 thread-name prefixes visible in shipped logs |
| P3-7 | `firebase.json` documents an unused hosting approach | releases publish via GitHub + SSH mirror |
| P3-8 | No panic hook | a panicking background thread dies silently |
| P3-9 | No coverage measurement | `@vitest/coverage-v8` installed but never invoked with `--coverage` |
| P3-10 | 25 ms spin-wait on `git`/`gh` | `wait-timeout` is already a dependency |
| P3-11 | Log is 5 MB with one rotation | a long session may overwrite the relevant lines before a bug is reported |
| P3-12 | No maintenance job | no `VACUUM`, log pruning, cache eviction or orphan-row cleanup |
| P3-13 | Free-text status columns | no `CHECK` constraints; Rust enums unenforced by the DB |
| P3-14 | Cost estimation uses a hardcoded frontend pricing table | `usagePricing.ts` will silently drift from vendor pricing |
| P3-15 | Dead functions | `SelfWriteLedger::recently_written`, `ChangeOrigin::as_str`, `ChangeOrigin::parse` |

---

# Repository safety record

**Pre-existing state at audit start** (`git status`, branch `feat/usage-telemetry-dashboard`, HEAD `ba26c48`):

- 34 modified tracked files
- ~40 untracked application files — a large in-flight "Context Fabric" feature branch adding `code_commands.rs`, `semantic_commands.rs`, `memory_commands.rs`, `intelligence_commands.rs`, `usage_telemetry_commands.rs`, `context_compiler.rs`, `knowledge_intelligence.rs`, `knowledge_lifecycle.rs`, `code_parser.rs`, `embeddings.rs`, `src/features/memory/`, and others
- untracked non-application directories: `.obsidian/`, `Paralith-Vault/`, `Marketing_videos`, `One`, `.jcode/dbstudio/pause-snapshot/`

**This audit's changes:**

| Action | Status |
|---|---|
| Application source modified | **NO** |
| Files created | only under `Paralith-tauri/docs/application-audit/` |
| Commit created | **NO** |
| Pushed | **NO** |
| Dependencies changed | **NO** |
| Configuration changed | **NO** |
| Anything deleted | **NO** |

Note: `cargo test` was run with `CARGO_TARGET_DIR` pointed outside the repository, so `src-tauri/target/` was not touched and the concurrent developer build was not disturbed.

---

# Finding-to-document index

| Finding | Detail in |
|---|---|
| P0-1 context delivery | `07-AGENTIC-SYSTEMS.md` §5, `13-INTEGRATION-MATRIX.md` §3 M1 |
| P0-2 orchestrator | `07-AGENTIC-SYSTEMS.md` §7, `12-TECHNICAL-DEBT.md` §2.2 |
| P0-3 dead schema | `05-DOMAIN-AND-DATA-MODEL.md` §4 |
| P0-4 zombie FK | `05-DOMAIN-AND-DATA-MODEL.md` §4, `12-TECHNICAL-DEBT.md` §2.1 |
| P1-1 unreachable commands | `02-FEATURE-CATALOG.md` §K, §L |
| P1-2/3 evidence | `07-AGENTIC-SYSTEMS.md` §6 |
| P1-4 DB mutex | `10-SECURITY-RELIABILITY-PERFORMANCE.md` §8.1 |
| P1-5 IPC types | `05-DOMAIN-AND-DATA-MODEL.md` §10, `11-TEST-COVERAGE.md` §7.1 |
| P1-6 test gaps | `11-TEST-COVERAGE.md` §7.3, §7.4 |
| P1-9 threads | `06-RUNTIME-AND-AUTOMATION.md` §1.2 |
| P2-* coherence | `13-INTEGRATION-MATRIX.md` §3 |
| P3-* quality | `12-TECHNICAL-DEBT.md` §6, §7 |
