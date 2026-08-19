---
id: module.f2b85da004bb440a
type: module
name: rust / services / project_service
status: active
generated: true
confidence: 1
evidence_level: verified
created_at: 2026-08-13T19:20:37.121Z
updated_at: 2026-08-19T20:53:17.734Z
sources:
  - file:Paralith-tauri/src-tauri/src/services/project_service.rs
related:
  - module.3ed764bcf4eee1d6
  - module.432313b9b9997606
  - module.57709159fa023727
  - project.paralith
tags:
  - paralith
  - module
---
<!-- PARALITH:AUTO:START -->

# rust / services / project_service

Rust module `Paralith-tauri/src-tauri/src/services/project_service.rs` Defines: ProjectService.

## Relationships

Outgoing:
- uses -> `module.3ed764bcf4eee1d6` (inferred, 0.7)
- uses -> `module.432313b9b9997606` (inferred, 0.7)
- uses -> `module.57709159fa023727` (inferred, 0.7)

Incoming:
- [[Project Overview]] -> contains_module (verified, 1)

## Evidence

- `file:Paralith-tauri/src-tauri/src/services/project_service.rs`

## Metadata

```json
{
  "path": "Paralith-tauri/src-tauri/src/services/project_service.rs",
  "structs": [
    "ProjectService"
  ],
  "enums": [],
  "functions": [
    "canonical_dir",
    "detect_framework",
    "detect_languages",
    "display_path",
    "git_branch",
    "inspect",
    "path_starts_with",
    "valid_missing_and_file_paths",
    "validate_working_directory",
    "working_directory_is_safe_for_windows_child_processes"
  ]
}
```

<!-- PARALITH:AUTO:END -->
