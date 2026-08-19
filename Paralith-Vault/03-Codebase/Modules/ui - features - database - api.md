---
id: module.8f9132a9a9c5d27c
type: module
name: ui / features / database / api
status: active
generated: true
confidence: 1
evidence_level: verified
created_at: 2026-08-13T19:20:37.121Z
updated_at: 2026-08-19T20:53:17.734Z
sources:
  - file:Paralith-tauri/src/features/database/api.ts
related:
  - command.database_adapter_support
  - command.database_apply_design_operation
  - command.database_approve_design
  - command.database_archive_design
  - command.database_build_context_pack
  - command.database_compare
  - command.database_create_draft
  - command.database_discover_sources
  - command.database_get_design
  - command.database_get_layout
  - command.database_get_object
  - command.database_get_schema
  - command.database_get_source
  - command.database_implement_design
  - command.database_introspect_sqlite_file
  - command.database_list_designs
  - command.database_list_issues
  - command.database_list_migrations
  - command.database_list_sources
  - command.database_list_usage
  - command.database_publish_canvas_state
  - command.database_reject_design
  - command.database_save_layout
  - feature.database
  - project.paralith
tags:
  - paralith
  - module
---
<!-- PARALITH:AUTO:START -->

# ui / features / database / api

TypeScript module `Paralith-tauri/src/features/database/api.ts`

## Relationships

Outgoing:
- invokes -> [[database_adapter_support]] (strong, 0.9)
- invokes -> [[database_apply_design_operation]] (strong, 0.9)
- invokes -> [[database_approve_design]] (strong, 0.9)
- invokes -> [[database_archive_design]] (strong, 0.9)
- invokes -> [[database_build_context_pack]] (strong, 0.9)
- invokes -> [[database_compare]] (strong, 0.9)
- invokes -> [[database_create_draft]] (strong, 0.9)
- invokes -> [[database_discover_sources]] (strong, 0.9)
- invokes -> [[database_get_design]] (strong, 0.9)
- invokes -> [[database_get_layout]] (strong, 0.9)
- invokes -> [[database_get_object]] (strong, 0.9)
- invokes -> [[database_get_schema]] (strong, 0.9)
- invokes -> [[database_get_source]] (strong, 0.9)
- invokes -> [[database_implement_design]] (strong, 0.9)
- invokes -> [[database_introspect_sqlite_file]] (strong, 0.9)
- invokes -> [[database_list_designs]] (strong, 0.9)
- invokes -> [[database_list_issues]] (strong, 0.9)
- invokes -> [[database_list_migrations]] (strong, 0.9)
- invokes -> [[database_list_sources]] (strong, 0.9)
- invokes -> [[database_list_usage]] (strong, 0.9)
- invokes -> [[database_publish_canvas_state]] (strong, 0.9)
- invokes -> [[database_reject_design]] (strong, 0.9)
- invokes -> [[database_save_layout]] (strong, 0.9)

Incoming:
- [[Project Overview]] -> contains_module (verified, 1)
- [[Database]] -> implemented_by (verified, 1)

## Evidence

- `file:Paralith-tauri/src/features/database/api.ts`

## Metadata

```json
{
  "path": "Paralith-tauri/src/features/database/api.ts",
  "imports": [
    "./databaseTypes",
    "@tauri-apps/api/core"
  ],
  "components": [],
  "invokes": [
    "database_adapter_support",
    "database_apply_design_operation",
    "database_approve_design",
    "database_archive_design",
    "database_build_context_pack",
    "database_compare",
    "database_create_draft",
    "database_discover_sources",
    "database_get_design",
    "database_get_layout",
    "database_get_object",
    "database_get_schema",
    "database_get_source",
    "database_implement_design",
    "database_introspect_sqlite_file",
    "database_list_designs",
    "database_list_issues",
    "database_list_migrations",
    "database_list_sources",
    "database_list_usage",
    "database_publish_canvas_state",
    "database_reject_design",
    "database_save_layout"
  ]
}
```

<!-- PARALITH:AUTO:END -->
