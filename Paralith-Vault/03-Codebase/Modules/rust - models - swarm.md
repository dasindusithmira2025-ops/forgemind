---
id: module.c1d940c496afee97
type: module
name: rust / models / swarm
status: active
generated: true
confidence: 1
evidence_level: verified
created_at: 2026-08-13T19:20:37.121Z
updated_at: 2026-08-19T20:53:17.734Z
sources:
  - file:Paralith-tauri/src-tauri/src/models/swarm.rs
related:
  - project.paralith
tags:
  - paralith
  - module
---
<!-- PARALITH:AUTO:START -->

# rust / models / swarm

Rust module `Paralith-tauri/src-tauri/src/models/swarm.rs` Defines: CreateSwarmRequest, SavePresetRequest, Swarm, SwarmActivity, SwarmAgent, SwarmAgentRun, SwarmAttentionRequest, SwarmChangedEvent, SwarmCommandDraft, SwarmConnectionEvent, ... 27 more.

## Relationships

Incoming:
- [[Project Overview]] -> contains_module (verified, 1)

## Evidence

- `file:Paralith-tauri/src-tauri/src/models/swarm.rs`

## Metadata

```json
{
  "path": "Paralith-tauri/src-tauri/src/models/swarm.rs",
  "structs": [
    "CreateSwarmRequest",
    "SavePresetRequest",
    "Swarm",
    "SwarmActivity",
    "SwarmAgent",
    "SwarmAgentRun",
    "SwarmAttentionRequest",
    "SwarmChangedEvent",
    "SwarmCommandDraft",
    "SwarmConnectionEvent",
    "SwarmDecision",
    "SwarmDetail",
    "SwarmEvent",
    "SwarmEvidence",
    "SwarmExecutionDefaults",
    "SwarmFallbackModelConfig",
    "SwarmLaunchPreview",
    "SwarmLifecycleTransition",
    "SwarmListItem",
    "SwarmMemberModelConfig",
    "SwarmMemoryContext",
    "SwarmMessage",
    "SwarmMessageRequest",
    "SwarmModelCapability",
    "SwarmPreset",
    "SwarmReviewRecord",
    "SwarmRoleAllocation",
    "SwarmRoleConfig",
    "SwarmRun",
    "SwarmRuntimeReadiness",
    "SwarmRuntimeSession",
    "SwarmSafeguard",
    "SwarmSummary",
    "SwarmTask",
    "SwarmTestProgress",
    "SwarmTestRecord",
    "SwarmWorktreeRecord"
  ],
  "enums": [
    "ProjectCloseSwarmBehavior",
    "RoleConfigError",
    "SwarmAgentStatus",
    "SwarmLifecycle",
    "SwarmModelValidationStatus",
    "SwarmPhase",
    "SwarmRole",
    "SwarmRuntimeKind",
    "SwarmTaskStatus"
  ],
  "functions": [
    "as_str",
    "builtin_presets",
    "can_transition_to",
    "configured",
    "default_config_version",
    "default_context_strategy",
    "default_execution_mode",
    "default_fallback_policy",
    "default_permission_mode",
    "default_reasoning_effort",
    "default_validation_status",
    "empty_json_object",
    "from_db",
    "is_complete",
    "is_schedulable",
    "is_staffed",
    "is_terminal",
    "may_write_code",
    "new",
    "phase",
    "single",
    "total_count",
    "upgrade_role_configs_json",
    "validate_role_configs"
  ]
}
```

<!-- PARALITH:AUTO:END -->
