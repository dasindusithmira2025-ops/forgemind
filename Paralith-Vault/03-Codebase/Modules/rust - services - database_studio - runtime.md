---
id: module.4536290453bd7774
type: module
name: rust / services / database_studio / runtime
status: active
generated: true
confidence: 1
evidence_level: verified
created_at: 2026-08-13T19:20:37.121Z
updated_at: 2026-08-19T20:53:17.734Z
sources:
  - file:Paralith-tauri/src-tauri/src/services/database_studio/runtime.rs
related:
  - module.3ed764bcf4eee1d6
  - module.b04ab8816dabdb01
  - module.c1c61288f02a50d9
  - module.d1ee1cc1ad3338e5
  - project.paralith
tags:
  - paralith
  - module
---
<!-- PARALITH:AUTO:START -->

# rust / services / database_studio / runtime

Rust module `Paralith-tauri/src-tauri/src/services/database_studio/runtime.rs` Defines: CanvasScope, DatabaseCanvasContext, DatabaseCanvasSelection, DatabaseCanvasSnapshot, DatabaseCanvasStateReceipt, DatabaseCanvasViewport, DatabaseStudioRuntime, DiscoverSourcesResult, TempProject.

## Relationships

Outgoing:
- uses -> `module.d1ee1cc1ad3338e5` (inferred, 0.7)
- uses -> `module.c1c61288f02a50d9` (inferred, 0.7)
- uses -> `module.3ed764bcf4eee1d6` (inferred, 0.7)
- uses -> `module.b04ab8816dabdb01` (inferred, 0.7)

Incoming:
- [[Project Overview]] -> contains_module (verified, 1)

## Evidence

- `file:Paralith-tauri/src-tauri/src/services/database_studio/runtime.rs`

## Metadata

```json
{
  "path": "Paralith-tauri/src-tauri/src/services/database_studio/runtime.rs",
  "structs": [
    "CanvasScope",
    "DatabaseCanvasContext",
    "DatabaseCanvasSelection",
    "DatabaseCanvasSnapshot",
    "DatabaseCanvasStateReceipt",
    "DatabaseCanvasViewport",
    "DatabaseStudioRuntime",
    "DiscoverSourcesResult",
    "TempProject"
  ],
  "enums": [
    "DatabaseZoomTier",
    "DesignDecision"
  ],
  "functions": [
    "a_destructive_design_is_refused_until_it_is_explicitly_acknowledged",
    "a_dry_run_plans_the_change_without_writing_anything",
    "a_large_schema_extracts_persists_and_reads_back_within_bounds",
    "a_prisma_repository_gets_a_prisma_schema_not_arbitrary_sql",
    "a_second_draft_from_the_same_base_is_independent_of_the_first",
    "a_stale_design_token_is_rejected_without_applying_the_operation",
    "actor_kind",
    "adapter_support",
    "another_projects_ids_are_refused_even_with_a_valid_project_scope",
    "apply_design_operation",
    "apply_level_of_detail",
    "approved_registration_design",
    "build_context_pack",
    "canvas_context",
    "canvas_publication_rejects_cross_project_and_unbounded_state",
    "canvas_selection_is_project_scoped_typed_and_retrievable",
    "canvas_state",
    "collect_issues",
    "compare",
    "create_draft",
    "credentials_never_reach_the_graph_persistence_or_a_context_pack",
    "cross_project_denied",
    "decide_design",
    "declared_extraction_persists_a_queryable_graph",
    "design_bundle",
    "design_only_execution_cannot_touch_the_repository",
    "discover_sources",
    "discovery_is_static_and_a_removed_schema_removes_its_source",
    "drop",
    "emit",
    "... 38 more"
  ]
}
```

<!-- PARALITH:AUTO:END -->
