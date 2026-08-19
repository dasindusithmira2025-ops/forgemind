---
id: module.021d598cbd05263a
type: module
name: rust / commands / project_commands
status: active
generated: true
confidence: 1
evidence_level: verified
created_at: 2026-08-13T19:20:37.121Z
updated_at: 2026-08-19T20:53:17.734Z
sources:
  - file:Paralith-tauri/src-tauri/src/commands/project_commands.rs
related:
  - command.get_project
  - command.list_projects_overview
  - command.list_recent_projects
  - command.open_project
  - command.relocate_project
  - command.remove_project_from_recent
  - command.validate_working_directory
  - module.187ea37b6ca4fbaf
  - module.327579f22c257d7d
  - module.b04ab8816dabdb01
  - module.b13b30928c81b69f
  - project.paralith
tags:
  - paralith
  - module
---
<!-- PARALITH:AUTO:START -->

# rust / commands / project_commands

Rust module `Paralith-tauri/src-tauri/src/commands/project_commands.rs` exposes Tauri command(s): open_project, get_project, list_recent_projects, list_projects_overview, remove_project_from_recent, relocate_project, validate_working_directory.

## Relationships

Outgoing:
- uses -> `module.b13b30928c81b69f` (inferred, 0.7)
- uses -> `module.327579f22c257d7d` (inferred, 0.7)
- uses -> `module.b04ab8816dabdb01` (inferred, 0.7)
- uses -> `module.187ea37b6ca4fbaf` (inferred, 0.7)

Incoming:
- [[Project Overview]] -> contains_module (verified, 1)
- [[open_project]] -> implemented_by (verified, 1)
- [[get_project]] -> implemented_by (verified, 1)
- [[list_recent_projects]] -> implemented_by (verified, 1)
- [[list_projects_overview]] -> implemented_by (verified, 1)
- [[remove_project_from_recent]] -> implemented_by (verified, 1)
- [[relocate_project]] -> implemented_by (verified, 1)
- [[validate_working_directory]] -> implemented_by (verified, 1)

## Evidence

- `file:Paralith-tauri/src-tauri/src/commands/project_commands.rs`

## Metadata

```json
{
  "path": "Paralith-tauri/src-tauri/src/commands/project_commands.rs",
  "structs": [],
  "enums": [],
  "functions": [
    "get_project",
    "list_projects_overview",
    "list_recent_projects",
    "open_project",
    "relocate_project",
    "remove_project_from_recent",
    "require_project_scope",
    "validate_working_directory"
  ]
}
```

<!-- PARALITH:AUTO:END -->
