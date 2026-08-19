---
id: module.c9280959d7f06e1a
type: module
name: rust / commands / database_commands
status: active
generated: true
confidence: 1
evidence_level: verified
created_at: 2026-08-13T19:20:37.121Z
updated_at: 2026-08-19T20:53:17.734Z
sources:
  - file:Paralith-tauri/src-tauri/src/commands/database_commands.rs
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
  - module.3ed764bcf4eee1d6
  - module.a8ddb8bf88c5edd7
  - module.b04ab8816dabdb01
  - module.b13b30928c81b69f
  - project.paralith
tags:
  - paralith
  - module
---
<!-- PARALITH:AUTO:START -->

# rust / commands / database_commands

Rust module `Paralith-tauri/src-tauri/src/commands/database_commands.rs` exposes Tauri command(s): database_discover_sources, database_list_sources, database_publish_canvas_state, database_get_source, database_get_schema, database_get_object, database_compare, database_list_migrations, database_list_usage, database_list_issues, database_introspect_sqlite_file, database_create_draft, database_list_designs, database_ge

## Relationships

Outgoing:
- uses -> `module.b13b30928c81b69f` (inferred, 0.7)
- uses -> `module.3ed764bcf4eee1d6` (inferred, 0.7)
- uses -> `module.b04ab8816dabdb01` (inferred, 0.7)
- uses -> `module.a8ddb8bf88c5edd7` (inferred, 0.7)

Incoming:
- [[Project Overview]] -> contains_module (verified, 1)
- [[database_discover_sources]] -> implemented_by (verified, 1)
- [[database_list_sources]] -> implemented_by (verified, 1)
- [[database_publish_canvas_state]] -> implemented_by (verified, 1)
- [[database_get_source]] -> implemented_by (verified, 1)
- [[database_get_schema]] -> implemented_by (verified, 1)
- [[database_get_object]] -> implemented_by (verified, 1)
- [[database_compare]] -> implemented_by (verified, 1)
- [[database_list_migrations]] -> implemented_by (verified, 1)
- [[database_list_usage]] -> implemented_by (verified, 1)
- [[database_list_issues]] -> implemented_by (verified, 1)
- [[database_introspect_sqlite_file]] -> implemented_by (verified, 1)
- [[database_create_draft]] -> implemented_by (verified, 1)
- [[database_list_designs]] -> implemented_by (verified, 1)
- [[database_get_design]] -> implemented_by (verified, 1)
- [[database_apply_design_operation]] -> implemented_by (verified, 1)
- [[database_approve_design]] -> implemented_by (verified, 1)
- [[database_reject_design]] -> implemented_by (verified, 1)
- [[database_archive_design]] -> implemented_by (verified, 1)
- [[database_save_layout]] -> implemented_by (verified, 1)
- [[database_get_layout]] -> implemented_by (verified, 1)
- [[database_build_context_pack]] -> implemented_by (verified, 1)
- [[database_adapter_support]] -> implemented_by (verified, 1)
- [[database_implement_design]] -> implemented_by (verified, 1)

## Evidence

- `file:Paralith-tauri/src-tauri/src/commands/database_commands.rs`

## Metadata

```json
{
  "path": "Paralith-tauri/src-tauri/src/commands/database_commands.rs",
  "structs": [
    "DatabaseProjectRequest",
    "PublishDatabaseCanvasStateRequest"
  ],
  "enums": [],
  "functions": [
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
    "database_save_layout",
    "human_actor",
    "require_database_project_scope"
  ]
}
```

<!-- PARALITH:AUTO:END -->
