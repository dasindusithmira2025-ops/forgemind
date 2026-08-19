---
id: table.verification_results
type: table
name: verification_results
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

# verification_results

SQLite table discovered from migration DDL with 10 column-like entries.

## Relationships

Incoming:
- [[Paralith SQLite]] -> contains_table (verified, 1)

## Evidence

- `file:Paralith-tauri/src-tauri/src/database/migrations.rs`

## Metadata

```json
{
  "columns": [
    "artifact_ids_json",
    "check_id",
    "completed_at",
    "duration_ms",
    "exit_code",
    "id",
    "output_excerpt",
    "started_at",
    "status",
    "task_id"
  ]
}
```

<!-- PARALITH:AUTO:END -->
