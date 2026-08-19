---
id: module.b2cc1e5fcee4932c
type: module
name: rust / services / filesystem_service
status: active
generated: true
confidence: 1
evidence_level: verified
created_at: 2026-08-13T19:20:37.121Z
updated_at: 2026-08-19T20:53:17.734Z
sources:
  - file:Paralith-tauri/src-tauri/src/services/filesystem_service.rs
related:
  - module.3ed764bcf4eee1d6
  - module.b04ab8816dabdb01
  - module.c1c61288f02a50d9
  - project.paralith
tags:
  - paralith
  - module
---
<!-- PARALITH:AUTO:START -->

# rust / services / filesystem_service

Rust module `Paralith-tauri/src-tauri/src/services/filesystem_service.rs` Defines: FileSystemService, ProjectPathGuard, SelfWriteLedger, TempProject.

## Relationships

Outgoing:
- uses -> `module.c1c61288f02a50d9` (inferred, 0.7)
- uses -> `module.3ed764bcf4eee1d6` (inferred, 0.7)
- uses -> `module.b04ab8816dabdb01` (inferred, 0.7)

Incoming:
- [[Project Overview]] -> contains_module (verified, 1)

## Evidence

- `file:Paralith-tauri/src-tauri/src/services/filesystem_service.rs`

## Metadata

```json
{
  "path": "Paralith-tauri/src-tauri/src/services/filesystem_service.rs",
  "structs": [
    "FileSystemService",
    "ProjectPathGuard",
    "SelfWriteLedger",
    "TempProject"
  ],
  "enums": [],
  "functions": [
    "already_exists",
    "atomic_write",
    "atomic_write_creates_then_replaces",
    "atomic_write_preserves_unicode_paths",
    "binary_detection_and_encoding",
    "canonicalize_plain",
    "copy_directory",
    "copy_directory_is_recursive",
    "copy_entry",
    "create_directory",
    "create_file",
    "decode_text",
    "delete_entry",
    "detect_line_ending",
    "drop",
    "entry_info",
    "file_too_large",
    "guard",
    "hex_sha256",
    "is_binary",
    "is_directory_not_empty_error",
    "is_indexable_file",
    "join_relative",
    "line_ending_detection",
    "list_directory",
    "map_io",
    "mark",
    "mark_origin",
    "modified_ms",
    "new",
    "... 25 more"
  ]
}
```

<!-- PARALITH:AUTO:END -->
