---
id: module.f7d903330f4e221e
type: module
name: rust / services / database_studio / discovery
status: active
generated: true
confidence: 1
evidence_level: verified
created_at: 2026-08-13T19:20:37.121Z
updated_at: 2026-08-19T20:53:17.734Z
sources:
  - file:Paralith-tauri/src-tauri/src/services/database_studio/discovery.rs
related:
  - module.3ed764bcf4eee1d6
  - module.b04ab8816dabdb01
  - project.paralith
tags:
  - paralith
  - module
---
<!-- PARALITH:AUTO:START -->

# rust / services / database_studio / discovery

Rust module `Paralith-tauri/src-tauri/src/services/database_studio/discovery.rs` Defines: DiscoveredLogicalDatabase, DiscoveryReport, PackageInfo.

## Relationships

Outgoing:
- uses -> `module.3ed764bcf4eee1d6` (inferred, 0.7)
- uses -> `module.b04ab8816dabdb01` (inferred, 0.7)

Incoming:
- [[Project Overview]] -> contains_module (verified, 1)

## Evidence

- `file:Paralith-tauri/src-tauri/src/services/database_studio/discovery.rs`

## Metadata

```json
{
  "path": "Paralith-tauri/src-tauri/src/services/database_studio/discovery.rs",
  "structs": [
    "DiscoveredLogicalDatabase",
    "DiscoveryReport",
    "PackageInfo"
  ],
  "enums": [],
  "functions": [
    "arbitrary_typescript_file_with_table_word_is_not_drizzle_evidence",
    "assign_display_names",
    "classify_path",
    "classify_source",
    "collect_files",
    "consumers_for_package",
    "discover_compose_database_names",
    "discover_packages",
    "discover_repository",
    "display_name_for",
    "display_names_are_labels_and_only_collisions_are_qualified",
    "drizzle_discovers_pg_tables_and_relations_statics_only",
    "drizzle_engine",
    "duplicate_table_names_preserve_namespace_qualified_identity",
    "engine_key",
    "extract_drizzle_tables",
    "extract_prisma_models",
    "extract_table_names",
    "fixture",
    "fixture_and_example_schemas_are_classified_below_the_application_schema",
    "is_drizzle_schema_candidate",
    "is_sqlite_file_evidence",
    "json_dependency_names",
    "json_string_field",
    "logical_key_for",
    "logical_name_from_path",
    "logical_name_from_sql_path",
    "logical_name_from_sqlite_path",
    "merge_unique",
    "merged_sqlite_tables",
    "... 21 more"
  ]
}
```

<!-- PARALITH:AUTO:END -->
