---
id: feature.workspace-setup
type: feature
name: Workspace Setup
status: active
generated: true
confidence: 1
evidence_level: verified
created_at: 2026-08-13T19:20:37.121Z
updated_at: 2026-08-19T20:53:17.734Z
sources:
  - file:Paralith-tauri/src/features/workspace-setup
related:
  - component.SETUP_DRAFT_VERSION
  - component.SETUP_PRESET_VERSION
  - component.SHELL_ID_PREFIX
  - module.00bd9125707effa8
  - module.4d3ce3899390c103
  - module.749da296abb47075
  - module.7ae70cc2baba372a
  - module.7ef1b4c374af338e
  - module.d99c5312a1a5c597
  - module.ee8ec5d855267a56
  - module.f0bc51bb82fb72ed
  - project.paralith
tags:
  - paralith
  - feature
---
<!-- PARALITH:AUTO:START -->

# Workspace Setup

Feature surface discovered from `Paralith-tauri/src/features/workspace-setup`.

## Relationships

Outgoing:
- implemented_by -> [[ui - features - workspace-setup - agentRegistry]] (verified, 1)
- implemented_by -> [[SHELL_ID_PREFIX]] (verified, 1)
- implemented_by -> [[ui - features - workspace-setup - allocationCompiler.test]] (verified, 1)
- implemented_by -> [[ui - features - workspace-setup - allocationCompiler]] (verified, 1)
- implemented_by -> [[ui - features - workspace-setup - draftPersistence]] (verified, 1)
- implemented_by -> [[ui - features - workspace-setup - presetMigration.test]] (verified, 1)
- implemented_by -> [[ui - features - workspace-setup - presetMigration]] (verified, 1)
- implemented_by -> [[SETUP_PRESET_VERSION]] (verified, 1)
- implemented_by -> [[ui - features - workspace-setup - setupStore]] (verified, 1)
- implemented_by -> [[ui - features - workspace-setup - setupTypes]] (verified, 1)
- implemented_by -> [[SETUP_DRAFT_VERSION]] (verified, 1)

Incoming:
- [[Project Overview]] -> has_feature (verified, 1)

## Evidence

- `file:Paralith-tauri/src/features/workspace-setup`

<!-- PARALITH:AUTO:END -->
