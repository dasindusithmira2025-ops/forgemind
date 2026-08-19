---
id: table.swarms
type: table
name: swarms
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

# swarms

SQLite table discovered from migration DDL with 20 column-like entries.

## Relationships

Incoming:
- [[Paralith SQLite]] -> contains_table (verified, 1)

## Evidence

- `file:Paralith-tauri/src-tauri/src/database/migrations.rs`

## Metadata

```json
{
  "columns": [
    "archived",
    "completed_at",
    "created_at",
    "decision_json",
    "id",
    "instructions",
    "lifecycle",
    "max_parallel",
    "mission",
    "name",
    "phase",
    "priority",
    "progress",
    "project_id",
    "project_root",
    "review_verdict",
    "started_at",
    "summary_json",
    "team_preset",
    "updated_at"
  ]
}
```

<!-- PARALITH:AUTO:END -->
