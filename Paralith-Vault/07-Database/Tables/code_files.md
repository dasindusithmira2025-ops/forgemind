---
id: table.code_files
type: table
name: code_files
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

# code_files

SQLite table discovered from migration DDL with 12 column-like entries.

## Relationships

Incoming:
- [[Paralith SQLite]] -> contains_table (verified, 1)

## Evidence

- `file:Paralith-tauri/src-tauri/src/database/migrations.rs`

## Metadata

```json
{
  "columns": [
    "content_hash",
    "id",
    "indexed_at",
    "language",
    "line_count",
    "module",
    "parser",
    "path",
    "path)",
    "project_id",
    "size_bytes",
    "UNIQUE(project_id"
  ]
}
```

<!-- PARALITH:AUTO:END -->
