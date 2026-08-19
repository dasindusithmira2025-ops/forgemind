---
id: table.repository_sync_cursors
type: table
name: repository_sync_cursors
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

# repository_sync_cursors

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
    "cursor",
    "error_code",
    "last_attempt_at",
    "last_success_at",
    "project_id",
    "provider",
    "stale_since",
    "status",
    "stream",
    "stream)"
  ]
}
```

<!-- PARALITH:AUTO:END -->
