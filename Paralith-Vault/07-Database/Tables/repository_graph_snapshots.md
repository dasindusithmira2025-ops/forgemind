---
id: table.repository_graph_snapshots
type: table
name: repository_graph_snapshots
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

# repository_graph_snapshots

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
    "created_at",
    "extractor_version",
    "head_sha",
    "id",
    "impact_json",
    "project_id",
    "repository_id",
    "status_hash",
    "worktree_path"
  ]
}
```

<!-- PARALITH:AUTO:END -->
