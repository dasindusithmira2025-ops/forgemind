---
id: module.a0513e0ec39a7d67
type: module
name: rust / database / mod
status: active
generated: true
confidence: 1
evidence_level: verified
created_at: 2026-08-13T19:20:37.121Z
updated_at: 2026-08-19T20:53:17.734Z
sources:
  - file:Paralith-tauri/src-tauri/src/database/mod.rs
related:
  - module.2918990634698585
  - module.3ed764bcf4eee1d6
  - module.57709159fa023727
  - module.b04ab8816dabdb01
  - project.paralith
tags:
  - paralith
  - module
---
<!-- PARALITH:AUTO:START -->

# rust / database / mod

Rust module `Paralith-tauri/src-tauri/src/database/mod.rs` Defines: DatabaseService, PaneWorktreeRecord.

## Relationships

Outgoing:
- uses -> `module.3ed764bcf4eee1d6` (inferred, 0.7)
- uses -> `module.b04ab8816dabdb01` (inferred, 0.7)
- uses -> `module.2918990634698585` (inferred, 0.7)
- uses -> `module.57709159fa023727` (inferred, 0.7)

Incoming:
- [[Project Overview]] -> contains_module (verified, 1)

## Evidence

- `file:Paralith-tauri/src-tauri/src/database/mod.rs`

## Metadata

```json
{
  "path": "Paralith-tauri/src-tauri/src/database/mod.rs",
  "structs": [
    "DatabaseService",
    "PaneWorktreeRecord"
  ],
  "enums": [],
  "functions": [
    "canvas_layout_round_trips_and_enforces_revision",
    "capture_provider_session_id",
    "claim_agent_resume",
    "clone_resume_pane",
    "create_resume_terminal_request",
    "delete_workspace_configuration",
    "dismiss_agent_resume",
    "dismiss_all_agent_resumes",
    "duplicate_workspace",
    "exact_resume_arguments",
    "exact_resume_preview",
    "get_agent_resume_record",
    "get_project",
    "get_settings",
    "get_terminal_session",
    "get_workspace",
    "get_workspace_canvas_layout",
    "git_common_directory",
    "health_report",
    "in_memory",
    "join_root",
    "list_agent_profiles",
    "list_agent_resume_records",
    "list_agent_sessions",
    "list_custom_shell_profiles",
    "list_projects_overview",
    "list_recent_projects",
    "list_recent_workspaces",
    "list_workspaces_for_project",
    "load_panes",
    "... 45 more"
  ]
}
```

<!-- PARALITH:AUTO:END -->
