---
id: module.f9cea374793888e6
type: module
name: rust / services / database_studio / diff
status: active
generated: true
confidence: 1
evidence_level: verified
created_at: 2026-08-13T19:20:37.121Z
updated_at: 2026-08-19T20:53:17.734Z
sources:
  - file:Paralith-tauri/src-tauri/src/services/database_studio/diff.rs
related:
  - module.b04ab8816dabdb01
  - project.paralith
tags:
  - paralith
  - module
---
<!-- PARALITH:AUTO:START -->

# rust / services / database_studio / diff

Rust module `Paralith-tauri/src-tauri/src/services/database_studio/diff.rs` Defines: MatchResult.

## Relationships

Outgoing:
- uses -> `module.b04ab8816dabdb01` (inferred, 0.7)

Incoming:
- [[Project Overview]] -> contains_module (verified, 1)

## Evidence

- `file:Paralith-tauri/src-tauri/src/services/database_studio/diff.rs`

## Metadata

```json
{
  "path": "Paralith-tauri/src-tauri/src/services/database_studio/diff.rs",
  "structs": [
    "MatchResult"
  ],
  "enums": [],
  "functions": [
    "a_not_null_column_on_a_brand_new_table_is_not_breaking",
    "adding_a_not_null_column_without_a_default_is_breaking",
    "column_changes",
    "column_object",
    "column_type_and_nullability_changes_are_granular_and_classified",
    "compare_pair",
    "describe_default",
    "describe_enum",
    "digest",
    "dropping_a_table_is_destructive_but_dropping_an_index_is_not",
    "foreign_key_changes",
    "formatting_only_yields_empty_diff",
    "graph",
    "index_changes",
    "is_breaking_addition",
    "is_zero_delta",
    "match_objects",
    "meta",
    "mode",
    "primary_key_changes",
    "qualified_names",
    "renamed_table_is_reported_as_a_rename_not_a_drop_and_add",
    "resolve",
    "structural_diff",
    "table_object",
    "unique_changes"
  ]
}
```

<!-- PARALITH:AUTO:END -->
