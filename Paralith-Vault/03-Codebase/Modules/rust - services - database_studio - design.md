---
id: module.2fb513fd0152995d
type: module
name: rust / services / database_studio / design
status: active
generated: true
confidence: 1
evidence_level: verified
created_at: 2026-08-13T19:20:37.121Z
updated_at: 2026-08-19T20:53:17.734Z
sources:
  - file:Paralith-tauri/src-tauri/src/services/database_studio/design.rs
related:
  - module.3ed764bcf4eee1d6
  - module.46540f2cc84f03ad
  - module.b04ab8816dabdb01
  - project.paralith
tags:
  - paralith
  - module
---
<!-- PARALITH:AUTO:START -->

# rust / services / database_studio / design

Rust module `Paralith-tauri/src-tauri/src/services/database_studio/design.rs` Defines: ActualDesignHead, CreateDesignRequest, CreateDraftRequest, ExpectedDesignHead, MaterializedRevision, MaterializeRevisionRequest.

## Relationships

Outgoing:
- uses -> `module.46540f2cc84f03ad` (inferred, 0.7)
- uses -> `module.3ed764bcf4eee1d6` (inferred, 0.7)
- uses -> `module.b04ab8816dabdb01` (inferred, 0.7)

Incoming:
- [[Project Overview]] -> contains_module (verified, 1)

## Evidence

- `file:Paralith-tauri/src-tauri/src/services/database_studio/design.rs`

## Metadata

```json
{
  "path": "Paralith-tauri/src-tauri/src/services/database_studio/design.rs",
  "structs": [
    "ActualDesignHead",
    "CreateDesignRequest",
    "CreateDraftRequest",
    "ExpectedDesignHead",
    "MaterializedRevision",
    "MaterializeRevisionRequest"
  ],
  "enums": [],
  "functions": [
    "actor",
    "add_table_operation",
    "apply_operation",
    "approve_design_revision",
    "archive_design",
    "compile_database_adapter_import_keeps_fixture_model_representative",
    "create_base",
    "create_design",
    "create_draft",
    "design_id",
    "expected",
    "materialize",
    "materialized_revision_is_immutable_and_never_mutated_in_place",
    "next_revision_id",
    "operation_id",
    "proposed_object_id",
    "proposed_rename_preserves_synthetic_identity_for_selection_layout_and_issue_refs",
    "reject_design_revision",
    "rename_proposed_identity",
    "revision_id",
    "setup",
    "stale_design_error",
    "stale_revision_write_is_rejected_and_losing_operation_is_not_applied",
    "table",
    "two_independent_drafts_branch_from_one_base_revision_without_interference"
  ]
}
```

<!-- PARALITH:AUTO:END -->
