---
id: table.project_contexts
type: table
name: project_contexts
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

# project_contexts

SQLite table discovered from migration DDL with 9 column-like entries.

## Relationships

Incoming:
- [[Paralith SQLite]] -> contains_table (verified, 1)

## Evidence

- `file:Paralith-tauri/src-tauri/src/database/migrations.rs`

## Metadata

```json
{
  "columns": [
    "architecture_summary",
    "build_commands_json",
    "conventions_json",
    "important_paths_json",
    "project_id",
    "technology_stack_json",
    "test_commands_json",
    "updated_at",
    "user_instructions_json"
  ]
}
```

<!-- PARALITH:AUTO:END -->
