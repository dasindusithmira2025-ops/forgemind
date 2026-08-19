---
id: module.acd22d87faf8fec2
type: module
name: rust / database / repository
status: active
generated: true
confidence: 1
evidence_level: verified
created_at: 2026-08-13T19:20:37.121Z
updated_at: 2026-08-19T20:53:17.734Z
sources:
  - file:Paralith-tauri/src-tauri/src/database/repository.rs
related:
  - module.3ed764bcf4eee1d6
  - module.b04ab8816dabdb01
  - project.paralith
tags:
  - paralith
  - module
---
<!-- PARALITH:AUTO:START -->

# rust / database / repository

Rust module `Paralith-tauri/src-tauri/src/database/repository.rs` Defines: NewRepositoryOperation.

## Relationships

Outgoing:
- uses -> `module.3ed764bcf4eee1d6` (inferred, 0.7)
- uses -> `module.b04ab8816dabdb01` (inferred, 0.7)

Incoming:
- [[Project Overview]] -> contains_module (verified, 1)

## Evidence

- `file:Paralith-tauri/src-tauri/src/database/repository.rs`

## Metadata

```json
{
  "path": "Paralith-tauri/src-tauri/src/database/repository.rs",
  "structs": [
    "NewRepositoryOperation"
  ],
  "enums": [],
  "functions": [
    "append_repository_audit",
    "consume_repository_approval",
    "count_active_git_mutations",
    "decide_repository_approval",
    "finish_repository_operation",
    "graph_json",
    "graph_kind_error",
    "insert_repository_approval",
    "insert_repository_operation",
    "insert_worktree_lease",
    "latest_repository_intelligence",
    "list_repository_approvals",
    "list_repository_worktree_leases",
    "load_remote_projection",
    "load_remote_sync_statuses",
    "map_approval",
    "map_graph_edge",
    "map_graph_node",
    "map_lease",
    "map_operation",
    "mark_remote_projection_kind_stale",
    "parse_operation_status",
    "persist_repository_snapshot",
    "policy_kind",
    "provenance",
    "provisioned_db",
    "reconcile_interrupted_repository_operations",
    "replace_remote_projection_kind",
    "replace_repository_graph_snapshot",
    "replace_repository_graph_snapshot_binds_parameters_and_resists_sql_injection",
    "... 14 more"
  ]
}
```

<!-- PARALITH:AUTO:END -->
