---
id: module.54b4284afbb2d6e5
type: module
name: rust / services / memory_service
status: active
generated: true
confidence: 1
evidence_level: verified
created_at: 2026-08-13T19:20:37.121Z
updated_at: 2026-08-19T20:53:17.734Z
sources:
  - file:Paralith-tauri/src-tauri/src/services/memory_service.rs
related:
  - feature.memory
  - module.353c4012dfe93970
  - module.3cf1b1b9fffbdd0e
  - module.3ed764bcf4eee1d6
  - module.5eddbf8aec319e45
  - module.780baf417f96c5d8
  - module.970c3b894e9c6f2c
  - module.b30f0713fb3f8e55
  - module.c1c61288f02a50d9
  - project.paralith
tags:
  - paralith
  - module
---
<!-- PARALITH:AUTO:START -->

# rust / services / memory_service

Rust module `Paralith-tauri/src-tauri/src/services/memory_service.rs` Defines: Fixture, MemoryService.

## Relationships

Outgoing:
- uses -> `module.c1c61288f02a50d9` (inferred, 0.7)
- uses -> `module.3ed764bcf4eee1d6` (inferred, 0.7)
- uses -> `module.970c3b894e9c6f2c` (inferred, 0.7)
- uses -> `module.5eddbf8aec319e45` (inferred, 0.7)
- uses -> `module.b30f0713fb3f8e55` (inferred, 0.7)
- uses -> `module.3cf1b1b9fffbdd0e` (inferred, 0.7)
- uses -> `module.353c4012dfe93970` (inferred, 0.7)
- uses -> `module.780baf417f96c5d8` (inferred, 0.7)

Incoming:
- [[Project Overview]] -> contains_module (verified, 1)
- [[Memory]] -> implemented_by (strong, 0.9)

## Evidence

- `file:Paralith-tauri/src-tauri/src/services/memory_service.rs`

## Metadata

```json
{
  "path": "Paralith-tauri/src-tauri/src/services/memory_service.rs",
  "structs": [
    "Fixture",
    "MemoryService"
  ],
  "enums": [],
  "functions": [
    "a_claim_cannot_be_attached_across_projects",
    "a_link_resolves_once_its_target_exists",
    "a_local_graph_expands_one_hop_at_a_time",
    "a_prose_mention_is_a_suggestion_and_a_linked_one_is_not",
    "a_stale_canonical_memory_is_counted_in_the_highest_risk_bucket",
    "a_wikilink_becomes_an_edge_only_once_its_target_exists",
    "an_isolated_memory_reports_as_an_orphan",
    "an_isolated_memory_still_renders_as_its_own_node",
    "an_oversized_body_is_refused_before_anything_is_written",
    "another_projects_knowledge_is_never_reachable",
    "archive",
    "archiving_removes_a_memory_from_search_without_destroying_it",
    "attach_source",
    "backlinks_resolve_through_the_slug_and_through_aliases",
    "colliding_titles_get_distinct_slugs_and_distinct_files",
    "connections",
    "delete_claim",
    "delete_relation",
    "drop",
    "editing_appends_a_revision_and_an_identical_save_does_not",
    "ensure_memory_directory",
    "evidence_and_tag_overlays_are_opt_in",
    "evidence_supports_a_claim_but_does_not_verify_it",
    "file_evidence_must_resolve_inside_the_project_root",
    "fixture",
    "get",
    "graph",
    "graph_request",
    "health",
    "health_counts_only_rows_a_user_can_navigate_to",
    "... 33 more"
  ]
}
```

<!-- PARALITH:AUTO:END -->
