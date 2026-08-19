---
id: module.1b8b931dec354f12
type: module
name: rust / services / database_studio / graph
status: active
generated: true
confidence: 1
evidence_level: verified
created_at: 2026-08-13T19:20:37.121Z
updated_at: 2026-08-19T20:53:17.734Z
sources:
  - file:Paralith-tauri/src-tauri/src/services/database_studio/graph.rs
related:
  - feature.memory
  - module.3ed764bcf4eee1d6
  - module.b04ab8816dabdb01
  - project.paralith
tags:
  - paralith
  - module
---
<!-- PARALITH:AUTO:START -->

# rust / services / database_studio / graph

Rust module `Paralith-tauri/src-tauri/src/services/database_studio/graph.rs` Defines: DiscoveredSource.

## Relationships

Outgoing:
- uses -> `module.3ed764bcf4eee1d6` (inferred, 0.7)
- uses -> `module.b04ab8816dabdb01` (inferred, 0.7)

Incoming:
- [[Project Overview]] -> contains_module (verified, 1)
- [[Memory]] -> implemented_by (strong, 0.9)

## Evidence

- `file:Paralith-tauri/src-tauri/src/services/database_studio/graph.rs`

## Metadata

```json
{
  "path": "Paralith-tauri/src-tauri/src/services/database_studio/graph.rs",
  "structs": [
    "DiscoveredSource"
  ],
  "enums": [],
  "functions": [
    "adapter_capabilities",
    "apply_design_operation",
    "build_snapshot",
    "columns_of",
    "companion_paths",
    "consumer_evidence",
    "design_conflict",
    "design_provenance",
    "detach_from_parents",
    "discover_project",
    "edge_id",
    "extract_declared_graph",
    "fingerprint_of",
    "graph_fingerprint",
    "is_skipped_scan_directory",
    "issues_for_graph",
    "new_proposed_identity",
    "object_meta_mut",
    "object_not_found",
    "owner_scope",
    "proposed_id",
    "push_edge",
    "relative_path",
    "remap_id",
    "remap_ids",
    "remap_object",
    "remove_subtree",
    "require_absent",
    "require_column",
    "require_column_mut",
    "... 9 more"
  ]
}
```

<!-- PARALITH:AUTO:END -->
