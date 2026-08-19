---
id: table.repository_graph_nodes
type: table
name: repository_graph_nodes
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

# repository_graph_nodes

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
    "content_hash",
    "created_at",
    "display_label",
    "external_key",
    "id",
    "metadata_json",
    "node_type",
    "project_id",
    "provenance_json",
    "repository_id",
    "snapshot_id",
    "snapshot_id)",
    "UNIQUE(project_id",
    "updated_at"
  ]
}
```

<!-- PARALITH:AUTO:END -->
