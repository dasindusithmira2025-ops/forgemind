---
id: table.shell_profiles
type: table
name: shell_profiles
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

# shell_profiles

SQLite table discovered from migration DDL with 8 column-like entries.

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
    "available",
    "created_at",
    "executable_path",
    "id",
    "name",
    "source",
    "updated_at"
  ]
}
```

<!-- PARALITH:AUTO:END -->
