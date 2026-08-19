---
id: module.b93bf3161c45fa34
type: module
name: rust / services / repository_intelligence
status: active
generated: true
confidence: 1
evidence_level: verified
created_at: 2026-08-13T19:20:37.121Z
updated_at: 2026-08-19T20:53:17.734Z
sources:
  - file:Paralith-tauri/src-tauri/src/services/repository_intelligence.rs
related:
  - module.2af7b8adee35c63c
  - module.3ed764bcf4eee1d6
  - module.b04ab8816dabdb01
  - project.paralith
tags:
  - paralith
  - module
---
<!-- PARALITH:AUTO:START -->

# rust / services / repository_intelligence

Rust module `Paralith-tauri/src-tauri/src/services/repository_intelligence.rs` Defines: GraphBuilder, Origin, TestIndex.

## Relationships

Outgoing:
- uses -> `module.3ed764bcf4eee1d6` (inferred, 0.7)
- uses -> `module.b04ab8816dabdb01` (inferred, 0.7)
- uses -> `module.2af7b8adee35c63c` (inferred, 0.7)

Incoming:
- [[Project Overview]] -> contains_module (verified, 1)

## Evidence

- `file:Paralith-tauri/src-tauri/src/services/repository_intelligence.rs`

## Metadata

```json
{
  "path": "Paralith-tauri/src-tauri/src/services/repository_intelligence.rs",
  "structs": [
    "GraphBuilder",
    "Origin",
    "TestIndex"
  ],
  "enums": [],
  "functions": [
    "build",
    "build_intelligence",
    "changed_symbols",
    "dependency_manifests_and_workflows_are_classified",
    "edge",
    "exact",
    "exact_with",
    "extension",
    "graph_builder_dedupes_nodes_and_edges",
    "heuristic",
    "is_dependency_manifest",
    "is_source_file",
    "is_test_path",
    "is_workflow_path",
    "matches",
    "missing_test_signals",
    "new",
    "node",
    "provenance",
    "repository_identity",
    "repository_identity_is_stable_and_path_scoped",
    "risk_signals",
    "short_sha",
    "status_fingerprint",
    "stem_references",
    "stored_intelligence",
    "symbol_name",
    "symbol_name_skips_language_keywords",
    "test_index_matches_by_stem_only",
    "test_paths_are_recognized_across_ecosystem_conventions",
    "... 4 more"
  ]
}
```

<!-- PARALITH:AUTO:END -->
