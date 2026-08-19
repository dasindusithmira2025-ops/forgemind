---
id: table.bases
type: table
name: bases
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

# bases

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
    "builtin",
    "created_at",
    "description",
    "domain",
    "id",
    "name",
    "position",
    "project_id",
    "query",
    "slug",
    "slug)",
    "UNIQUE(project_id",
    "updated_at"
  ]
}
```

<!-- PARALITH:AUTO:END -->
