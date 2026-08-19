---
id: module.a2cf4b8ecf928280
type: module
name: rust / orchestration / policy
status: active
generated: true
confidence: 1
evidence_level: verified
created_at: 2026-08-13T19:20:37.121Z
updated_at: 2026-08-19T20:53:17.734Z
sources:
  - file:Paralith-tauri/src-tauri/src/orchestration/policy.rs
related:
  - module.10c8ea0ff94c2d8d
  - project.paralith
tags:
  - paralith
  - module
---
<!-- PARALITH:AUTO:START -->

# rust / orchestration / policy

Rust module `Paralith-tauri/src-tauri/src/orchestration/policy.rs`

## Relationships

Outgoing:
- uses -> `module.10c8ea0ff94c2d8d` (inferred, 0.7)

Incoming:
- [[Project Overview]] -> contains_module (verified, 1)

## Evidence

- `file:Paralith-tauri/src-tauri/src/orchestration/policy.rs`

## Metadata

```json
{
  "path": "Paralith-tauri/src-tauri/src/orchestration/policy.rs",
  "structs": [],
  "enums": [
    "GateDecision"
  ],
  "functions": [
    "assist_requires_approval_for_any_mutation",
    "autopilot_auto_runs_high_but_never_critical",
    "descriptor",
    "evaluate",
    "execute_auto_runs_medium_but_gates_high",
    "gate",
    "observe_allows_reads_and_denies_mutations"
  ]
}
```

<!-- PARALITH:AUTO:END -->
