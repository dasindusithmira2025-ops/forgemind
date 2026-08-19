---
id: module.b565ebd6d5faf24e
type: module
name: rust / database / legacy_migration
status: active
generated: true
confidence: 1
evidence_level: verified
created_at: 2026-08-13T19:20:37.121Z
updated_at: 2026-08-19T20:53:17.734Z
sources:
  - file:Paralith-tauri/src-tauri/src/database/legacy_migration.rs
related:
  - project.paralith
tags:
  - paralith
  - module
---
<!-- PARALITH:AUTO:START -->

# rust / database / legacy_migration

Rust module `Paralith-tauri/src-tauri/src/database/legacy_migration.rs` Defines: LegacyMigrationRoots, LegacyMigrationStatus.

## Relationships

Incoming:
- [[Project Overview]] -> contains_module (verified, 1)

## Evidence

- `file:Paralith-tauri/src-tauri/src/database/legacy_migration.rs`

## Metadata

```json
{
  "path": "Paralith-tauri/src-tauri/src/database/legacy_migration.rs",
  "structs": [
    "LegacyMigrationRoots",
    "LegacyMigrationStatus"
  ],
  "enums": [
    "LegacyMigrationState"
  ],
  "functions": [
    "apply_validation",
    "base_status",
    "copy_file_new",
    "copy_missing",
    "existing_paralith_database_is_never_overwritten_by_legacy_data",
    "find_latest_legacy_backup",
    "load_status",
    "local_development_not_applicable",
    "mark_recovered",
    "migrate_inner",
    "migrate_legacy_stable",
    "migration_error",
    "preview_never_reads_or_copies_stable_data",
    "rename_legacy_log_copies",
    "roots",
    "save_status",
    "stable_migration_is_backed_up_validated_and_idempotent"
  ]
}
```

<!-- PARALITH:AUTO:END -->
