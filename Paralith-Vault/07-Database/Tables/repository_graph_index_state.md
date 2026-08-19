---
id: table.repository_graph_index_state
type: table
name: repository_graph_index_state
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

# repository_graph_index_state

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
    "edge_count",
    "error_code",
    "error_message",
    "extractor_version",
    "head_sha",
    "last_success_at",
    "node_count",
    "project_id",
    "repository_id",
    "status_hash",
    "UNIQUE(project_id",
    "worktree_path",
    "worktree_path)"
  ]
}
```

<!-- PARALITH:AUTO:END -->
