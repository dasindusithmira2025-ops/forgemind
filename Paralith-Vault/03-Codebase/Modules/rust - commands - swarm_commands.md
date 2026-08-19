---
id: module.15bb23a7b8169911
type: module
name: rust / commands / swarm_commands
status: active
generated: true
confidence: 1
evidence_level: verified
created_at: 2026-08-13T19:20:37.121Z
updated_at: 2026-08-19T20:53:17.734Z
sources:
  - file:Paralith-tauri/src-tauri/src/commands/swarm_commands.rs
related:
  - command.accept_swarm_result
  - command.add_swarm_builder
  - command.apply_swarm_execution_defaults
  - command.archive_swarm
  - command.create_swarm
  - command.delete_swarm
  - command.delete_swarm_preset
  - command.export_swarm_report
  - command.focus_swarm_agent_terminal
  - command.generate_swarm_fix_task
  - command.get_swarm_command_draft
  - command.get_swarm_detail
  - command.get_swarm_execution_defaults
  - command.list_swarm_model_registry
  - command.list_swarm_presets
  - command.list_swarm_runtime_readiness
  - command.list_swarms
  - command.pause_swarm
  - command.preview_swarm_launch
  - command.rename_swarm
  - command.resolve_swarm_attention
  - command.resolve_swarm_decision
  - command.resume_swarm
  - command.retry_swarm
  - command.retry_swarm_test
  - command.save_swarm_command_draft
  - command.save_swarm_execution_defaults
  - command.save_swarm_preset
  - command.send_swarm_message
  - command.set_swarm_priority
  - ... 8 more
tags:
  - paralith
  - module
---
<!-- PARALITH:AUTO:START -->

# rust / commands / swarm_commands

Rust module `Paralith-tauri/src-tauri/src/commands/swarm_commands.rs` exposes Tauri command(s): list_swarm_presets, list_swarm_runtime_readiness, list_swarm_model_registry, get_swarm_execution_defaults, save_swarm_execution_defaults, apply_swarm_execution_defaults, validate_swarm_member_model_config, update_swarm_member_model_config, preview_swarm_launch, save_swarm_preset, delete_swarm_preset, create_swarm, list_swa

## Relationships

Outgoing:
- uses -> `module.b13b30928c81b69f` (inferred, 0.7)
- uses -> `module.327579f22c257d7d` (inferred, 0.7)
- uses -> `module.b04ab8816dabdb01` (inferred, 0.7)

Incoming:
- [[Project Overview]] -> contains_module (verified, 1)
- [[list_swarm_presets]] -> implemented_by (verified, 1)
- [[list_swarm_runtime_readiness]] -> implemented_by (verified, 1)
- [[list_swarm_model_registry]] -> implemented_by (verified, 1)
- [[get_swarm_execution_defaults]] -> implemented_by (verified, 1)
- [[save_swarm_execution_defaults]] -> implemented_by (verified, 1)
- [[apply_swarm_execution_defaults]] -> implemented_by (verified, 1)
- [[validate_swarm_member_model_config]] -> implemented_by (verified, 1)
- [[update_swarm_member_model_config]] -> implemented_by (verified, 1)
- [[preview_swarm_launch]] -> implemented_by (verified, 1)
- [[save_swarm_preset]] -> implemented_by (verified, 1)
- [[delete_swarm_preset]] -> implemented_by (verified, 1)
- [[create_swarm]] -> implemented_by (verified, 1)
- [[list_swarms]] -> implemented_by (verified, 1)
- [[get_swarm_detail]] -> implemented_by (verified, 1)
- [[rename_swarm]] -> implemented_by (verified, 1)
- [[start_swarm]] -> implemented_by (verified, 1)
- [[pause_swarm]] -> implemented_by (verified, 1)
- [[resume_swarm]] -> implemented_by (verified, 1)
- [[stop_swarm]] -> implemented_by (verified, 1)
- [[archive_swarm]] -> implemented_by (verified, 1)
- [[delete_swarm]] -> implemented_by (verified, 1)
- [[export_swarm_report]] -> implemented_by (verified, 1)
- [[set_swarm_priority]] -> implemented_by (verified, 1)
- [[send_swarm_message]] -> implemented_by (verified, 1)
- [[retry_swarm_test]] -> implemented_by (verified, 1)
- [[generate_swarm_fix_task]] -> implemented_by (verified, 1)
- [[accept_swarm_result]] -> implemented_by (verified, 1)
- [[focus_swarm_agent_terminal]] -> implemented_by (verified, 1)
- [[get_swarm_command_draft]] -> implemented_by (verified, 1)
- [[save_swarm_command_draft]] -> implemented_by (verified, 1)
- [[resolve_swarm_decision]] -> implemented_by (verified, 1)
- [[resolve_swarm_attention]] -> implemented_by (verified, 1)
- [[retry_swarm]] -> implemented_by (verified, 1)
- [[add_swarm_builder]] -> implemented_by (verified, 1)

## Evidence

- `file:Paralith-tauri/src-tauri/src/commands/swarm_commands.rs`

## Metadata

```json
{
  "path": "Paralith-tauri/src-tauri/src/commands/swarm_commands.rs",
  "structs": [],
  "enums": [],
  "functions": [
    "accept_swarm_result",
    "add_swarm_builder",
    "apply_swarm_execution_defaults",
    "archive_swarm",
    "create_swarm",
    "delete_swarm",
    "delete_swarm_preset",
    "export_swarm_report",
    "focus_swarm_agent_terminal",
    "generate_swarm_fix_task",
    "get_swarm_command_draft",
    "get_swarm_detail",
    "get_swarm_execution_defaults",
    "list_swarm_model_registry",
    "list_swarm_presets",
    "list_swarm_runtime_readiness",
    "list_swarms",
    "pause_swarm",
    "preview_swarm_launch",
    "rename_swarm",
    "resolve_swarm_attention",
    "resolve_swarm_decision",
    "resume_swarm",
    "retry_swarm",
    "retry_swarm_test",
    "run_blocking",
    "save_swarm_command_draft",
    "save_swarm_execution_defaults",
    "save_swarm_preset",
    "send_swarm_message",
    "... 5 more"
  ]
}
```

<!-- PARALITH:AUTO:END -->
