---
id: module.b8cccd02181d5db3
type: module
name: rust / services / file_watch_service
status: active
generated: true
confidence: 1
evidence_level: verified
created_at: 2026-08-13T19:20:37.121Z
updated_at: 2026-08-19T20:53:17.734Z
sources:
  - file:Paralith-tauri/src-tauri/src/services/file_watch_service.rs
related:
  - module.3ed764bcf4eee1d6
  - module.b04ab8816dabdb01
  - module.c1c61288f02a50d9
  - module.d77bf3a4f12cf627
  - project.paralith
tags:
  - paralith
  - module
---
<!-- PARALITH:AUTO:START -->

# rust / services / file_watch_service

Rust module `Paralith-tauri/src-tauri/src/services/file_watch_service.rs` Defines: ChangeSinks, FileWatchService, ProjectWatch.

## Relationships

Outgoing:
- uses -> `module.c1c61288f02a50d9` (inferred, 0.7)
- uses -> `module.3ed764bcf4eee1d6` (inferred, 0.7)
- uses -> `module.b04ab8816dabdb01` (inferred, 0.7)
- uses -> `module.d77bf3a4f12cf627` (inferred, 0.7)

Incoming:
- [[Project Overview]] -> contains_module (verified, 1)

## Evidence

- `file:Paralith-tauri/src-tauri/src/services/file_watch_service.rs`

## Metadata

```json
{
  "path": "Paralith-tauri/src-tauri/src/services/file_watch_service.rs",
  "structs": [
    "ChangeSinks",
    "FileWatchService",
    "ProjectWatch"
  ],
  "enums": [],
  "functions": [
    "access_events_are_dropped",
    "an_external_write_during_the_same_window_outranks_a_self_write",
    "classifies_create_modify_delete",
    "classify_event",
    "coalescing_rules",
    "deregister",
    "deregister_everywhere",
    "flush",
    "forget_window",
    "ignores_git_internals_temp_files_and_out_of_root_paths",
    "is_ignored_relative",
    "large_burst_coalesces_duplicate_paths",
    "merge_change",
    "merge_origin",
    "new",
    "paralith_own_writes_are_attributed_rather_than_dropped",
    "relativize",
    "root",
    "spawn_debounce_thread",
    "the_memory_mirror_is_distinguishable_from_a_user_editing_the_same_directory",
    "two_ended_rename_becomes_delete_and_create",
    "under",
    "unwatch",
    "watch",
    "watcher_failed",
    "with_code_intelligence",
    "with_database_studio",
    "with_knowledge_lifecycle"
  ]
}
```

<!-- PARALITH:AUTO:END -->
