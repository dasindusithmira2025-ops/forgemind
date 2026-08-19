---
id: module.e1d06a1633c8ca40
type: module
name: rust / commands / filesystem_commands
status: active
generated: true
confidence: 1
evidence_level: verified
created_at: 2026-08-13T19:20:37.121Z
updated_at: 2026-08-19T20:53:17.734Z
sources:
  - file:Paralith-tauri/src-tauri/src/commands/filesystem_commands.rs
related:
  - command.copy_project_entry
  - command.create_project_directory
  - command.create_project_file
  - command.delete_project_entry
  - command.list_project_directory
  - command.read_project_file
  - command.rename_project_entry
  - command.search_project_files
  - command.unwatch_project_files
  - command.watch_project_files
  - command.write_project_file
  - module.3ed764bcf4eee1d6
  - module.b04ab8816dabdb01
  - module.b13b30928c81b69f
  - project.paralith
tags:
  - paralith
  - module
---
<!-- PARALITH:AUTO:START -->

# rust / commands / filesystem_commands

Rust module `Paralith-tauri/src-tauri/src/commands/filesystem_commands.rs` exposes Tauri command(s): list_project_directory, read_project_file, write_project_file, create_project_file, create_project_directory, rename_project_entry, copy_project_entry, delete_project_entry, search_project_files, watch_project_files, unwatch_project_files.

## Relationships

Outgoing:
- uses -> `module.b13b30928c81b69f` (inferred, 0.7)
- uses -> `module.3ed764bcf4eee1d6` (inferred, 0.7)
- uses -> `module.b04ab8816dabdb01` (inferred, 0.7)

Incoming:
- [[Project Overview]] -> contains_module (verified, 1)
- [[list_project_directory]] -> implemented_by (verified, 1)
- [[read_project_file]] -> implemented_by (verified, 1)
- [[write_project_file]] -> implemented_by (verified, 1)
- [[create_project_file]] -> implemented_by (verified, 1)
- [[create_project_directory]] -> implemented_by (verified, 1)
- [[rename_project_entry]] -> implemented_by (verified, 1)
- [[copy_project_entry]] -> implemented_by (verified, 1)
- [[delete_project_entry]] -> implemented_by (verified, 1)
- [[search_project_files]] -> implemented_by (verified, 1)
- [[watch_project_files]] -> implemented_by (verified, 1)
- [[unwatch_project_files]] -> implemented_by (verified, 1)

## Evidence

- `file:Paralith-tauri/src-tauri/src/commands/filesystem_commands.rs`

## Metadata

```json
{
  "path": "Paralith-tauri/src-tauri/src/commands/filesystem_commands.rs",
  "structs": [],
  "enums": [],
  "functions": [
    "copy_project_entry",
    "create_project_directory",
    "create_project_file",
    "delete_project_entry",
    "list_project_directory",
    "read_project_file",
    "rename_project_entry",
    "require_project_scope",
    "search_project_files",
    "unwatch_project_files",
    "watch_project_files",
    "worker_failed",
    "write_project_file"
  ]
}
```

<!-- PARALITH:AUTO:END -->
