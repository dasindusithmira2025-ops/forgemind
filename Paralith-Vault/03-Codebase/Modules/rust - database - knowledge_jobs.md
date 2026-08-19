---
id: module.9f951bd07b936681
type: module
name: rust / database / knowledge_jobs
status: active
generated: true
confidence: 1
evidence_level: verified
created_at: 2026-08-13T19:20:37.121Z
updated_at: 2026-08-19T20:53:17.734Z
sources:
  - file:Paralith-tauri/src-tauri/src/database/knowledge_jobs.rs
related:
  - feature.memory
  - module.327579f22c257d7d
  - module.432313b9b9997606
  - module.62dfe7a24b7a16e8
  - project.paralith
tags:
  - paralith
  - module
---
<!-- PARALITH:AUTO:START -->

# rust / database / knowledge_jobs

Rust module `Paralith-tauri/src-tauri/src/database/knowledge_jobs.rs`

## Relationships

Outgoing:
- uses -> `module.327579f22c257d7d` (inferred, 0.7)
- uses -> `module.62dfe7a24b7a16e8` (inferred, 0.7)
- uses -> `module.432313b9b9997606` (inferred, 0.7)

Incoming:
- [[Project Overview]] -> contains_module (verified, 1)
- [[Memory]] -> implemented_by (strong, 0.9)

## Evidence

- `file:Paralith-tauri/src-tauri/src/database/knowledge_jobs.rs`

## Metadata

```json
{
  "path": "Paralith-tauri/src-tauri/src/database/knowledge_jobs.rs",
  "structs": [],
  "enums": [],
  "functions": [
    "a_claimed_job_no_longer_blocks_a_new_one_with_the_same_key",
    "a_job_kind_this_build_cannot_run_is_left_alone",
    "a_second_enqueue_coalesces_into_the_pending_job",
    "cancel_applies_to_pending_work_only",
    "cancel_knowledge_job",
    "claim_knowledge_job",
    "complete_knowledge_job",
    "completion_records_the_result_and_clears_the_error",
    "database",
    "enqueue",
    "enqueue_knowledge_job",
    "enqueue_then_claim_moves_the_job_to_running",
    "fail_knowledge_job",
    "failure_retries_until_attempts_are_exhausted",
    "jobs_are_project_scoped",
    "known_kinds",
    "list_knowledge_jobs",
    "payload",
    "pending_impact_paths",
    "project_row",
    "prune",
    "row_to_job"
  ]
}
```

<!-- PARALITH:AUTO:END -->
