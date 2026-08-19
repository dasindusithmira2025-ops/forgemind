---
id: module.ac76fefbc6c02ce0
type: module
name: rust / services / database_studio / health
status: active
generated: true
confidence: 1
evidence_level: verified
created_at: 2026-08-13T19:20:37.121Z
updated_at: 2026-08-19T20:53:17.734Z
sources:
  - file:Paralith-tauri/src-tauri/src/services/database_studio/health.rs
related:
  - module.b04ab8816dabdb01
  - project.paralith
tags:
  - paralith
  - module
---
<!-- PARALITH:AUTO:START -->

# rust / services / database_studio / health

Rust module `Paralith-tauri/src-tauri/src/services/database_studio/health.rs` Defines: HealthIssue.

## Relationships

Outgoing:
- uses -> `module.b04ab8816dabdb01` (inferred, 0.7)

Incoming:
- [[Project Overview]] -> contains_module (verified, 1)

## Evidence

- `file:Paralith-tauri/src-tauri/src/services/database_studio/health.rs`

## Metadata

```json
{
  "path": "Paralith-tauri/src-tauri/src/services/database_studio/health.rs",
  "structs": [
    "HealthIssue"
  ],
  "enums": [],
  "functions": [
    "column",
    "destructive_proposed_change_is_critical_and_drift_is_separate",
    "deterministic_health_reports_missing_pk_broken_reference_and_duplicate_index",
    "duplicate_index_issues",
    "evaluate_diff_health",
    "evaluate_graph_health",
    "foreign_key_type_mismatch_is_detected_on_canonical_type_not_spelling",
    "matching_canonical_types_do_not_report_a_mismatch",
    "meta",
    "table",
    "unindexed_foreign_key_issues"
  ]
}
```

<!-- PARALITH:AUTO:END -->
