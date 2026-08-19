---
id: module.ed604d4d24ddb7bd
type: module
name: rust / commands / git_commands
status: active
generated: true
confidence: 1
evidence_level: verified
created_at: 2026-08-13T19:20:37.121Z
updated_at: 2026-08-19T20:53:17.734Z
sources:
  - file:Paralith-tauri/src-tauri/src/commands/git_commands.rs
related:
  - command.create_isolated_pane_worktree
  - command.get_pane_git_review
  - command.restore_pane_file
  - command.stage_pane_file
  - module.3ed764bcf4eee1d6
  - module.57709159fa023727
  - module.b04ab8816dabdb01
  - module.b13b30928c81b69f
  - project.paralith
tags:
  - paralith
  - module
---
<!-- PARALITH:AUTO:START -->

# rust / commands / git_commands

Rust module `Paralith-tauri/src-tauri/src/commands/git_commands.rs` exposes Tauri command(s): get_pane_git_review, stage_pane_file, restore_pane_file, create_isolated_pane_worktree.

## Relationships

Outgoing:
- uses -> `module.b13b30928c81b69f` (inferred, 0.7)
- uses -> `module.3ed764bcf4eee1d6` (inferred, 0.7)
- uses -> `module.b04ab8816dabdb01` (inferred, 0.7)
- uses -> `module.57709159fa023727` (inferred, 0.7)

Incoming:
- [[Project Overview]] -> contains_module (verified, 1)
- [[get_pane_git_review]] -> implemented_by (verified, 1)
- [[stage_pane_file]] -> implemented_by (verified, 1)
- [[restore_pane_file]] -> implemented_by (verified, 1)
- [[create_isolated_pane_worktree]] -> implemented_by (verified, 1)

## Evidence

- `file:Paralith-tauri/src-tauri/src/commands/git_commands.rs`

## Metadata

```json
{
  "path": "Paralith-tauri/src-tauri/src/commands/git_commands.rs",
  "structs": [],
  "enums": [],
  "functions": [
    "build_pane_git_review",
    "create_isolated_pane_worktree",
    "create_isolated_pane_worktree_inner",
    "discard_rejects_path_outside_pane_scope",
    "ensure_path_in_scope",
    "get_pane_git_review",
    "get_pane_git_review_inner",
    "git_raw",
    "git_root",
    "git_scope",
    "git_stdout",
    "git_success",
    "pane",
    "pane_review_is_scoped_to_working_directory",
    "parse_status",
    "project_root",
    "restore_pane_file",
    "restore_pane_file_inner",
    "run_git_blocking",
    "run_pane_operation",
    "sanitize_repo_relative_path",
    "slug",
    "stage_pane_file",
    "stage_pane_file_inner",
    "temp_repo",
    "unique_worktree_branch",
    "unique_worktree_branch_avoids_existing_branch",
    "write_file"
  ]
}
```

<!-- PARALITH:AUTO:END -->
