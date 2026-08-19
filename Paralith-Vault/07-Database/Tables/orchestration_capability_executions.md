---
id: table.orchestration_capability_executions
type: table
name: orchestration_capability_executions
status: active
generated: true
confidence: 1
evidence_level: verified
created_at: 2026-08-13T19:20:37.121Z
updated_at: 2026-08-19T20:53:17.734Z
sources:
  - file:Paralith-tauri/src-tauri/src/database/migrations.rs
related:
  - database.paralith-sqlite
tags:
  - paralith
  - table
---
<!-- PARALITH:AUTO:START -->

# orchestration_capability_executions

SQLite table discovered from migration DDL with 11 column-like entries.

## Relationships

Incoming:
- [[Paralith SQLite]] -> contains_table (verified, 1)

## Evidence

- `file:Paralith-tauri/src-tauri/src/database/migrations.rs`

## Metadata

```json
{
  "columns": [
    "capability_id",
    "completed_at",
    "created_at",
    "duration_ms",
    "error_classification",
    "id",
    "risk_level",
    "sanitized_result_json",
    "session_id",
    "state",
    "validated_inputs_json"
  ]
}
```

<!-- PARALITH:AUTO:END -->
