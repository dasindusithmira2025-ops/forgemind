---
id: table.skills
type: table
name: skills
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

# skills

SQLite table discovered from migration DDL with 24 column-like entries.

## Relationships

Incoming:
- [[Paralith SQLite]] -> contains_table (verified, 1)

## Evidence

- `file:Paralith-tauri/src-tauri/src/database/migrations.rs`

## Metadata

```json
{
  "columns": [
    "activation",
    "author",
    "builtin_revision",
    "capabilities",
    "created_at",
    "description",
    "id",
    "input_contract",
    "instructions",
    "last_used_at",
    "name",
    "origin",
    "output_contract",
    "permissions",
    "project_id",
    "resources",
    "scripts",
    "slug",
    "source_path",
    "tags",
    "trust",
    "updated_at",
    "usage_count",
    "version"
  ]
}
```

<!-- PARALITH:AUTO:END -->
