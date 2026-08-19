---
id: table.terminal_sessions
type: table
name: terminal_sessions
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

# terminal_sessions

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
    "ended_at",
    "exit_code",
    "id",
    "log_path",
    "output_tail",
    "pane_id",
    "process_id",
    "provider_type",
    "started_at",
    "status",
    "title",
    "working_directory",
    "workspace_id"
  ]
}
```

<!-- PARALITH:AUTO:END -->
