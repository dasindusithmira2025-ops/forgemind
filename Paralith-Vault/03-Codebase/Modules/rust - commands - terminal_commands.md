---
id: module.bc11f5871d8ec2b7
type: module
name: rust / commands / terminal_commands
status: active
generated: true
confidence: 1
evidence_level: verified
created_at: 2026-08-13T19:20:37.121Z
updated_at: 2026-08-19T20:53:17.734Z
sources:
  - file:Paralith-tauri/src-tauri/src/commands/terminal_commands.rs
related:
  - command.create_terminal_session
  - command.list_live_sessions
  - command.reset_restoration_circuit
  - command.resize_terminal_session
  - command.restore_workspace_sessions
  - command.save_dropped_image
  - command.terminal_session_status
  - command.terminate_terminal_session
  - command.terminate_workspace_sessions
  - command.write_terminal_input
  - module.3ed764bcf4eee1d6
  - module.b04ab8816dabdb01
  - module.b13b30928c81b69f
  - project.paralith
tags:
  - paralith
  - module
---
<!-- PARALITH:AUTO:START -->

# rust / commands / terminal_commands

Rust module `Paralith-tauri/src-tauri/src/commands/terminal_commands.rs` exposes Tauri command(s): create_terminal_session, write_terminal_input, resize_terminal_session, terminate_terminal_session, terminate_workspace_sessions, list_live_sessions, terminal_session_status, restore_workspace_sessions, reset_restoration_circuit, save_dropped_image.

## Relationships

Outgoing:
- uses -> `module.b13b30928c81b69f` (inferred, 0.7)
- uses -> `module.3ed764bcf4eee1d6` (inferred, 0.7)
- uses -> `module.b04ab8816dabdb01` (inferred, 0.7)

Incoming:
- [[Project Overview]] -> contains_module (verified, 1)
- [[create_terminal_session]] -> implemented_by (verified, 1)
- [[write_terminal_input]] -> implemented_by (verified, 1)
- [[resize_terminal_session]] -> implemented_by (verified, 1)
- [[terminate_terminal_session]] -> implemented_by (verified, 1)
- [[terminate_workspace_sessions]] -> implemented_by (verified, 1)
- [[list_live_sessions]] -> implemented_by (verified, 1)
- [[terminal_session_status]] -> implemented_by (verified, 1)
- [[restore_workspace_sessions]] -> implemented_by (verified, 1)
- [[reset_restoration_circuit]] -> implemented_by (verified, 1)
- [[save_dropped_image]] -> implemented_by (verified, 1)

## Evidence

- `file:Paralith-tauri/src-tauri/src/commands/terminal_commands.rs`

## Metadata

```json
{
  "path": "Paralith-tauri/src-tauri/src/commands/terminal_commands.rs",
  "structs": [],
  "enums": [],
  "functions": [
    "blocking_task_error",
    "create_terminal_session",
    "image_io_error",
    "list_live_sessions",
    "prune_old_images",
    "reset_restoration_circuit",
    "resize_terminal_session",
    "restore_workspace_sessions",
    "sanitize_extension",
    "save_dropped_image",
    "session_workspace",
    "terminal_session_status",
    "terminate_terminal_session",
    "terminate_workspace_sessions",
    "write_temp_image",
    "write_terminal_input"
  ]
}
```

<!-- PARALITH:AUTO:END -->
