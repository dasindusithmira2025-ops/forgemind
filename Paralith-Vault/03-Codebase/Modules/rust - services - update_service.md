---
id: module.5986ae41fbaa9924
type: module
name: rust / services / update_service
status: active
generated: true
confidence: 1
evidence_level: verified
created_at: 2026-08-13T19:20:37.121Z
updated_at: 2026-08-19T20:53:17.734Z
sources:
  - file:Paralith-tauri/src-tauri/src/services/update_service.rs
related:
  - project.paralith
tags:
  - paralith
  - module
---
<!-- PARALITH:AUTO:START -->

# rust / services / update_service

Rust module `Paralith-tauri/src-tauri/src/services/update_service.rs` Defines: DownloadProgress, Runtime, StartupContext, UpdateService.

## Relationships

Incoming:
- [[Project Overview]] -> contains_module (verified, 1)

## Evidence

- `file:Paralith-tauri/src-tauri/src/services/update_service.rs`

## Metadata

```json
{
  "path": "Paralith-tauri/src-tauri/src/services/update_service.rs",
  "structs": [
    "DownloadProgress",
    "Runtime",
    "StartupContext",
    "UpdateService"
  ],
  "enums": [],
  "functions": [
    "attach_app",
    "broadcast_progress",
    "broadcast_status",
    "channel_schema_and_rollout_rules_are_enforced",
    "check",
    "confirm_healthy_startup",
    "create_current_database",
    "create_malformed_v10_database",
    "current",
    "database_path",
    "development_startup_ignores_post_update_flow_without_explicit_test",
    "download",
    "fail_startup",
    "fresh_journal",
    "genuine_post_update_first_launch_uses_pending_transition",
    "health_check_started",
    "history",
    "installation_pending",
    "lifecycle_rejects_install_before_verified_download",
    "load_journal",
    "mark_schema_migration_required",
    "migration_started",
    "new",
    "new_with_context",
    "no_update_journal",
    "normal_startup_with_no_update_and_no_schema_migration",
    "normal_startup_with_no_update_runs_required_schema_migration_independently",
    "pending_update_journal",
    "permits_post_update_recovery",
    "persist",
    "... 27 more"
  ]
}
```

<!-- PARALITH:AUTO:END -->
