---
id: module.0b0b8d4df88179b4
type: module
name: ui / native / commands
status: active
generated: true
confidence: 1
evidence_level: verified
created_at: 2026-08-13T19:20:37.121Z
updated_at: 2026-08-19T20:53:17.734Z
sources:
  - file:Paralith-tauri/src/native/commands.ts
related:
  - command.accept_swarm_result
  - command.add_swarm_builder
  - command.apply_swarm_execution_defaults
  - command.apply_window_chrome
  - command.archive_swarm
  - command.assess_safe_restart
  - command.attach_workspace
  - command.browser_navigate
  - command.browser_reload
  - command.browser_set_bounds
  - command.browser_set_inspect
  - command.browser_set_visible
  - command.browser_set_zoom
  - command.browser_stop
  - command.cancel_repository_operation
  - command.check_for_updates
  - command.claim_workspace_lease
  - command.close_browser_view
  - command.close_project_session
  - command.close_workspace_window
  - command.complete_workspace_handoff
  - command.confirm_healthy_startup
  - command.copy_project_entry
  - command.create_isolated_pane_worktree
  - command.create_project_directory
  - command.create_project_file
  - command.create_swarm
  - command.create_terminal_session
  - command.decide_repository_approval
  - command.delete_project_entry
  - ... 142 more
tags:
  - paralith
  - module
---
<!-- PARALITH:AUTO:START -->

# ui / native / commands

TypeScript module `Paralith-tauri/src/native/commands.ts`

## Relationships

Outgoing:
- invokes -> [[accept_swarm_result]] (strong, 0.9)
- invokes -> [[add_swarm_builder]] (strong, 0.9)
- invokes -> [[apply_swarm_execution_defaults]] (strong, 0.9)
- invokes -> [[apply_window_chrome]] (strong, 0.9)
- invokes -> [[archive_swarm]] (strong, 0.9)
- invokes -> [[assess_safe_restart]] (strong, 0.9)
- invokes -> [[attach_workspace]] (strong, 0.9)
- invokes -> [[browser_navigate]] (strong, 0.9)
- invokes -> [[browser_reload]] (strong, 0.9)
- invokes -> [[browser_set_bounds]] (strong, 0.9)
- invokes -> [[browser_set_inspect]] (strong, 0.9)
- invokes -> [[browser_set_visible]] (strong, 0.9)
- invokes -> [[browser_set_zoom]] (strong, 0.9)
- invokes -> [[browser_stop]] (strong, 0.9)
- invokes -> [[cancel_repository_operation]] (strong, 0.9)
- invokes -> [[check_for_updates]] (strong, 0.9)
- invokes -> [[claim_workspace_lease]] (strong, 0.9)
- invokes -> [[close_browser_view]] (strong, 0.9)
- invokes -> [[close_project_session]] (strong, 0.9)
- invokes -> [[close_workspace_window]] (strong, 0.9)
- invokes -> [[complete_workspace_handoff]] (strong, 0.9)
- invokes -> [[confirm_healthy_startup]] (strong, 0.9)
- invokes -> [[copy_project_entry]] (strong, 0.9)
- invokes -> [[create_isolated_pane_worktree]] (strong, 0.9)
- invokes -> [[create_project_directory]] (strong, 0.9)
- invokes -> [[create_project_file]] (strong, 0.9)
- invokes -> [[create_swarm]] (strong, 0.9)
- invokes -> [[create_terminal_session]] (strong, 0.9)
- invokes -> [[decide_repository_approval]] (strong, 0.9)
- invokes -> [[delete_project_entry]] (strong, 0.9)
- invokes -> [[delete_swarm]] (strong, 0.9)
- invokes -> [[delete_swarm_preset]] (strong, 0.9)
- invokes -> [[delete_workspace_configuration]] (strong, 0.9)
- invokes -> [[detach_workspace]] (strong, 0.9)
- invokes -> [[detect_agents]] (strong, 0.9)
- invokes -> [[detect_shells]] (strong, 0.9)
- invokes -> [[dismiss_agent_resume_session]] (strong, 0.9)
- invokes -> [[dismiss_all_agent_resume_sessions]] (strong, 0.9)
- invokes -> [[download_update]] (strong, 0.9)
- invokes -> [[duplicate_workspace]] (strong, 0.9)

Incoming:
- [[Project Overview]] -> contains_module (verified, 1)

## Evidence

- `file:Paralith-tauri/src/native/commands.ts`

## Metadata

```json
{
  "path": "Paralith-tauri/src/native/commands.ts",
  "imports": [
    "./types",
    "@tauri-apps/api/core"
  ],
  "components": [],
  "invokes": [
    "accept_swarm_result",
    "add_swarm_builder",
    "apply_swarm_execution_defaults",
    "apply_window_chrome",
    "archive_swarm",
    "assess_safe_restart",
    "attach_workspace",
    "browser_navigate",
    "browser_reload",
    "browser_set_bounds",
    "browser_set_inspect",
    "browser_set_visible",
    "browser_set_zoom",
    "browser_stop",
    "cancel_repository_operation",
    "check_for_updates",
    "claim_workspace_lease",
    "close_browser_view",
    "close_project_session",
    "close_workspace_window",
    "complete_workspace_handoff",
    "confirm_healthy_startup",
    "copy_project_entry",
    "create_isolated_pane_worktree",
    "create_project_directory",
    "create_project_file",
    "create_swarm",
    "create_terminal_session",
    "decide_repository_approval",
    "delete_project_entry",
    "... 141 more"
  ]
}
```

<!-- PARALITH:AUTO:END -->
