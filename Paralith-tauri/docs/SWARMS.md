# Swarm Runtime

Swarms are project-scoped multi-agent executions. `SwarmService` is the only lifecycle and
scheduling authority. React renders persisted projections and never advances runtime state.

## Domain and persistence

- `swarms` and `swarm_roles` hold reusable configuration and the current projection.
- `swarm_agents` are stable configured members. A role is a capability label; allocation counts
  permit multiple members in one role and mixed Claude/Codex pools.
- `swarm_runs` records every launch or retry. The partial unique index permits one active run per
  Swarm.
- `swarm_agent_runs` records each task attempt, its member, terminal/process identity, outcome,
  failure, cancellation and evidence. Retries append attempts.
- `swarm_tasks` and `swarm_task_deps` remain the adaptive work graph.
- `swarm_attention_requests` binds input or permission to one run, attempt, member and task. A
  resolved, expired or superseded request cannot authorize another attempt.
- `swarm_events.sequence` is monotonic per Swarm. `swarms.revision` versions authoritative UI
  projections across windows.

Migration 21 adds run, attempt and attention history without replacing current-state tables.
Existing non-draft Swarms receive one legacy run; an unfinished legacy lifecycle is marked
`interrupted` rather than falsely active.

## Execution flow

1. A Tauri command validates main-window scope and delegates to `SwarmService`.
2. The service validates project ownership, the canonical root, attachments, role allocation and
   provider availability.
3. Launch creates one durable run before decomposition or process creation.
4. A per-Swarm mutex serializes commands and scheduler ticks. SQLite predicates atomically claim a
   ready task and idle member while appending the attempt.
5. `ProductionAgentRuntime` uses the existing `TerminalManager`, provider adapters, project-scoped
   working directory, Memory context packs and repository worktree service.
6. Structured provider events update tasks, evidence, tests and sessions. Output remains in the
   bounded terminal log; it is not copied into the activity feed or Memory.
7. Every meaningful mutation is persisted, advances the revision and emits `swarm-changed` when a
   Tauri app handle exists. Windows refetch authoritative state and reject stale responses.

## Lifecycle operations

- **Start:** serialized and idempotent; an active-run index and conditional task claims prevent
  duplicate provider processes.
- **Pause:** checkpoint-and-stop. Active provider processes receive cancellation, open attempts are
  marked `interrupted`, assignments are released, and unfinished work returns to the dependency
  graph. No UI claims that an arbitrary provider process is suspended.
- **Resume:** claims unfinished work as a new attempt, preserving prior evidence.
- **Stop:** moves through stopping, signals each active runtime, records cancellation, releases task
  ownership/worktrees as allowed, and reaches `cancelled` or an actionable failure.
- **Retry:** valid for failed/cancelled Swarms. Reset and new-run creation share one transaction;
  work re-enters dependency evaluation and attempt numbers remain monotonic.
- **Attention:** permission/input ends the one-shot provider attempt and persists an exact request.
  Approval queues the response for a new attempt; denial fails only the bound work. Duplicate or
  late responses return `swarm_attention_stale`.

On restart the scheduler reads active persisted Swarms. A terminal absent from the in-process
terminal owner is treated as lost, its attempt is recorded for recovery, and work is reconstructed
from persisted task, message, provider-session and Memory context rather than displaying a stale
running process.

## Verification

Use the repository commands, in this order:

```powershell
npm run typecheck
npm run lint
npm test
npm run build
cd src-tauri
cargo fmt --all -- --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test --all-targets --all-features
```

For runtime changes, also launch `npm run tauri dev` with isolated application data and verify a
real Claude/Codex machine-protocol run, terminal focus, cancellation and restart reconciliation.
