---
id: database.paralith-sqlite
type: database
name: Paralith SQLite
status: active
generated: true
confidence: 1
evidence_level: verified
created_at: 2026-08-13T19:20:37.121Z
updated_at: 2026-08-19T20:53:17.734Z
sources:
  - file:Paralith-tauri/src-tauri/src/database/migrations.rs
related:
  - project.paralith
  - table.acceptance_criteria
  - table.agent_detections
  - table.agent_profiles
  - table.agent_sessions
  - table.ai_usage_daily
  - table.ai_usage_file_checkpoints
  - table.ai_usage_snapshots
  - table.app_settings
  - table.audit_events
  - table.audit_events_v35
  - table.base_views
  - table.bases
  - table.canvas_edges
  - table.canvas_nodes
  - table.canvases
  - table.code_files
  - table.code_imports
  - table.code_index_state
  - table.code_references
  - table.code_symbols
  - table.database_design_operations
  - table.database_design_revisions
  - table.database_designs
  - table.database_diffs
  - table.database_edges
  - table.database_issues
  - table.database_layouts
  - table.database_object_provenance
  - table.database_objects
  - ... 121 more
tags:
  - paralith
  - database
---
<!-- PARALITH:AUTO:START -->

# Paralith SQLite

Application SQLite database managed by Rust migrations. Current schema version: 36.

## Relationships

Outgoing:
- contains_table -> [[schema_migrations]] (verified, 1)
- contains_table -> [[projects]] (verified, 1)
- contains_table -> [[workspaces]] (verified, 1)
- contains_table -> [[workspace_panes]] (verified, 1)
- contains_table -> [[terminal_sessions]] (verified, 1)
- contains_table -> [[agent_detections]] (verified, 1)
- contains_table -> [[shell_profiles]] (verified, 1)
- contains_table -> [[app_settings]] (verified, 1)
- contains_table -> [[workspace_events]] (verified, 1)
- contains_table -> [[terminal_sessions_rebuilt]] (verified, 1)
- contains_table -> [[metadata_quarantine]] (verified, 1)
- contains_table -> [[migration_repair_history]] (verified, 1)
- contains_table -> [[agent_profiles]] (verified, 1)
- contains_table -> [[agent_sessions]] (verified, 1)
- contains_table -> [[missions]] (verified, 1)
- contains_table -> [[acceptance_criteria]] (verified, 1)
- contains_table -> [[mission_tasks]] (verified, 1)
- contains_table -> [[task_dependencies]] (verified, 1)
- contains_table -> [[task_acceptance_criteria]] (verified, 1)
- contains_table -> [[worktrees]] (verified, 1)
- contains_table -> [[mission_sessions]] (verified, 1)
- contains_table -> [[task_events]] (verified, 1)
- contains_table -> [[verification_profiles]] (verified, 1)
- contains_table -> [[verification_checks]] (verified, 1)
- contains_table -> [[verification_results]] (verified, 1)
- contains_table -> [[evidence_records]] (verified, 1)
- contains_table -> [[audit_events]] (verified, 1)
- contains_table -> [[recovery_states]] (verified, 1)
- contains_table -> [[project_contexts]] (verified, 1)
- contains_table -> [[project_context_suggestions]] (verified, 1)
- contains_table -> [[memory_settings]] (verified, 1)
- contains_table -> [[memory_events]] (verified, 1)
- contains_table -> [[memory_items]] (verified, 1)
- contains_table -> [[memory_revisions]] (verified, 1)
- contains_table -> [[memory_sources]] (verified, 1)
- contains_table -> [[memory_revision_sources]] (verified, 1)
- contains_table -> [[memory_chunks]] (verified, 1)
- contains_table -> [[open_project_sessions]] (verified, 1)
- contains_table -> [[workspace_placements]] (verified, 1)
- contains_table -> [[monitor_aliases]] (verified, 1)

Incoming:
- [[Project Overview]] -> uses_database (verified, 1)

## Evidence

- `file:Paralith-tauri/src-tauri/src/database/migrations.rs`

## Metadata

```json
{
  "schemaVersion": "36"
}
```

<!-- PARALITH:AUTO:END -->
