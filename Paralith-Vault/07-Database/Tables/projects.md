---
id: table.projects
type: table
name: projects
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

# projects

SQLite table discovered from migration DDL with 14 column-like entries.

## Relationships

Incoming:
- [[Paralith SQLite]] -> contains_table (verified, 1)

## Evidence

- `file:Paralith-tauri/src-tauri/src/database/migrations.rs`

## Metadata

```json
{
  "columns": [
    "canonical_root_path",
    "created_at",
    "detected_framework",
    "git_branch",
    "has_lockfile",
    "has_package_json",
    "id",
    "is_git_repository",
    "last_opened_at",
    "major_languages_json",
    "name",
    "package_manager",
    "root_path",
    "updated_at"
  ]
}
```

<!-- PARALITH:AUTO:END -->
