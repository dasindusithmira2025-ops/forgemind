---
id: module.8f64e1756443dc51
type: module
name: rust / services / database_studio / usage
status: active
generated: true
confidence: 1
evidence_level: verified
created_at: 2026-08-13T19:20:37.121Z
updated_at: 2026-08-19T20:53:17.734Z
sources:
  - file:Paralith-tauri/src-tauri/src/services/database_studio/usage.rs
related:
  - module.327579f22c257d7d
  - module.b04ab8816dabdb01
  - project.paralith
tags:
  - paralith
  - module
---
<!-- PARALITH:AUTO:START -->

# rust / services / database_studio / usage

Rust module `Paralith-tauri/src-tauri/src/services/database_studio/usage.rs`

## Relationships

Outgoing:
- uses -> `module.327579f22c257d7d` (inferred, 0.7)
- uses -> `module.b04ab8816dabdb01` (inferred, 0.7)

Incoming:
- [[Project Overview]] -> contains_module (verified, 1)

## Evidence

- `file:Paralith-tauri/src-tauri/src/services/database_studio/usage.rs`

## Metadata

```json
{
  "path": "Paralith-tauri/src-tauri/src/services/database_studio/usage.rs",
  "structs": [],
  "enums": [],
  "functions": [
    "classify_access",
    "defining_schema_file_is_provenance_not_usage",
    "digest",
    "extract_usage",
    "find_identifier",
    "graph",
    "identifier_matching_does_not_report_substring_hits",
    "is_identifier_char",
    "register",
    "relative_path",
    "scan_files",
    "usage_id",
    "usage_locates_column_references_with_spans_and_access_kind"
  ]
}
```

<!-- PARALITH:AUTO:END -->
