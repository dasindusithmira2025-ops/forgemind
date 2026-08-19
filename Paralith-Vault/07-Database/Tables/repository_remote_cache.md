---
id: table.repository_remote_cache
type: table
name: repository_remote_cache
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

# repository_remote_cache

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
    "deleted_at",
    "etag",
    "external_id",
    "external_id)",
    "fetched_at",
    "object_kind",
    "payload_json",
    "project_id",
    "provider",
    "remote_updated_at",
    "stale_at",
    "updated_cursor"
  ]
}
```

<!-- PARALITH:AUTO:END -->
