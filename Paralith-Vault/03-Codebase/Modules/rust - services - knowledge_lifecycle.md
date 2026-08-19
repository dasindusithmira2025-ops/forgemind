---
id: module.7813721ac9b32161
type: module
name: rust / services / knowledge_lifecycle
status: active
generated: true
confidence: 1
evidence_level: verified
created_at: 2026-08-13T19:20:37.121Z
updated_at: 2026-08-19T20:53:17.734Z
sources:
  - file:Paralith-tauri/src-tauri/src/services/knowledge_lifecycle.rs
related:
  - feature.memory
  - module.0d2322178c1a3f43
  - module.327579f22c257d7d
  - module.432313b9b9997606
  - module.4ed71c1ed5b5d57d
  - module.593f973bedeb0442
  - module.62dfe7a24b7a16e8
  - module.75f2ae6ea8dbdb02
  - module.8ddb43db96994224
  - module.92d5d514129ecb8a
  - module.abf2d7f3ea700944
  - module.ad836d2f7c54c6db
  - module.b30f0713fb3f8e55
  - module.c1c61288f02a50d9
  - module.d77bf3a4f12cf627
  - project.paralith
tags:
  - paralith
  - module
---
<!-- PARALITH:AUTO:START -->

# rust / services / knowledge_lifecycle

Rust module `Paralith-tauri/src-tauri/src/services/knowledge_lifecycle.rs` Defines: Fixture, KnowledgeLifecycle.

## Relationships

Outgoing:
- uses -> `module.c1c61288f02a50d9` (inferred, 0.7)
- uses -> `module.327579f22c257d7d` (inferred, 0.7)
- uses -> `module.abf2d7f3ea700944` (inferred, 0.7)
- uses -> `module.593f973bedeb0442` (inferred, 0.7)
- uses -> `module.75f2ae6ea8dbdb02` (inferred, 0.7)
- uses -> `module.62dfe7a24b7a16e8` (inferred, 0.7)
- uses -> `module.b30f0713fb3f8e55` (inferred, 0.7)
- uses -> `module.92d5d514129ecb8a` (inferred, 0.7)
- uses -> `module.8ddb43db96994224` (inferred, 0.7)
- uses -> `module.432313b9b9997606` (inferred, 0.7)
- uses -> `module.0d2322178c1a3f43` (inferred, 0.7)
- uses -> `module.d77bf3a4f12cf627` (inferred, 0.7)
- uses -> `module.4ed71c1ed5b5d57d` (inferred, 0.7)
- uses -> `module.ad836d2f7c54c6db` (inferred, 0.7)

Incoming:
- [[Project Overview]] -> contains_module (verified, 1)
- [[Memory]] -> implemented_by (strong, 0.9)

## Evidence

- `file:Paralith-tauri/src-tauri/src/services/knowledge_lifecycle.rs`

## Metadata

```json
{
  "path": "Paralith-tauri/src-tauri/src/services/knowledge_lifecycle.rs",
  "structs": [
    "Fixture",
    "KnowledgeLifecycle"
  ],
  "enums": [],
  "functions": [
    "a_burst_of_saves_produces_one_job_covering_every_path",
    "a_changed_file_marks_the_knowledge_that_cites_it_stale",
    "a_path_that_escapes_the_project_is_skipped_without_failing_the_batch",
    "a_recorded_handoff_becomes_candidates_and_appears_on_the_timeline",
    "a_repeated_request_absorbs_into_the_pending_analysis",
    "a_run_reporting_completion_twice_leaves_one_handoff",
    "a_second_analysis_of_an_unchanged_project_reopens_nothing",
    "analysis_learns_what_the_project_is_and_queues_what_is_worth_knowing",
    "cited_memory",
    "drain",
    "drop",
    "emit_updated",
    "enqueue_impact",
    "execute",
    "fixture",
    "handle_changed_paths",
    "handle_commit",
    "hit",
    "intelligence",
    "irrelevant_changes_never_reach_the_queue",
    "is_knowledge_relevant",
    "is_structural",
    "marks_load_bearing_direct_hits",
    "never_marks_indirect_hits",
    "new",
    "next_job",
    "notify",
    "one_projects_change_never_touches_another_projects_knowledge",
    "only_a_structural_change_re_triggers_analysis",
    "preserves_the_first_staleness_reason",
    "... 21 more"
  ]
}
```

<!-- PARALITH:AUTO:END -->
