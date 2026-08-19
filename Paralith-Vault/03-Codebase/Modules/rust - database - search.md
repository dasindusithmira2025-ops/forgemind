---
id: module.7046abd1af8857cd
type: module
name: rust / database / search
status: active
generated: true
confidence: 1
evidence_level: verified
created_at: 2026-08-19T20:46:38.099Z
updated_at: 2026-08-19T20:53:17.734Z
sources:
  - file:Paralith-tauri/src-tauri/src/database/search.rs
related:
  - module.327579f22c257d7d
  - module.366deef54093df74
  - module.432313b9b9997606
  - module.b30f0713fb3f8e55
  - module.bfe136efb4eb7f5b
  - module.c8a4357b76df99f4
  - module.d77bf3a4f12cf627
  - project.paralith
tags:
  - paralith
  - module
---
<!-- PARALITH:AUTO:START -->

# rust / database / search

Rust module `Paralith-tauri/src-tauri/src/database/search.rs` Defines: Fixture, FlatSpec.

## Relationships

Outgoing:
- uses -> `module.327579f22c257d7d` (inferred, 0.7)
- uses -> `module.b30f0713fb3f8e55` (inferred, 0.7)
- uses -> `module.432313b9b9997606` (inferred, 0.7)
- uses -> `module.c8a4357b76df99f4` (inferred, 0.7)
- uses -> `module.d77bf3a4f12cf627` (inferred, 0.7)
- uses -> `module.366deef54093df74` (inferred, 0.7)
- uses -> `module.bfe136efb4eb7f5b` (inferred, 0.7)

Incoming:
- [[Project Overview]] -> contains_module (verified, 1)

## Evidence

- `file:Paralith-tauri/src-tauri/src/database/search.rs`

## Metadata

```json
{
  "path": "Paralith-tauri/src-tauri/src/database/search.rs",
  "structs": [
    "Fixture",
    "FlatSpec"
  ],
  "enums": [],
  "functions": [
    "a_domain_selector_restricts_which_stores_are_searched",
    "a_hostile_query_is_bound_not_executed",
    "a_malformed_query_returns_a_result_set_and_a_diagnostic",
    "a_structured_filter_returns_only_matching_memories",
    "a_value_group_matches_either_option",
    "an_archived_memory_is_not_a_search_result",
    "an_empty_query_lists_rather_than_returning_nothing",
    "claims_for_subject",
    "clip",
    "domain_weight",
    "drop",
    "evidence_paths_are_searchable_and_windows_separators_normalize",
    "f",
    "fixture",
    "free_text_and_a_filter_compose",
    "fts_query",
    "like_patterns",
    "nearest_embeddings",
    "negation_excludes_rather_than_narrows",
    "one_projects_search_never_returns_another_projects_knowledge",
    "quality_and_staleness_are_queryable",
    "query_memory_ids",
    "results_are_typed_rather_than_an_undifferentiated_list",
    "save",
    "search",
    "search_flat",
    "search_memory_domain",
    "spec",
    "titles",
    "unified_search"
  ]
}
```

<!-- PARALITH:AUTO:END -->
