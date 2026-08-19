---
id: module.1d7b76e0625ac7e1
type: module
name: rust / commands / repository_commands
status: active
generated: true
confidence: 1
evidence_level: verified
created_at: 2026-08-13T19:20:37.121Z
updated_at: 2026-08-19T20:53:17.734Z
sources:
  - file:Paralith-tauri/src-tauri/src/commands/repository_commands.rs
related:
  - command.cancel_repository_operation
  - command.decide_repository_approval
  - command.evaluate_merge_readiness
  - command.execute_repository_operation
  - command.get_github_provider_status
  - command.get_repository_commit_detail
  - command.get_repository_diff
  - command.get_repository_history
  - command.get_repository_intelligence
  - command.get_repository_operation
  - command.get_repository_policy
  - command.get_repository_pull_request_detail
  - command.get_repository_workflow_run_detail
  - command.get_worktree_conflict_risks
  - command.inspect_repository
  - command.list_repository_approvals
  - command.list_repository_branches
  - command.list_repository_worktree_leases
  - command.refresh_repository_intelligence
  - command.refresh_repository_remote_projection
  - command.save_repository_policy
  - module.3ed764bcf4eee1d6
  - module.b04ab8816dabdb01
  - module.b13b30928c81b69f
  - project.paralith
tags:
  - paralith
  - module
---
<!-- PARALITH:AUTO:START -->

# rust / commands / repository_commands

Rust module `Paralith-tauri/src-tauri/src/commands/repository_commands.rs` exposes Tauri command(s): inspect_repository, list_repository_branches, get_repository_diff, get_repository_history, get_repository_commit_detail, execute_repository_operation, cancel_repository_operation, get_repository_operation, get_repository_policy, save_repository_policy, list_repository_approvals, decide_repository_approval, list_reposi

## Relationships

Outgoing:
- uses -> `module.b13b30928c81b69f` (inferred, 0.7)
- uses -> `module.3ed764bcf4eee1d6` (inferred, 0.7)
- uses -> `module.b04ab8816dabdb01` (inferred, 0.7)

Incoming:
- [[Project Overview]] -> contains_module (verified, 1)
- [[inspect_repository]] -> implemented_by (verified, 1)
- [[list_repository_branches]] -> implemented_by (verified, 1)
- [[get_repository_diff]] -> implemented_by (verified, 1)
- [[get_repository_history]] -> implemented_by (verified, 1)
- [[get_repository_commit_detail]] -> implemented_by (verified, 1)
- [[execute_repository_operation]] -> implemented_by (verified, 1)
- [[cancel_repository_operation]] -> implemented_by (verified, 1)
- [[get_repository_operation]] -> implemented_by (verified, 1)
- [[get_repository_policy]] -> implemented_by (verified, 1)
- [[save_repository_policy]] -> implemented_by (verified, 1)
- [[list_repository_approvals]] -> implemented_by (verified, 1)
- [[decide_repository_approval]] -> implemented_by (verified, 1)
- [[list_repository_worktree_leases]] -> implemented_by (verified, 1)
- [[get_worktree_conflict_risks]] -> implemented_by (verified, 1)
- [[get_github_provider_status]] -> implemented_by (verified, 1)
- [[refresh_repository_remote_projection]] -> implemented_by (verified, 1)
- [[get_repository_workflow_run_detail]] -> implemented_by (verified, 1)
- [[get_repository_pull_request_detail]] -> implemented_by (verified, 1)
- [[evaluate_merge_readiness]] -> implemented_by (verified, 1)
- [[refresh_repository_intelligence]] -> implemented_by (verified, 1)
- [[get_repository_intelligence]] -> implemented_by (verified, 1)

## Evidence

- `file:Paralith-tauri/src-tauri/src/commands/repository_commands.rs`

## Metadata

```json
{
  "path": "Paralith-tauri/src-tauri/src/commands/repository_commands.rs",
  "structs": [],
  "enums": [],
  "functions": [
    "_assert_value_is_send",
    "cancel_repository_operation",
    "decide_repository_approval",
    "evaluate_merge_readiness",
    "execute_repository_operation",
    "get_github_provider_status",
    "get_repository_commit_detail",
    "get_repository_diff",
    "get_repository_history",
    "get_repository_intelligence",
    "get_repository_operation",
    "get_repository_policy",
    "get_repository_pull_request_detail",
    "get_repository_workflow_run_detail",
    "get_worktree_conflict_risks",
    "inspect_repository",
    "list_repository_approvals",
    "list_repository_branches",
    "list_repository_worktree_leases",
    "refresh_repository_intelligence",
    "refresh_repository_remote_projection",
    "require_project_scope",
    "save_repository_policy"
  ]
}
```

<!-- PARALITH:AUTO:END -->
