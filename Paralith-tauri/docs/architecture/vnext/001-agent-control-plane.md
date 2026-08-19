# ADR 001: Agent control plane and execution substrate

Status: accepted for Generation 0
Date: 2026-08-18

## Context

The Orchestration Kernel describes a privileged capability gateway with typed validation, policy,
redaction, audit, and lifecycle transitions. It currently has no provider invocation or scheduler.
`SwarmService` has the real 900 ms scheduler, task leasing, agent allocation, provider runtime,
PTY sessions, worktree isolation, recovery, evidence, reviews, and completion gate. Treating both as
execution owners would reproduce the current duplicate-control-plane defect.

## Decision

The Orchestration Control Plane owns:

- Mission and Task intent and decomposition;
- policy, approvals, capability validation, and authorization context;
- control-plane lifecycle transitions and durable intent/audit events;
- requests to execute, verify, integrate, pause, resume, cancel, or hand off.

The Agent Execution Runtime owns:

- scheduling and concurrency limits;
- provider adapter selection and CLI argv construction;
- PTY creation and process observation through TerminalManager;
- worktree allocation through RepositoryService;
- runtime event normalization, AgentRun attempt persistence, cleanup, and recovery signals.

The Control Plane submits an `AgentExecutionRequest`; it does not call `TerminalManager`, provider
CLIs, or raw process APIs. The Runtime returns an `AgentExecutionResult` and observation events; it
does not approve policy, promote knowledge, or declare completion without Proof Engine input.

## Canonical owner

The Orchestration Control Plane owns intent, policy, approvals, and task lifecycle. The Swarm-based
Agent Execution Runtime is the sole owner of scheduling and execution lifecycle.

## Existing implementation involved

- `orchestration::OrchestrationKernel`, `orchestration::policy`, `orchestration::registry`, and
  `orchestration::redaction` are retained as control-plane building blocks.
- `SwarmService`, `AgentRuntime`, `ProductionAgentRuntime`, `ProviderRuntimeAdapter`,
  `SwarmRuntimeScope`, `RuntimeStep`, and `SwarmAgentRun` are the current runtime substrate.
- `TerminalManager` is the PTY owner; `RepositoryService` is the repository/worktree process owner.

## Interfaces

```text
ControlPlane.submit(request: AgentExecutionRequest) -> AgentRunIdentity
Runtime.observe(run: AgentRunIdentity) -> RuntimeEvent stream
Runtime.finish(run: AgentRunIdentity) -> AgentExecutionResult
ControlPlane.request_verification(run, VerificationPolicy) -> VerificationRequest
```

The Rust compatibility types in `models::vnext` carry stable Mission/Task/run/context scope for
later implementations. Current Swarm methods remain the compatibility adapter until a later
generation extracts these calls.

## Invariants

- There is exactly one scheduler for a given AgentRun: the Swarm runtime in Generation 0.
- Provider adapters cannot call policy, RepositoryService mutators, MemoryService, or knowledge
  promotion directly.
- Provider choice and model configuration are recorded on the AgentRun attempt and are not inferred
  later from terminal output.
- A retry creates or preserves a distinct stable AgentRun attempt identity; prior evidence is not
  rewritten.
- Runtime events are observations, not control-plane approvals.
- Cancellation and cleanup pass through the runtime owner and preserve terminal/process semantics.

## Compatibility constraints

`SwarmService` remains callable by all current Tauri commands and keeps its scheduler, provider CLI
strategy, role permissions, worktree isolation, recovery, and tests. The Kernel's existing typed
capabilities remain valid and are not expanded to claim Swarm execution in this generation.

## Rejected alternatives

- Kernel-owned scheduling: duplicates the Swarm scheduler.
- Swarm-owned policy and approvals: makes runtime responsible for intent and authorization.
- Provider-owned Git or memory writes: bypasses repository policy and provenance.

## Migration implications

Later work should introduce a single runtime gateway around the existing Swarm methods, then move
callers one at a time. The Kernel can submit runtime requests through that gateway without acquiring
its own scheduler. Only after all callers use the gateway can internal Swarm methods be narrowed.

## Explicitly deferred

Kernel/Swarm consolidation, new mission planning, autonomous modes, provider additions, scheduler
rewrites, and changes to terminal thread architecture.
