---
id: module.047efa1b7aefe4eb
type: module
name: rust / models / vnext
status: active
generated: true
confidence: 1
evidence_level: verified
created_at: 2026-08-19T20:46:38.099Z
updated_at: 2026-08-19T20:53:17.734Z
sources:
  - file:Paralith-tauri/src-tauri/src/models/vnext.rs
related:
  - project.paralith
tags:
  - paralith
  - module
---
<!-- PARALITH:AUTO:START -->

# rust / models / vnext

Rust module `Paralith-tauri/src-tauri/src/models/vnext.rs` Defines: AgentExecutionRequest, AgentExecutionResult, CompiledContextPack, MissionIdentity, StructuredEvidence, TaskIdentity, VerificationPolicy, VerificationRequirement, VerificationResult.

## Relationships

Incoming:
- [[Project Overview]] -> contains_module (verified, 1)

## Evidence

- `file:Paralith-tauri/src-tauri/src/models/vnext.rs`

## Metadata

```json
{
  "path": "Paralith-tauri/src-tauri/src/models/vnext.rs",
  "structs": [
    "AgentExecutionRequest",
    "AgentExecutionResult",
    "CompiledContextPack",
    "MissionIdentity",
    "StructuredEvidence",
    "TaskIdentity",
    "VerificationPolicy",
    "VerificationRequirement",
    "VerificationResult"
  ],
  "enums": [
    "VerificationRequirementKind"
  ],
  "functions": [
    "compatibility_identities_round_trip_with_stable_wire_names",
    "context",
    "context_scope_rejects_a_pack_from_another_project",
    "execution_scope_requires_matching_project_task_and_run",
    "for_task",
    "none",
    "request",
    "requires",
    "structured_evidence_version",
    "validate_scope"
  ]
}
```

<!-- PARALITH:AUTO:END -->
