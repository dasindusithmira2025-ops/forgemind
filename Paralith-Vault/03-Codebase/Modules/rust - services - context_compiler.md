---
id: module.ac930245b616c288
type: module
name: rust / services / context_compiler
status: active
generated: true
confidence: 1
evidence_level: verified
created_at: 2026-08-13T19:20:37.121Z
updated_at: 2026-08-19T20:53:17.734Z
sources:
  - file:Paralith-tauri/src-tauri/src/services/context_compiler.rs
related:
  - feature.memory
  - module.21268adefa7cc90f
  - module.2ce45afce6b5cb1d
  - module.327579f22c257d7d
  - module.366deef54093df74
  - module.3cf1b1b9fffbdd0e
  - module.65f5d9491572951f
  - module.747b98636caecc37
  - module.75f2ae6ea8dbdb02
  - module.a8ddb8bf88c5edd7
  - module.ada213f87275e931
  - module.b30f0713fb3f8e55
  - module.bfe136efb4eb7f5b
  - module.c1c61288f02a50d9
  - module.d013b4c87083cd43
  - module.d77bf3a4f12cf627
  - module.f35c0b284135b1c4
  - project.paralith
tags:
  - paralith
  - module
---
<!-- PARALITH:AUTO:START -->

# rust / services / context_compiler

Rust module `Paralith-tauri/src-tauri/src/services/context_compiler.rs` Defines: Candidate, ContextCompiler, Fixture, PackCandidate, TestEmbeddingProvider.

## Relationships

Outgoing:
- uses -> `module.c1c61288f02a50d9` (inferred, 0.7)
- uses -> `module.747b98636caecc37` (inferred, 0.7)
- uses -> `module.2ce45afce6b5cb1d` (inferred, 0.7)
- uses -> `module.65f5d9491572951f` (inferred, 0.7)
- uses -> `module.327579f22c257d7d` (inferred, 0.7)
- uses -> `module.21268adefa7cc90f` (inferred, 0.7)
- uses -> `module.f35c0b284135b1c4` (inferred, 0.7)
- uses -> `module.75f2ae6ea8dbdb02` (inferred, 0.7)
- uses -> `module.b30f0713fb3f8e55` (inferred, 0.7)
- uses -> `module.a8ddb8bf88c5edd7` (inferred, 0.7)
- uses -> `module.ada213f87275e931` (inferred, 0.7)
- uses -> `module.d013b4c87083cd43` (inferred, 0.7)
- uses -> `module.d77bf3a4f12cf627` (inferred, 0.7)
- uses -> `module.3cf1b1b9fffbdd0e` (inferred, 0.7)
- uses -> `module.366deef54093df74` (inferred, 0.7)
- uses -> `module.bfe136efb4eb7f5b` (inferred, 0.7)

Incoming:
- [[Project Overview]] -> contains_module (verified, 1)
- [[Memory]] -> implemented_by (strong, 0.9)

## Evidence

- `file:Paralith-tauri/src-tauri/src/services/context_compiler.rs`

## Metadata

```json
{
  "path": "Paralith-tauri/src-tauri/src/services/context_compiler.rs",
  "structs": [
    "Candidate",
    "ContextCompiler",
    "Fixture",
    "PackCandidate",
    "TestEmbeddingProvider"
  ],
  "enums": [],
  "functions": [
    "a_canonical_constraint_is_carried_without_being_searched_for",
    "a_contradiction_between_selected_memories_is_surfaced_not_resolved",
    "a_filter_the_parser_could_not_read_is_reported_rather_than_silently_narrowing",
    "a_focus_path_that_escapes_the_project_fails_the_compile",
    "a_handoff_from_another_branch_is_not_presented_as_this_branch_s_context",
    "a_handoff_with_nothing_learned_is_not_carried",
    "a_knowledge_change_invalidates_the_cache_precisely",
    "a_multibyte_body_is_truncated_on_a_character_boundary",
    "a_named_budget_resolves_and_an_absurd_one_is_clamped",
    "a_pack_is_a_slice_of_the_vault_not_the_whole_of_it",
    "a_recorded_contradiction_is_surfaced_even_without_a_contradicts_relation",
    "a_related_memory_is_reached_through_the_relation_graph",
    "a_staleness_change_invalidates_the_cache",
    "a_structured_filter_contributes_candidates_the_task_text_would_not_find",
    "add_code_candidates",
    "add_database_candidates",
    "add_predecessor_candidates",
    "add_project_fact_candidates",
    "add_reason",
    "add_repository_candidates",
    "add_semantic_candidates",
    "add_task_contract_candidates",
    "an_empty_project_compiles_to_an_empty_pack_rather_than_failing",
    "an_identical_request_is_served_from_the_cache",
    "authentication_redirect",
    "bounded_text",
    "cache_key",
    "code_candidate",
    "code_graph_symbols_are_candidates_without_reindexing_on_compile",
    "compile",
    "... 45 more"
  ]
}
```

<!-- PARALITH:AUTO:END -->
