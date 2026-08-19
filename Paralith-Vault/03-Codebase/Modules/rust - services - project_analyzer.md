---
id: module.caf0c1426a9a87c3
type: module
name: rust / services / project_analyzer
status: active
generated: true
confidence: 1
evidence_level: verified
created_at: 2026-08-19T20:46:38.099Z
updated_at: 2026-08-19T20:53:17.734Z
sources:
  - file:Paralith-tauri/src-tauri/src/services/project_analyzer.rs
related:
  - command.memory_list
  - command.memory_search
  - command.tauri_command_names
  - module.3ed764bcf4eee1d6
  - module.75f2ae6ea8dbdb02
  - module.ff961c9ef27c62b9
  - project.paralith
tags:
  - paralith
  - module
---
<!-- PARALITH:AUTO:START -->

# rust / services / project_analyzer

Rust module `Paralith-tauri/src-tauri/src/services/project_analyzer.rs` exposes Tauri command(s): tauri_command_names, memory_search, memory_list. Defines: Entry, Findings, Sandbox.

## Relationships

Outgoing:
- uses -> `module.3ed764bcf4eee1d6` (inferred, 0.7)
- uses -> `module.75f2ae6ea8dbdb02` (inferred, 0.7)
- uses -> `module.ff961c9ef27c62b9` (inferred, 0.7)

Incoming:
- [[Project Overview]] -> contains_module (verified, 1)
- [[tauri_command_names]] -> implemented_by (verified, 1)
- [[memory_search]] -> implemented_by (verified, 1)
- [[memory_list]] -> implemented_by (verified, 1)

## Evidence

- `file:Paralith-tauri/src-tauri/src/services/project_analyzer.rs`

## Metadata

```json
{
  "path": "Paralith-tauri/src-tauri/src/services/project_analyzer.rs",
  "structs": [
    "Entry",
    "Findings",
    "Sandbox"
  ],
  "enums": [],
  "functions": [
    "a_missing_project_folder_is_an_error_not_an_empty_result",
    "a_monorepo_is_recognized_and_its_packages_become_modules",
    "a_react_vite_project_is_detected_from_its_manifest_and_config",
    "a_tauri_project_reports_its_desktop_runtime_and_bundle",
    "add",
    "an_evidence_excerpt_that_looks_like_a_credential_is_dropped",
    "an_unparseable_manifest_is_skipped_rather_than_guessed_at",
    "analyze",
    "candidate_shape",
    "candidates_are_generated_only_for_facts_worth_learning",
    "candidates_from_facts",
    "capitalize",
    "ci_container_and_deployment_configuration_are_detected",
    "database_tables_are_read_out_of_migration_sql",
    "detect_api_surfaces",
    "detect_by_filename",
    "detect_cargo_toml",
    "detect_directory_signal",
    "detect_languages",
    "detect_manifests",
    "detect_modules",
    "detect_monorepo",
    "detect_package_json",
    "detect_python",
    "detect_schemas",
    "detect_tauri",
    "drop",
    "every_fact_carries_at_least_one_piece_of_evidence",
    "evidence",
    "evidence_with",
    "... 17 more"
  ]
}
```

<!-- PARALITH:AUTO:END -->
