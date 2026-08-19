# ADR 000: Paralith VNext system architecture

Status: accepted for Generation 0
Date: 2026-08-18
Scope: architecture and compatibility boundaries only

## Context

Paralith already has strong execution, terminal, repository, persistence, and knowledge
machinery, but the machinery is not one control flow. The live Swarm engine schedules provider
processes, owns task lifecycle, records evidence, and creates handoffs. The Orchestration Kernel
owns typed capabilities, policy decisions, redaction, audit rows, and transition validation, but
does not invoke providers or schedule work. ContextCompiler, the semantic index, and the code graph
exist beside a raw SQL context snapshot used by Swarm launch. Several domain names also have legacy
schema counterparts.

The implementation is the source of truth. This ADR records the target composition without claiming
that the composition has already been implemented.

## Decision

VNext uses this one-way engineering flow:

```text
User intent
  -> Orchestration Control Plane
  -> Context Fabric compilation
  -> Agent Execution Runtime
  -> Observation
  -> Proof / Verification
  -> Integration
  -> Handoff
  -> Knowledge Fabric
  -> future context
```

The canonical ownership split is:

| Boundary | Canonical owner | Responsibility |
|---|---|---|
| Product aggregate | `ProjectService` / Project persistence | Project identity and root path |
| Spatial/runtime environment | Workspace persistence and `WindowRegistry` | Workspace layout, placement, leases, caller ownership |
| Intent | Orchestration Control Plane | Mission and Task intent, planning, policy, approvals, lifecycle |
| Execution | `SwarmService`-based Agent Execution Runtime | scheduling, provider processes, PTYs, worktrees, execution lifecycle |
| Context | `ContextCompiler`-based Context Fabric | deterministic retrieval, packing, citations, code/semantic candidate contribution |
| Proof | Proof Engine | acceptance criteria, evidence, verification, completion decision |
| Knowledge | Memory/Knowledge services | claims, sources, handoffs, candidates, conflicts, lifecycle |
| Git/GitHub process | `RepositoryService` | repository process execution, policy, approval, audit, provenance |
| PTY lifetime | `TerminalManager` | terminal process lifetime, I/O, resize, exit, cleanup |
| Persistence infrastructure | `DatabaseService` | SQLite connections, migrations, transactions, backups, schema health |

The Orchestration Kernel is not a second runtime. Its useful policy, capability validation,
redaction, audit, and transition concepts are retained as control-plane machinery. Swarm remains the
execution substrate until a later, explicitly reviewed consolidation moves responsibilities one
boundary at a time.

### Boundary interfaces

The following interfaces are the Generation 0 vocabulary. Existing equivalent types are canonical:

| VNext name | Current implementation contract |
|---|---|
| `ContextRequest` | `models::context::ContextRequest` |
| `CompiledContextPack` | `models::context::ContextPack`, scoped by `models::vnext::CompiledContextPack` until launch wiring exists |
| `AgentExecutionRequest` | future request boundary; current scheduler inputs are `Swarm`, `SwarmTask`, `SwarmAgent`, and `SwarmRuntimeScope` |
| `AgentExecutionResult` | future result boundary; current observations are `RuntimeStep`, `SwarmAgentRun`, and normalized runtime events |
| `VerificationPolicy` / `VerificationRequirement` / `VerificationResult` | future proof boundary; current gate is `SwarmService::completion_gate_failure` plus test/evidence records |
| `StructuredEvidence` | additive future form of `SwarmEvidence`; no persistence change in Generation 0 |
| `AgentHandoff` | `models::intelligence::AgentHandoff` and `services::agent_handoff` |
| `ProviderAdapter` | existing `ProviderRuntimeAdapter`; it constructs provider argv and maps provider protocol, not policy or knowledge |
| `MissionIdentity` / `TaskIdentity` | `models::vnext` compatibility identities; they do not replace current Swarm schema in this generation |

## Existing implementation involved

- `src-tauri/src/services/swarm_service.rs` — live scheduler, provider adapters, PTY-backed runtime,
  worktrees, task lifecycle, evidence, completion gate, review, recovery, and handoff trigger.
- `src-tauri/src/orchestration/{kernel,model,policy,redaction,registry}.rs` — typed capability,
  policy, audit, redaction, and transition skeleton.
- `src-tauri/src/services/context_compiler.rs` and `models/context.rs` — deterministic context
  retrieval, token budgeting, conflicts, staleness, handoffs, and cache.
- `src-tauri/src/services/{memory_service,knowledge_intelligence,knowledge_lifecycle}.rs` —
  canonical knowledge storage, candidate review, and lifecycle jobs.
- `src-tauri/src/services/{terminal_manager,repository_service}.rs` — process and repository owners.
- `src-tauri/src/database/{mod,swarm,repository}.rs` — persistence and current compatibility debt.

## Invariants

1. Only the Agent Execution Runtime schedules provider work or owns execution lifecycle.
2. The Control Plane may decide intent, policy, approval, and task state, but cannot spawn a
   provider, own a PTY, or directly mutate knowledge.
3. Context is compiled before execution and is attributable to Project, Task, and AgentRun.
4. Observation is not proof. A provider completion event cannot alone decide success.
5. Proof is decided by verification policy and persisted evidence, not by UI state or prose alone.
6. Knowledge writes retain provenance and remain reviewable; handoffs are evidence/candidates, not
   automatic canonical memory.
7. Remote Git operations require RepositoryService policy and approval semantics; a model request
   is never sufficient authorization.
8. Runtime events and control-plane events have distinct domains and cannot be interpreted as one
   another.
9. Existing Swarm behavior remains available while the boundaries are migrated incrementally.

## Compatibility constraints

- Existing Tauri commands, persisted Swarm identifiers, provider CLI execution, PTY behavior,
  worktree isolation, and context-pack provenance remain compatible.
- `SwarmTask` is the current executable-task representation; `TaskIdentity` maps to it without
  renaming the table or breaking `swarm_*` consumers.
- `OrchestrationSession` and legacy mission columns remain readable until a migration explicitly
  defines their replacement. No Generation 0 deletion or schema migration is allowed.
- CLI providers remain the only model execution strategy. No direct model API is introduced.
- Existing `AgentHandoff` and knowledge candidate policy remain authoritative for current writes.

## Rejected alternatives

- Expanding the Kernel into a second scheduler: duplicates Swarm's proven lifecycle and PTY/runtime
  behavior.
- Replacing Swarm now: risks the strongest working agentic subsystem and violates the staged scope.
- Wiring new features directly to raw database tables: recreates duplicate readers and bypasses
  service ownership.
- Treating the audit documents as authoritative over code: the audit is evidence and a starting map,
  while current implementation decides what exists.

## Migration implications

Generation 1 may route Swarm context compilation through ContextCompiler and persist the scoped
pack without changing provider strategy. Later generations can move control-plane task planning
and policy calls around the runtime, then retire or migrate legacy concepts only after readers,
writers, and data compatibility are proven.

## Explicitly deferred

No Mission UI, runtime rewrite, Kernel rewrite/removal, context-launch wiring, semantic retrieval,
code-graph UI, notification system, MCP/Skills/Bases/Canvas, schema cleanup, provider strategy
change, direct model API, commit, push, or publish is part of Generation 0.
