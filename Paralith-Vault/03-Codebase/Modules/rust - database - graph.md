---
id: module.9b49a96055854b0d
type: module
name: rust / database / graph
status: active
generated: true
confidence: 1
evidence_level: verified
created_at: 2026-08-13T19:20:37.121Z
updated_at: 2026-08-19T20:53:17.734Z
sources:
  - file:Paralith-tauri/src-tauri/src/database/graph.rs
related:
  - feature.memory
  - module.25e67b966e7e8dc2
  - module.327579f22c257d7d
  - module.92d5d514129ecb8a
  - module.970c3b894e9c6f2c
  - project.paralith
tags:
  - paralith
  - module
---
<!-- PARALITH:AUTO:START -->

# rust / database / graph

Rust module `Paralith-tauri/src-tauri/src/database/graph.rs` Defines: ContextBody, GraphRow, RawEdge, RelationEdge.

## Relationships

Outgoing:
- uses -> `module.327579f22c257d7d` (inferred, 0.7)
- uses -> `module.970c3b894e9c6f2c` (inferred, 0.7)
- uses -> `module.92d5d514129ecb8a` (inferred, 0.7)
- uses -> `module.25e67b966e7e8dc2` (inferred, 0.7)

Incoming:
- [[Project Overview]] -> contains_module (verified, 1)
- [[Memory]] -> implemented_by (strong, 0.9)

## Evidence

- `file:Paralith-tauri/src-tauri/src/database/graph.rs`

## Metadata

```json
{
  "path": "Paralith-tauri/src-tauri/src/database/graph.rs",
  "structs": [
    "ContextBody",
    "GraphRow",
    "RawEdge",
    "RelationEdge"
  ],
  "enums": [],
  "functions": [
    "append_evidence",
    "append_tags",
    "breadth_first",
    "context_bodies",
    "escape_like",
    "impact_report",
    "knowledge_graph",
    "knowledge_health",
    "load_link_edges",
    "load_relation_edges",
    "load_rows",
    "mark_memories_stale",
    "memory_node_id",
    "relations_touching",
    "standing_context"
  ]
}
```

<!-- PARALITH:AUTO:END -->
