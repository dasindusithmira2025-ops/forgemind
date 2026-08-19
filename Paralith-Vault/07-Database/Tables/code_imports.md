---
id: table.code_imports
type: table
name: code_imports
status: active
generated: true
confidence: 1
evidence_level: verified
created_at: 2026-08-19T20:46:38.099Z
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

# code_imports

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
    "external",
    "file_id",
    "id",
    "line",
    "path",
    "project_id",
    "resolved_path",
    "specifier",
    "symbols"
  ]
}
```

<!-- PARALITH:AUTO:END -->
