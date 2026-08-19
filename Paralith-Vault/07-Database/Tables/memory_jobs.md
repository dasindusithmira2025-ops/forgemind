---
id: table.memory_jobs
type: table
name: memory_jobs
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

# memory_jobs

SQLite table discovered from migration DDL with 13 column-like entries.

## Relationships

Incoming:
- [[Paralith SQLite]] -> contains_table (verified, 1)

## Evidence

- `file:Paralith-tauri/src-tauri/src/database/migrations.rs`

## Metadata

```json
{
  "columns": [
    "attempts",
    "created_at",
    "dedup_key",
    "error",
    "finished_at",
    "id",
    "kind",
    "max_attempts",
    "payload",
    "project_id",
    "result",
    "started_at",
    "status"
  ]
}
```

<!-- PARALITH:AUTO:END -->
