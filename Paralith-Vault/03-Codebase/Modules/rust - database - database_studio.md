---
id: module.0200b563cfd35be2
type: module
name: rust / database / database_studio
status: active
generated: true
confidence: 1
evidence_level: verified
created_at: 2026-08-13T19:20:37.121Z
updated_at: 2026-08-19T20:53:17.734Z
sources:
  - file:Paralith-tauri/src-tauri/src/database/database_studio.rs
related:
  - module.22862c4478cd609b
  - module.3ed764bcf4eee1d6
  - module.b04ab8816dabdb01
  - project.paralith
tags:
  - paralith
  - module
---
<!-- PARALITH:AUTO:START -->

# rust / database / database_studio

Rust module `Paralith-tauri/src-tauri/src/database/database_studio.rs` Defines: IssueDetail, RevisionDecision.

## Relationships

Outgoing:
- uses -> `module.3ed764bcf4eee1d6` (inferred, 0.7)
- uses -> `module.b04ab8816dabdb01` (inferred, 0.7)
- uses -> `module.22862c4478cd609b` (inferred, 0.7)

Incoming:
- [[Project Overview]] -> contains_module (verified, 1)

## Evidence

- `file:Paralith-tauri/src-tauri/src/database/database_studio.rs`

## Metadata

```json
{
  "path": "Paralith-tauri/src-tauri/src/database/database_studio.rs",
  "structs": [
    "IssueDetail",
    "RevisionDecision"
  ],
  "enums": [
    "GraphRef"
  ],
  "functions": [
    "actor_columns",
    "actor_from_columns",
    "columns",
    "compare_and_materialize_revision",
    "create_design_with_initial_revision",
    "database_studio_get_design",
    "database_studio_get_layout",
    "database_studio_get_revision",
    "database_studio_get_snapshot",
    "database_studio_get_source",
    "database_studio_latest_snapshot",
    "database_studio_list_designs",
    "database_studio_list_evidence",
    "database_studio_list_issues",
    "database_studio_list_operations",
    "database_studio_list_revisions",
    "database_studio_list_sources",
    "database_studio_list_usage",
    "database_studio_load_graph",
    "database_studio_put_revision_graph",
    "database_studio_put_snapshot",
    "database_studio_replace_issues",
    "database_studio_replace_sources",
    "database_studio_replace_usage",
    "database_studio_save_layout",
    "database_studio_with_connection",
    "design_from_row",
    "design_status",
    "enum_value",
    "evidence_from_row",
    "... 30 more"
  ]
}
```

<!-- PARALITH:AUTO:END -->
