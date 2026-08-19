---
id: module.db2d474580dcebb3
type: module
name: rust / commands / update_commands
status: active
generated: true
confidence: 1
evidence_level: verified
created_at: 2026-08-13T19:20:37.121Z
updated_at: 2026-08-19T20:53:17.734Z
sources:
  - file:Paralith-tauri/src-tauri/src/commands/update_commands.rs
related:
  - command.assess_safe_restart
  - command.check_for_updates
  - command.confirm_healthy_startup
  - command.download_update
  - command.get_startup_status
  - command.get_update_status
  - command.install_downloaded_update
  - command.install_update_on_exit
  - command.restart_after_recovery
  - command.retry_update
  - command.stage_database_backup_restore
  - command.start_in_safe_mode
  - module.4cfb3251acff9ded
  - project.paralith
tags:
  - paralith
  - module
---
<!-- PARALITH:AUTO:START -->

# rust / commands / update_commands

Rust module `Paralith-tauri/src-tauri/src/commands/update_commands.rs` exposes Tauri command(s): get_update_status, get_startup_status, check_for_updates, download_update, assess_safe_restart, install_downloaded_update, install_update_on_exit, retry_update, confirm_healthy_startup, stage_database_backup_restore, start_in_safe_mode, restart_after_recovery.

## Relationships

Outgoing:
- uses -> `module.4cfb3251acff9ded` (inferred, 0.7)

Incoming:
- [[Project Overview]] -> contains_module (verified, 1)
- [[get_update_status]] -> implemented_by (verified, 1)
- [[get_startup_status]] -> implemented_by (verified, 1)
- [[check_for_updates]] -> implemented_by (verified, 1)
- [[download_update]] -> implemented_by (verified, 1)
- [[assess_safe_restart]] -> implemented_by (verified, 1)
- [[install_downloaded_update]] -> implemented_by (verified, 1)
- [[install_update_on_exit]] -> implemented_by (verified, 1)
- [[retry_update]] -> implemented_by (verified, 1)
- [[confirm_healthy_startup]] -> implemented_by (verified, 1)
- [[stage_database_backup_restore]] -> implemented_by (verified, 1)
- [[start_in_safe_mode]] -> implemented_by (verified, 1)
- [[restart_after_recovery]] -> implemented_by (verified, 1)

## Evidence

- `file:Paralith-tauri/src-tauri/src/commands/update_commands.rs`

## Metadata

```json
{
  "path": "Paralith-tauri/src-tauri/src/commands/update_commands.rs",
  "structs": [],
  "enums": [],
  "functions": [
    "assess_safe_restart",
    "build_restart_assessment",
    "check_for_updates",
    "client_restart_state_defaults_to_no_unsaved_work",
    "confirm_healthy_startup",
    "download_update",
    "gather_restart_inputs",
    "get_startup_status",
    "get_update_status",
    "install_downloaded_update",
    "install_update_on_exit",
    "perform_install",
    "reject_hard_blocked",
    "restart_after_recovery",
    "retry_update",
    "stage_database_backup_restore",
    "start_in_safe_mode"
  ]
}
```

<!-- PARALITH:AUTO:END -->
