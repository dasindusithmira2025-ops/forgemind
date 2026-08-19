---
id: module.50c9bef95a963573
type: module
name: rust / commands / agent_commands
status: active
generated: true
confidence: 1
evidence_level: verified
created_at: 2026-08-13T19:20:37.121Z
updated_at: 2026-08-19T20:53:17.734Z
sources:
  - file:Paralith-tauri/src-tauri/src/commands/agent_commands.rs
related:
  - command.detect_agents
  - command.detect_shells
  - command.dismiss_agent_resume_session
  - command.dismiss_all_agent_resume_sessions
  - command.list_agent_profiles
  - command.list_agent_resume_sessions
  - command.list_agent_sessions
  - command.reconcile_agent_resume_sessions
  - command.relocate_agent_resume_worktree
  - command.remove_agent_resume_session
  - command.resume_agent_session
  - command.save_custom_shell
  - command.validate_custom_executable
  - module.3ed764bcf4eee1d6
  - module.b04ab8816dabdb01
  - module.b13b30928c81b69f
  - project.paralith
tags:
  - paralith
  - module
---
<!-- PARALITH:AUTO:START -->

# rust / commands / agent_commands

Rust module `Paralith-tauri/src-tauri/src/commands/agent_commands.rs` exposes Tauri command(s): detect_agents, list_agent_profiles, list_agent_sessions, reconcile_agent_resume_sessions, list_agent_resume_sessions, resume_agent_session, dismiss_agent_resume_session, dismiss_all_agent_resume_sessions, remove_agent_resume_session, relocate_agent_resume_worktree, detect_shells, save_custom_shell, validate_custom_executab

## Relationships

Outgoing:
- uses -> `module.b13b30928c81b69f` (inferred, 0.7)
- uses -> `module.3ed764bcf4eee1d6` (inferred, 0.7)
- uses -> `module.b04ab8816dabdb01` (inferred, 0.7)

Incoming:
- [[Project Overview]] -> contains_module (verified, 1)
- [[detect_agents]] -> implemented_by (verified, 1)
- [[list_agent_profiles]] -> implemented_by (verified, 1)
- [[list_agent_sessions]] -> implemented_by (verified, 1)
- [[reconcile_agent_resume_sessions]] -> implemented_by (verified, 1)
- [[list_agent_resume_sessions]] -> implemented_by (verified, 1)
- [[resume_agent_session]] -> implemented_by (verified, 1)
- [[dismiss_agent_resume_session]] -> implemented_by (verified, 1)
- [[dismiss_all_agent_resume_sessions]] -> implemented_by (verified, 1)
- [[remove_agent_resume_session]] -> implemented_by (verified, 1)
- [[relocate_agent_resume_worktree]] -> implemented_by (verified, 1)
- [[detect_shells]] -> implemented_by (verified, 1)
- [[save_custom_shell]] -> implemented_by (verified, 1)
- [[validate_custom_executable]] -> implemented_by (verified, 1)

## Evidence

- `file:Paralith-tauri/src-tauri/src/commands/agent_commands.rs`

## Metadata

```json
{
  "path": "Paralith-tauri/src-tauri/src/commands/agent_commands.rs",
  "structs": [
    "CustomAgentPath"
  ],
  "enums": [],
  "functions": [
    "blocking_task_error",
    "detect_agents",
    "detect_shells",
    "dismiss_agent_resume_session",
    "dismiss_all_agent_resume_sessions",
    "list_agent_profiles",
    "list_agent_resume_sessions",
    "list_agent_sessions",
    "reconcile_agent_resume_sessions",
    "relocate_agent_resume_worktree",
    "remove_agent_resume_session",
    "resume_agent_session",
    "save_custom_shell",
    "validate_custom_executable"
  ]
}
```

<!-- PARALITH:AUTO:END -->
