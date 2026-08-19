---
id: module.3e5db0b6716e2965
type: module
name: rust / services / code_intelligence
status: active
generated: true
confidence: 1
evidence_level: verified
created_at: 2026-08-19T20:46:38.099Z
updated_at: 2026-08-19T20:53:17.734Z
sources:
  - file:Paralith-tauri/src-tauri/src/services/code_intelligence.rs
related:
  - module.21268adefa7cc90f
  - module.3ed764bcf4eee1d6
  - module.9ac7cbcc593bb61d
  - module.c1c61288f02a50d9
  - module.ff961c9ef27c62b9
  - project.paralith
tags:
  - paralith
  - module
---
<!-- PARALITH:AUTO:START -->

# rust / services / code_intelligence

Rust module `Paralith-tauri/src-tauri/src/services/code_intelligence.rs` Defines: CodeIntelligence.

## Relationships

Outgoing:
- uses -> `module.c1c61288f02a50d9` (inferred, 0.7)
- uses -> `module.3ed764bcf4eee1d6` (inferred, 0.7)
- uses -> `module.21268adefa7cc90f` (inferred, 0.7)
- uses -> `module.9ac7cbcc593bb61d` (inferred, 0.7)
- uses -> `module.ff961c9ef27c62b9` (inferred, 0.7)

Incoming:
- [[Project Overview]] -> contains_module (verified, 1)

## Evidence

- `file:Paralith-tauri/src-tauri/src/services/code_intelligence.rs`

## Metadata

```json
{
  "path": "Paralith-tauri/src-tauri/src/services/code_intelligence.rs",
  "structs": [
    "CodeIntelligence"
  ],
  "enums": [
    "IndexOutcome"
  ],
  "functions": [
    "a",
    "b",
    "dependencies",
    "dependency_directories_never_enter_the_walk",
    "file_symbols",
    "files",
    "guard",
    "hash_of",
    "hashing_is_content_addressed",
    "impact",
    "index_one",
    "index_paths",
    "is_excluded_directory",
    "is_indexable",
    "naming_a_path_inherits_the_same_rejection_as_opening_one",
    "new",
    "normalize_relative",
    "only_source_and_manifests_are_indexable",
    "reindex_project",
    "resolve_specifier",
    "search_symbols",
    "specifiers_resolve_against_the_indexed_file_set",
    "state",
    "symbol_detail",
    "walk"
  ]
}
```

<!-- PARALITH:AUTO:END -->
