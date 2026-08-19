---
id: table.repository_graph_edges
type: table
name: repository_graph_edges
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

# repository_graph_edges

SQLite table discovered from migration DDL with 18 column-like entries.

## Relationships

Incoming:
- [[Paralith SQLite]] -> contains_table (verified, 1)

## Evidence

- `file:Paralith-tauri/src-tauri/src/database/migrations.rs`

## Metadata

```json
{
  "columns": [
    "confidence",
    "created_at",
    "edge_type",
    "id",
    "metadata_json",
    "project_id",
    "provenance_json",
    "repository_id",
    "snapshot_id",
    "snapshot_id)",
    "source_node_id",
    "target_node_id",
    "UNIQUE(project_id",
    "updated_at"
  ]
}
```

<!-- PARALITH:AUTO:END -->
