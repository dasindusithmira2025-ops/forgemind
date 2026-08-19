---
id: table.project_context_suggestions
type: table
name: project_context_suggestions
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

# project_context_suggestions

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
    "category",
    "created_at",
    "id",
    "project_id",
    "source_path",
    "status",
    "value"
  ]
}
```

<!-- PARALITH:AUTO:END -->
