---
id: table.repository_connections
type: table
name: repository_connections
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

# repository_connections

SQLite table discovered from migration DDL with 17 column-like entries.

## Relationships

Incoming:
- [[Paralith SQLite]] -> contains_table (verified, 1)

## Evidence

- `file:Paralith-tauri/src-tauri/src/database/migrations.rs`

## Metadata

```json
{
  "columns": [
    "canonical_repository_path",
    "canonical_repository_path)",
    "created_at",
    "default_branch",
    "id",
    "last_branch",
    "last_head_sha",
    "last_inspected_at",
    "last_status_hash",
    "project_id",
    "provider",
    "provider_account_id",
    "provider_host",
    "provider_repository_id",
    "repository_path",
    "UNIQUE(project_id",
    "updated_at"
  ]
}
```

<!-- PARALITH:AUTO:END -->
