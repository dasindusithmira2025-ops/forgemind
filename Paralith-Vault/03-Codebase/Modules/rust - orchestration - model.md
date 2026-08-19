---
id: module.25af975548dde86c
type: module
name: rust / orchestration / model
status: active
generated: true
confidence: 1
evidence_level: verified
created_at: 2026-08-13T19:20:37.121Z
updated_at: 2026-08-19T20:53:17.734Z
sources:
  - file:Paralith-tauri/src-tauri/src/orchestration/model.rs
related:
  - project.paralith
tags:
  - paralith
  - module
---
<!-- PARALITH:AUTO:START -->

# rust / orchestration / model

Rust module `Paralith-tauri/src-tauri/src/orchestration/model.rs` Defines: CapabilityExecution, CapabilityOutcome, CreateSessionRequest, ExecuteCapabilityRequest, OrchestrationEvent, OrchestrationSession, OrchestrationSessionView, OrchestrationTurn.

## Relationships

Incoming:
- [[Project Overview]] -> contains_module (verified, 1)

## Evidence

- `file:Paralith-tauri/src-tauri/src/orchestration/model.rs`

## Metadata

```json
{
  "path": "Paralith-tauri/src-tauri/src/orchestration/model.rs",
  "structs": [
    "CapabilityExecution",
    "CapabilityOutcome",
    "CreateSessionRequest",
    "ExecuteCapabilityRequest",
    "OrchestrationEvent",
    "OrchestrationSession",
    "OrchestrationSessionView",
    "OrchestrationTurn"
  ],
  "enums": [
    "CapabilityDomain",
    "CapabilityEffectClass",
    "DatabaseExecutionEnvelope",
    "ExecutionState",
    "InputType",
    "OperatingMode",
    "OriginatingSurface",
    "Reversibility",
    "RiskLevel",
    "SessionState",
    "TurnActor"
  ],
  "functions": [
    "as_str",
    "can_transition_to",
    "cancellation_and_failure_are_reachable_from_any_active_state",
    "direct_action_happy_path_transitions_are_valid",
    "from_db",
    "illegal_jumps_are_rejected",
    "is_active",
    "is_terminal",
    "pause_resume_is_supported",
    "risk_levels_are_ordered_for_gate_comparison",
    "terminal_states_reject_all_transitions"
  ]
}
```

<!-- PARALITH:AUTO:END -->
