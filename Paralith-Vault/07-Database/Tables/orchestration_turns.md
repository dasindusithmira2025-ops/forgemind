---
id: table.orchestration_turns
type: table
name: orchestration_turns
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

# orchestration_turns

SQLite table discovered from migration DDL with 7 column-like entries.

## Relationships

Incoming:
- [[Paralith SQLite]] -> contains_table (verified, 1)

## Evidence

- `file:Paralith-tauri/src-tauri/src/database/migrations.rs`

## Metadata

```json
{
  "columns": [
    "actor",
    "content",
    "created_at",
    "id",
    "input_type",
    "session_id",
    "transcript_confidence"
  ]
}
```

<!-- PARALITH:AUTO:END -->
