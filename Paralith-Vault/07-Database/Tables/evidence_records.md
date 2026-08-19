---
id: table.evidence_records
type: table
name: evidence_records
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

# evidence_records

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
    "acceptance_criterion_id",
    "artifact_path",
    "command",
    "created_at",
    "evidence_type",
    "id",
    "metadata_json",
    "mission_id",
    "source_path",
    "status",
    "summary",
    "task_id",
    "title"
  ]
}
```

<!-- PARALITH:AUTO:END -->
