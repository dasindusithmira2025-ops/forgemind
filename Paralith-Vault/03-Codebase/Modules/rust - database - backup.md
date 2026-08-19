---
id: module.60b1253d1c0a4f39
type: module
name: rust / database / backup
status: active
generated: true
confidence: 1
evidence_level: verified
created_at: 2026-08-13T19:20:37.121Z
updated_at: 2026-08-19T20:53:17.734Z
sources:
  - file:Paralith-tauri/src-tauri/src/database/backup.rs
related:
  - module.3ed764bcf4eee1d6
  - project.paralith
tags:
  - paralith
  - module
---
<!-- PARALITH:AUTO:START -->

# rust / database / backup

Rust module `Paralith-tauri/src-tauri/src/database/backup.rs` Defines: BackupFile, BackupManifest, BackupRoots, DatabaseValidation.

## Relationships

Outgoing:
- uses -> `module.3ed764bcf4eee1d6` (inferred, 0.7)

Incoming:
- [[Project Overview]] -> contains_module (verified, 1)

## Evidence

- `file:Paralith-tauri/src-tauri/src/database/backup.rs`

## Metadata

```json
{
  "path": "Paralith-tauri/src-tauri/src/database/backup.rs",
  "structs": [
    "BackupFile",
    "BackupManifest",
    "BackupRoots",
    "DatabaseValidation"
  ],
  "enums": [],
  "functions": [
    "apply_staged_restore",
    "backup_error",
    "collect_files",
    "copy_state_tree",
    "create_live_update_backup",
    "create_pre_migration_backup",
    "create_recovery_backup",
    "create_recovery_backup_with_options",
    "creates_consistent_backup_without_touching_external_projects",
    "default_backup_base",
    "is_database_sidecar",
    "is_excluded",
    "live_update_backup_excludes_the_active_webview_profile",
    "sanitize_reason",
    "sha256_file",
    "stage_restore_request",
    "validate_backup_manifest",
    "validate_database"
  ]
}
```

<!-- PARALITH:AUTO:END -->
