---
id: table.orchestration_sessions
type: table
name: orchestration_sessions
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

# orchestration_sessions

SQLite table discovered from migration DDL with 18 column-like entries.

## Relationships

Incoming:
- [[Paralith SQLite]] -> contains_table (verified, 1)

## Evidence

- `file:Paralith-tauri/src-tauri/src/database/migrations.rs`

## Metadata

```json
{
  "columns": [
    "completed_at",
    "created_at",
    "failure_classification",
    "id",
    "model",
    "normalized_objective",
    "objective",
    "operating_mode",
    "originating_surface",
    "project_id",
    "provider",
    "started_at",
    "state",
    "title",
    "token_budget",
    "tokens_used",
    "updated_at",
    "workspace_id"
  ]
}
```

<!-- PARALITH:AUTO:END -->
