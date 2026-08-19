# 11 — Test Coverage

Testing architecture, what the tests actually guarantee, and where the gaps are.

---

## 1. Inventory

| Layer | Framework | Files | Tests |
|---|---|---|---|
| Frontend | Vitest 4.1.10 + Testing Library + jsdom 29 | 90 test files | **788 tests** |
| Rust | built-in `#[test]` / `mod tests` | 67 modules with tests | **576 `#[test]` functions** |
| Release tooling | `node --test` | 5 `*.test.mjs` | not counted |
| Vault tooling | `node --test` (`npm run vault:test`) | separate | not counted |
| E2E / integration (driving the built app) | — | **0** | **0** |

**Total application tests: ~1,364.**

---

## 2. Validation run for this audit

| Check | Command | Result |
|---|---|---|
| TypeScript | `npm run typecheck` | ✅ **PASS** — exit 0, no errors |
| Frontend tests | `npm test -- --run` | ✅ **PASS** — 90 files, **788/788 passed**, 17.9 s |
| Rust tests | `cargo test --all-targets --all-features` | ⚠ **NOT COMPLETED — environment blocker** |
| Lint (`oxlint`) | not run | NOT RUN |
| Frontend build | not run | NOT RUN |
| `cargo fmt` / `clippy` | not run | NOT RUN |

### 2.1 Why the Rust suite did not complete

A **concurrent developer build was already running** in this environment (`cargo.exe` + `rustc.exe` live, plus a running `PARALITH.exe`), holding a lock on `src-tauri/target`.

Three attempts were made, all deliberately avoiding disruption to that build:
1. Default target dir → `Blocking waiting for file lock on build directory`, then exit 255.
2. Isolated target dir under the session scratchpad → `LNK1104: cannot open file '…build_script_build-….exe.manifest'` on multiple crates.
3. Isolated target dir outside `%TEMP%`, and again with `-j 2` → same `LNK1104` / `rustc exit 0xffffffff` at the link step.

`LNK1104` on freshly-written `.exe`/`.manifest` files, with 168 GB free disk, is characteristic of on-access antivirus scanning or linker contention with the concurrent build — **not a repository defect**.

**No claim is made about the Rust suite's pass/fail state in this audit.** The relevant evidence that does exist:
- CI (`scripts/ci/run-checks.ps1` step 9) runs `cargo test --all-targets --all-features` as a **blocking gate** on every PR and on the release workflow.
- HEAD is on a feature branch whose parent commits passed that gate.
- 576 `#[test]` functions exist across 67 modules.

**Recommended: re-run `cargo test --all-targets --all-features` on a quiet machine to confirm.**

---

## 3. Rust coverage by module (top 30)

| Tests | Module | What it protects |
|---|---|---|
| 43 | `services/swarm_service.rs` | lifecycle transitions, retry, preset immutability, runtime loss, evidence gating |
| 39 | `services/knowledge_intelligence.rs` | entity resolution, dedupe, conflict classification, auto-accept policy |
| 32 | `services/memory_service.rs` | items, revisions, claims, relations, staleness |
| 27 | `services/context_compiler.rs` | retrieval, ranking, token budgeting |
| 23 | `database/migrations.rs` | migration correctness, schema version assertions |
| 20 | `services/repository_service.rs` | Git parsing, operation execution, redaction |
| 19 | `services/knowledge_lifecycle.rs` | relevance filtering, job dedup, staleness policy |
| 18 | `services/query_engine.rs` | structured query parsing |
| 17 | `services/terminal_manager.rs` | session lifecycle, output pipeline, exit handling |
| 17 | `services/database_studio/runtime.rs` | discovery/graph runtime |
| 14 | `services/project_analyzer.rs` | deterministic project walk |
| 14 | `services/filesystem_service.rs` | **path guard** — traversal, symlink, drive prefix, NUL |
| 14 | `orchestration/kernel.rs` | transition validation, capability policy |
| 13 | `services/update_service.rs` | journal phases, recovery |
| 13 | `database/search.rs` | FTS |
| 12 | `services/memory_markdown.rs` | markdown mirror |
| 11 | `services/window_registry.rs` | **lease grant/denial**, handoff, placement |
| 11 | `services/database_studio/discovery.rs` | source discovery |
| 10 | `services/code_parser.rs` | symbol extraction |
| 9 | `services/file_watch_service.rs` | relevance, self-write suppression |
| 9 | `database/placement.rs` | placement persistence |
| 8 | `services/usage_service.rs` | Claude/Codex payload parsing incl. malformed data |
| 8 | `database/knowledge_jobs.rs` | job queue |
| 8 | `agents/adapter.rs` | CLI argument construction, `.ps1` shim handling |
| 7 | `services/repository_intelligence.rs` | merge readiness |
| 7 | `services/database_studio/adapters.rs` | Prisma/Drizzle parsing |
| 7 | `services/agent_handoff.rs` | never-fabricate-a-field guarantees |
| 7 | `database/mod.rs`, `database/memory.rs` | persistence |
| 6 | `services/embeddings.rs` | embedding client |

### 3.1 Rust modules over 300 LOC with **no** `mod tests`

| LOC | Module | Risk |
|---|---|---|
| **2,538** | `database/swarm.rs` | 🔴 **highest untested surface in the repo** — owns the entire swarm persistence layer including `ensure_swarm_context_pack` and `record_swarm_evidence` |
| **1,536** | `database/database_studio.rs` | 🔴 Database Studio persistence |
| 1,442 | `models/swarm.rs` | mostly type definitions — lower risk |
| **1,421** | `database/intelligence.rs` | 🔴 knowledge persistence |
| 1,176 | `services/database_studio/graph.rs` | graph construction |
| 868 | `lib.rs` | boot sequence — hard to unit test |
| 843 | `models/database_studio.rs` | types |
| **837** | `database/graph.rs` | graph persistence |
| 835 | `models/intelligence.rs` | types |
| **769** | `commands/window_commands.rs` | 🔴 window/lease command surface |
| 642 | `database/code.rs` | code graph persistence |
| 586 | `services/database_studio/pipeline/native.rs` | 🔴 **generates the migrations written into the user's repository** |
| 479 | `commands/repository_commands.rs` | command layer |
| 469 | `commands/swarm_commands.rs` | command layer |
| 467 | `services/database_studio/pipeline/execute.rs` | 🔴 the DB write pipeline |
| 466 | `services/database_studio/agent_ops.rs` | — |
| 466 | `commands/memory_commands.rs` | command layer |
| 411 | `services/database_studio/contracts.rs` | — |
| 387 | `commands/intelligence_commands.rs` | command layer |
| 377 | `services/usage_telemetry_service.rs` | new, in-flight |
| 352 | `models/memory.rs` | types |
| 326 | `commands/database_commands.rs` | command layer |

**Pattern:** *services* are well tested; the ***database layer* and the *command layer* are largely untested.** ~8,000 LOC of persistence code has no direct test coverage, and the two Database Studio pipeline modules that write into the user's repository are among them.

That said, the service tests exercise the database layer indirectly through in-memory SQLite (`DatabaseService::in_memory()` at `database/mod.rs:117`), so it is not unexercised — it is untested *at its own boundary*, meaning a persistence bug shows up as a confusing service-test failure rather than a precise one.

---

## 4. Frontend coverage by feature

| Tests | Feature | Notable |
|---|---|---|
| 19 | `database` | includes `largeSchema.bench.test.ts` (a performance benchmark) and `crossSurfaceNavigation.test.ts` |
| 12 | `code-surface` | editor store, fuzzy matcher, surface tab bar, browser (url, inspect bridge, inspect context, session store) |
| 10 | `memory` | store, presentation, graph, review, context, activity, timeline, overview, search |
| 8 | `sidebar` | model, selectors, store, attention, agent status, index, workspace identity |
| 6 | `workspace-canvas` | geometry engine, snap resolver, resize controller, layout operations, canvas store, persistence |
| 6 | `usage` | analytics, cost, raw cost summary, instrument, page, status bar |
| 6 | `repository` | store, selectors, nav, history, intelligence, command center |
| 4 | `swarms` | create panel, overview, sidebar section, store |
| 2 | `workspace-windows` | close policy, window behaviour |
| 2 | `workspace-setup` | allocation compiler, preset migration |
| 2 | `updates` | notification, controller |
| 2 | `orchestrator` | launcher, store |
| 1 | `terminals` | runtime store |
| 1 | `agent-resume` | resume center |

Plus screen-level tests: `WorkspaceScreen.test.tsx`, `WorkspaceSetup.test.tsx`, `ProjectLauncher.test.tsx`, and `theme/theme.test.ts` (393 LOC), `theme/themeStore.test.ts`, `shared/layout.test.ts`, `stores/*.test.ts`.

---

## 5. Feature → coverage matrix

| Feature | Unit | Integration | E2E | Major gaps |
|---|---|---|---|---|
| Project open/validate | ✅ Rust | ✅ in-memory DB | ❌ | real-folder behaviour |
| Workspace save/restore | ✅ both | ✅ | ❌ | — |
| Canvas dock/split/drag | ✅ FE (6 files) | ✅ | ❌ | none — this is well covered |
| Multi-window leases | ✅ Rust (11) | ✅ | ❌ | **no test with two real windows** |
| Handoff commit/rollback | ✅ Rust | ✅ | ❌ | real-window handoff |
| Terminal lifecycle | ✅ Rust (17) | ✅ | ❌ | **no real-PTY test** — tests use `echo` |
| Terminal output backpressure | ◐ | ◐ | ❌ | drop accounting under real load |
| Agent state detection | ◐ | ❌ | ❌ | **heuristic accuracy unverified** |
| Path guard | ✅ Rust (14) | ✅ | ❌ | none — strongest coverage in the repo |
| Editor save / concurrency | ✅ FE + Rust | ✅ | ❌ | Monaco integration itself |
| Quick Open / fuzzy | ✅ FE | ✅ | ❌ | — |
| Browser URL / inspect | ✅ FE (4 files) | ◐ | ❌ | **no test of the real webview** |
| Git operations | ✅ Rust (20) | ✅ real temp repos | ❌ | — |
| GitHub (`gh`) | ◐ parsing only | ❌ | ❌ | **no `gh` interaction test** |
| Repository intelligence | ✅ both | ◐ | ❌ | — |
| Database discovery/introspect | ✅ Rust (11+17) | ✅ | ❌ | — |
| Database ER canvas | ✅ FE + bench | ✅ | ❌ | — |
| **Database implement pipeline** | ❌ | ❌ | ❌ | 🔴 **writes migrations into the user's repo, untested at its own boundary** |
| Memory items/revisions/claims | ✅ Rust (32) | ✅ | ❌ | — |
| Knowledge intelligence policy | ✅ Rust (39) | ✅ | ❌ | none — excellent |
| Knowledge lifecycle / staleness | ✅ Rust (19) | ✅ | ❌ | — |
| Context compiler | ✅ Rust (27) | ✅ | ❌ | ironic: well tested, unused by agents |
| Code graph parse | ✅ Rust (10) | ◐ | ❌ | no consumer to test |
| Semantic index | ◐ (6, client) | ❌ | ❌ | no consumer |
| Swarm lifecycle | ✅ Rust (43) | ✅ via `SimAdapter` | ❌ | **`ProductionAgentRuntime` is not covered** |
| Provider JSONL normalisation | ✅ Rust | ✅ | ❌ | `Auto` variant untested (and broken) |
| Agent handoff | ✅ Rust (7) | ✅ | ❌ | — |
| Evidence / completion gate | ✅ Rust | ✅ | ❌ | payload loss not caught (no assertion on payload) |
| Orchestration kernel | ✅ Rust (14) | ✅ | ❌ | tests validate a state machine that never runs |
| Usage parsing | ✅ Rust (8) | ✅ | ❌ | tests explicitly cover malformed/negative data |
| Update journal / recovery | ✅ Rust (13) | ✅ | ❌ | **no real download/install test** |
| Migrations | ✅ Rust (23) | ✅ | ❌ | — |
| Theme system | ✅ FE (2) | ✅ | ❌ | — |
| Release tooling | ✅ node (5) | ✅ | ❌ | — |

---

## 6. What the tests actually guarantee (read, not counted)

Test **names** in this repository are behavioural rather than structural, which makes them unusually informative. Representative examples:

| Test | Guarantee |
|---|---|
| `launched_snapshot_is_immutable_when_its_preset_is_edited` | editing a preset cannot retroactively change a running Swarm |
| `a_routine_deterministic_fact_is_accepted_without_a_human` | the auto-accept policy admits deterministic repository facts |
| `a_deterministic_identity_wins_over_a_name_and_records_the_new_name_as_an_alias` | entity resolution precedence |
| `a_dated_change_between_deterministic_readings_is_temporal` | temporal change is distinguished from contradiction |
| `a_routine_deterministic_candidate_becomes_a_memory_with_its_evidence` | promotion carries provenance |
| `codex_cumulative_records_become_deltas` | cumulative counters are converted correctly |
| `codex_live_payload_classifies_windows_by_duration_not_position` | window classification is semantic, not positional |
| `claude_records_ignore_malformed_and_negative_data` | **bad provider data does not become plausible fake usage** |
| `codex_reads_counters_from_the_info_envelope_the_cli_actually_writes` | tested against the real CLI shape |
| `assert!(registry.assert_input_allowed("w1", "ws-w1").is_err())` | lease denial is enforced |
| `is_knowledge_relevant(".paralith/bases/decisions.json")` | relevance filter behaviour |

These read like a specification. The knowledge-intelligence and usage suites in particular encode the product's stated non-negotiables (*"never invent usage percentages"*, *"only a deterministic reading earns an automatic write"*) as executable assertions.

---

## 7. Structural gaps

### 7.1 No end-to-end tests at all

There is no Playwright/WebDriver/`tauri-driver` harness. Nothing exercises the built application. Consequences — none of these can currently be caught by CI:

- a broken IPC contract between Rust and TypeScript (there is **no type generation**, so a Rust field rename compiles on both sides and fails at runtime)
- a workspace that fails to restore
- a detached window that cannot type
- an update that downloads but fails to install
- a Monaco integration regression
- a real PTY behaving differently from the `echo` test double

**The Rust↔TypeScript contract is the highest-value target for E2E or contract testing**, because `src/native/types.ts` (1,285 LOC) is hand-maintained against 25 Rust model modules.

### 7.2 `ProductionAgentRuntime` is untested

All 43 swarm tests run against `SimAdapter`. The production runtime — which spawns real PTYs, parses real provider JSONL, and drives the completion gate — has no direct coverage. This is defensible (it needs a real CLI) but means the most consequential code path in the agentic layer is verified only by manual use.

### 7.3 The database layer is untested at its boundary

~8,000 LOC across `database/swarm.rs`, `database/database_studio.rs`, `database/intelligence.rs`, `database/graph.rs`, `database/code.rs` have no `mod tests`. Two specific defects found in this audit live exactly there and **would have been caught by a boundary test**:

- `swarm_evidence.payload_json` hardcoded to `'{}'` (`database/swarm.rs:1547`)
- the `mission_tasks` zombie FK making every audit `task_id` `NULL` (`database/repository.rs:475`)

### 7.4 The command layer is untested

`commands/*.rs` (~3,000 LOC) has almost no coverage. This is where authorisation checks live (`require_project_scope`, `validate_workspace_caller`, `require_main_window`). The checks are duplicated six times and none of the copies has a test asserting it rejects an unauthorised caller.

**This is the highest-priority test gap from a security standpoint.**

### 7.5 No coverage measurement in CI

`@vitest/coverage-v8` is a devDependency but `run-checks.ps1` runs `npm test -- --run` without `--coverage`, and there is no `cargo-llvm-cov`/`tarpaulin`. There is no coverage number, and no threshold gate.

---

## 8. Test quality assessment

**Positives**
- Behavioural test names that document intent
- Product invariants encoded as assertions ("never fabricate", "never invent usage")
- Real temporary Git repositories in `repository_service` tests, not mocks
- A performance benchmark test (`largeSchema.bench.test.ts`)
- Migration tests asserting the schema version
- The release tooling has its own tests
- Test doubles are correctly `#[cfg(test)]`-gated — **`SimAdapter` cannot ship**
- `oxlint --deny-warnings` + `clippy -D warnings` in CI
- All 788 frontend tests pass in 17.9 s — fast enough to stay in the loop

**Negatives**
- Zero E2E
- Database and command layers untested at their boundaries
- `ProductionAgentRuntime` untested
- No coverage measurement or threshold
- No contract test between Rust models and `native/types.ts`
- No test asserting an authorisation check rejects an unauthorised caller

---

## 9. Ranked recommendations (documented only — nothing implemented)

| # | Recommendation | Why |
|---|---|---|
| 1 | Contract/E2E test for the IPC boundary | the largest silent-failure surface; 1,285 LOC of hand-mirrored types |
| 2 | Tests for `commands/*` authorisation guards | security controls with zero coverage, duplicated 6× |
| 3 | `mod tests` for `database/swarm.rs` and `database/database_studio.rs` | ~4,000 LOC, and where two real defects were found |
| 4 | Tests for `database_studio/pipeline/*` | it writes migrations into the user's repository |
| 5 | Enable coverage reporting (no threshold at first) | make the gap measurable before deciding a target |
| 6 | One real-PTY smoke test | terminals are the product's spine and are tested with `echo` |
