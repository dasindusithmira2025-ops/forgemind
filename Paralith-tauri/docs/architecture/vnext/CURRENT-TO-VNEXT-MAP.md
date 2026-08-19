# Current-to-VNext map

Status: Generation 2 context convergence
Date: 2026-08-18

This map is a compatibility inventory, not a claim that all target wiring exists. `KEEP` means the
current implementation remains the substrate. `MOVE` means later callers should use the declared
owner. `CONSOLIDATE` means duplicate ownership must disappear only after an explicit migration.

| Current component | VNext owner | Current conflicting/overlapping owner | Action | Generation |
|---|---|---|---|---|
| `services/swarm_service.rs` / `database/swarm.rs` | Agent Execution Runtime, with Proof and Knowledge adapters | Orchestration Kernel conceptually claims orchestration; Swarm also drives terminal state | KEEP runtime machinery; MOVE future control calls behind one runtime boundary | G0 contract; later incremental extraction |
| `orchestration/kernel.rs` | Orchestration Control Plane | Swarm scheduler is the only other execution-control claimant | KEEP typed capability/policy/redaction/audit/transition concepts; do not add scheduler | G0 boundary; later consolidation |
| `services/context_compiler.rs` | Context Fabric | none in managed execution | KEEP as canonical compiler and managed-launch gateway | G2 complete |
| `swarm_compiled_context_packs` | Context Fabric provenance | v18 `swarm_context_packs` is historical read compatibility | KEEP immutable AgentRun-scoped writer; RETAIN v18 rows read-only | G2 complete |
| `services/memory_service.rs` | Knowledge Fabric / MemoryItem | none in Swarm launch | KEEP canonical Memory persistence; compiler consumes attributed candidates | G2 complete |
| `services/knowledge_lifecycle.rs` | Knowledge Fabric lifecycle | File watcher and Swarm enqueue jobs but do not own the worker | KEEP durable job owner | G0 |
| `services/knowledge_intelligence.rs` | Knowledge Fabric candidate/conflict policy | MemoryService stores records but must not decide promotion | KEEP review/promotion policy | G0 |
| `services/code_intelligence.rs`, `code_parser.rs` | Context Fabric code candidate source | editor consumers remain future work | KEEP derived graph; compiler now consumes indexed candidates | G2 runtime wiring |
| `services/semantic.rs`, `embeddings.rs` | Context Fabric optional candidate source | none | KEEP candidate-only role; compiler degrades deterministically when unavailable | G2 runtime wiring |
| `services/terminal_manager.rs` | TerminalManager | SwarmService drives and persists agent-session state around the PTY | KEEP sole PTY/process lifetime owner | G0 |
| Swarm terminal helper calls | Agent Execution Runtime using TerminalManager | TerminalManager owns the actual session and process | CONSOLIDATE state/lifecycle authority without deleting Swarm functionality | later runtime extraction |
| `services/repository_service.rs` | RepositoryService | Direct `Command::new("git")` calls bypass this queue/policy path | KEEP sole Git/GitHub/worktree process owner | G0 |
| direct `Command::new("git")` paths | RepositoryService | `RepositoryService::run_program` is the canonical queued/audited path | MOVE only in a later focused change; preserve current read behavior in G0 | later |
| `services/database_studio/*` | Database Studio domain service over DatabaseService | DatabaseService persists schema but must not own Studio semantics | KEEP domain behavior; DatabaseService remains infrastructure | G0 |
| `database/mod.rs`, migrations, backups | DatabaseService | Domain database modules can be mistaken for persistence owners | KEEP persistence infrastructure; do not become domain owner | G0 |
| `services/agent_handoff.rs` / `AgentHandoff` | Knowledge Fabric bridge | SwarmService triggers creation; Knowledge services consume it | KEEP handoff generation; future pane agents use same path | G0 contract; later extension |
| `swarm_evidence`, test records, completion gate | Proof Engine | Provider runtime emits observations; legacy evidence tables are unused | KEEP current proof machinery; add structured evidence later | G0 contract; later proof migration |
| `swarm_tasks` / `SwarmTask` | Task compatibility representation | Legacy mission tables and Kernel session concepts overlap intent | KEEP current executable task; map to canonical Task identity | G0 |
| `missions`, `mission_sessions`, `orchestration_sessions` | Control-plane Mission compatibility | `Swarm` free-text mission and task graph carry overlapping intent today | RETAIN readable; no new owner; migrate only with data plan | later |
| `SwarmAgentRun` / `swarm_agent_runs` | AgentRun | TerminalSession and SwarmAgent identify related resources but not attempts | KEEP durable attempt identity and snapshots | G0 |
| `SwarmRuntimeKind`, model registry, provider adapters | Provider boundary | Terminal pane provider launch has a separate non-Swarm path | KEEP CLI strategy and adapter responsibilities | G0 |
| Swarm attention requests | future Notification/Attention owner | Swarm-local attention is the only current producer; no global owner exists | KEEP local attention semantics; do not invent global center in G0 | later |
| schema intelligence in Database Studio | Database schema intelligence | DatabaseService owns schema/migration infrastructure, not interpretation | KEEP Database Studio projection; DatabaseService stores schema infrastructure | G0 |

## Boundary notes

### Swarm vs Kernel

Swarm schedules and executes. Kernel validates control-plane capabilities and policy. Neither may
grow into the other's owner during Generation 0.

### Context

`ContextCompiler` is the one selector/compiler for Memory preview and managed Swarm launch. The
v18 table is historical read compatibility only; no latest-eight launch selector remains.

### Proof

Provider events, test records, evidence records, repository audit, and review are inputs to Proof;
only Proof decides completion. Current role-specific gate behavior remains compatibility behavior.

### Persistence

No table is declared canonical merely because it exists. Current schema has legacy/planned tables;
ownership follows live writers and the service boundary, with cleanup deferred.

## Generation checkpoints

- **G0:** contracts, owner map, compatibility identities, and regression protection; no runtime
  consolidation.
- **G1:** one control-plane-to-Swarm runtime gateway and ContextCompiler launch adapter, preserving
  current provider/PTY behavior.
- **Later:** proof payload/criteria migration, knowledge extension to pane agents, repository path
  consolidation, schema cleanup, and any Kernel internal retirement.
