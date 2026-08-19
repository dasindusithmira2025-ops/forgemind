---
id: table.database_usage_refs
type: table
name: database_usage_refs
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

# database_usage_refs

SQLite table discovered from migration DDL with 15 column-like entries.

## Relationships

Incoming:
- [[Paralith SQLite]] -> contains_table (verified, 1)

## Evidence

- `file:Paralith-tauri/src-tauri/src/database/migrations.rs`

## Metadata

```json
{
  "columns": [
    "access_kind",
    "certainty",
    "confidence",
    "content_sha256",
    "end_column",
    "end_line",
    "id",
    "observed_at",
    "project_id",
    "relative_path",
    "semantic_object_id",
    "source_id",
    "start_column",
    "start_line",
    "symbol"
  ]
}
```

<!-- PARALITH:AUTO:END -->
