---
id: module.d6c7930b415367f3
type: module
name: rust / services / repository_service
status: active
generated: true
confidence: 1
evidence_level: verified
created_at: 2026-08-13T19:20:37.121Z
updated_at: 2026-08-19T20:53:17.734Z
sources:
  - file:Paralith-tauri/src-tauri/src/services/repository_service.rs
related:
  - module.3ed764bcf4eee1d6
  - module.4e154602eafd88b1
  - module.57709159fa023727
  - module.b04ab8816dabdb01
  - project.paralith
tags:
  - paralith
  - module
---
<!-- PARALITH:AUTO:START -->

# rust / services / repository_service

Rust module `Paralith-tauri/src-tauri/src/services/repository_service.rs` Defines: CommandOutput, ParsedStatus, RepositoryService.

## Relationships

Outgoing:
- uses -> `module.4e154602eafd88b1` (inferred, 0.7)
- uses -> `module.3ed764bcf4eee1d6` (inferred, 0.7)
- uses -> `module.b04ab8816dabdb01` (inferred, 0.7)
- uses -> `module.57709159fa023727` (inferred, 0.7)

Incoming:
- [[Project Overview]] -> contains_module (verified, 1)

## Evidence

- `file:Paralith-tauri/src-tauri/src/services/repository_service.rs`

## Metadata

```json
{
  "path": "Paralith-tauri/src-tauri/src/services/repository_service.rs",
  "structs": [
    "CommandOutput",
    "ParsedStatus",
    "RepositoryService"
  ],
  "enums": [],
  "functions": [
    "active_lease_for_worktree",
    "actor",
    "agent_mutations_require_and_honor_an_exclusive_worktree_lease",
    "all_active_leases",
    "approval_is_invalidated_when_repository_state_changes",
    "approved_restore_handles_tracked_files_and_untracked_directories",
    "cancel",
    "cancelled_helper_is_classified_without_returning_command_output",
    "changed_paths_since",
    "classify_github_error",
    "command_output_redacts_credentials",
    "commit",
    "commit_detail",
    "commit_log_parses_fields_parents_and_refs",
    "commit_log_skips_malformed_records_without_inventing_commits",
    "commit_operation_is_real_attributable_and_idempotent",
    "concurrent_commits_to_one_worktree_cannot_both_use_the_same_base",
    "conflict_risks",
    "create_agent_worktree",
    "create_approval",
    "decide_approval",
    "decision",
    "diff",
    "enrich_workflow_definitions",
    "ensure_branch_not_leased",
    "evaluate_policy",
    "event",
    "execute",
    "execute_approved",
    "execute_inner",
    "... 88 more"
  ]
}
```

<!-- PARALITH:AUTO:END -->
