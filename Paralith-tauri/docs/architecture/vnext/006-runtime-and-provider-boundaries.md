# ADR 006: Runtime and provider boundaries

Status: accepted for Generation 0
Date: 2026-08-18

## Context

Paralith deliberately executes Claude Code and Codex CLI (and terminal-only OpenCode) in real PTYs.
Current provider adapters construct argv and use provider permission/sandbox features. The runtime
also owns session identity, event normalization, retries, worktrees, and cleanup. These guarantees
must survive later control-plane work.

## Decision

The Agent Execution Runtime is the only owner of execution lifecycle. `ProviderRuntimeAdapter` is a
narrow adapter with these responsibilities:

- declare provider identity and supported runtime;
- construct argv from a validated execution scope, task, agent configuration, context, and optional
  provider session resume id;
- map provider-native structured output into normalized runtime observations;
- expose provider session identity and exit/result information through the runtime.

The adapter must not decide mission/task policy, approve Git operations, write Memory, promote
KnowledgeCandidate, or directly own PTYs. `TerminalManager` remains the process/PTY owner and
`RepositoryService` remains the Git/worktree process owner.

## Canonical owner

The Agent Execution Runtime owns execution lifecycle. `ProviderRuntimeAdapter` owns only the
provider-specific argv/protocol translation within that runtime.

## Existing implementation involved

- `services/swarm_service.rs`: `AgentRuntime`, `ProductionAgentRuntime`, `ClaudeAdapter`,
  `CodexAdapter`, runtime event normalization and scheduler.
- `services/terminal_manager.rs`: PTY lifetime, bounded output, resize, status, exit, cleanup.
- `services/repository_service.rs`: worktree leases and repository operation execution.
- `models/agent.rs`, `models/swarm.rs`, and `agents/model_registry.rs`: provider/model identities.

## Interfaces

The current `ProviderRuntimeAdapter::arguments` is retained. The eventual runtime boundary is:

```text
ProviderAdapter.arguments(validated scope + execution request) -> argv
ProviderAdapter.normalize(provider output) -> RuntimeEvent
ExecutionRuntime.start(request) -> AgentRunIdentity
ExecutionRuntime.observe(run) -> RuntimeEvent
ExecutionRuntime.stop(run, reason) -> Result
```

The existing `AgentRuntime::advance` remains the scheduler compatibility seam until a later
generation extracts the process/event implementation.

## Invariants

- CLI execution remains argv-based, never a shell command string.
- Provider permission/sandbox settings are derived from validated role policy, not provider prose.
- A provider cannot widen filesystem, Git, or network authority beyond the request/runtime scope.
- `AgentRun` identity is stable and each attempt records provider/model/config snapshots.
- PTY input/output/resize/exit/cancellation are owned by TerminalManager.
- Runtime event normalization is idempotent and distinguishes malformed/unavailable output from
  success.

## Compatibility constraints

Claude/Codex CLI execution and OpenCode terminal behavior are unchanged. `SwarmRuntimeKind::Auto`
remains current compatibility behavior until a separate fix resolves it before launch. No direct
model API, provider credential store, or provider-strategy change is permitted here.

## Rejected alternatives

- Direct HTTP model adapters: violates the existing CLI-only product contract.
- Provider-specific schedulers: duplicates runtime lifecycle and makes retries inconsistent.
- PTY ownership in React or the Kernel: breaks process lifetime and multi-window safety.

## Migration implications

Later runtime extraction must preserve provider session resume, terminal session IDs, worktree
identity, event receipts, cancellation, and cleanup. It should first wrap existing Swarm methods,
then move call sites without changing provider argv.

## Explicitly deferred

New providers, API integrations, PTY thread redesign, Auto-runtime repair, provider UI, and runtime
consolidation.
