---
id: table.workspace_panes
type: table
name: workspace_panes
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

# workspace_panes

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
    "args_json",
    "created_at",
    "executable_path",
    "id",
    "position_order",
    "provider_type",
    "shell_profile_id",
    "title",
    "updated_at",
    "working_directory",
    "workspace_id"
  ]
}
```

<!-- PARALITH:AUTO:END -->
