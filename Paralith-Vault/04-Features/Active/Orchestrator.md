---
id: feature.orchestrator
type: feature
name: Orchestrator
status: active
generated: true
confidence: 1
evidence_level: verified
created_at: 2026-08-13T19:20:37.121Z
updated_at: 2026-08-19T20:53:17.734Z
sources:
  - file:Paralith-tauri/src/features/orchestrator
related:
  - component.ActivityFeed
  - component.CapabilityRow
  - component.CompactCard
  - component.InvocationPanel
  - component.OrchestratorLauncher
  - module.086293b3f374ad11
  - module.310dec10cb52caa6
  - module.7e59a2623a0f574a
  - module.828ac53930d3b1b4
  - module.d2b3e92f0ba29c85
  - module.e00f5d4200eb5ac8
  - project.paralith
tags:
  - paralith
  - feature
---
<!-- PARALITH:AUTO:START -->

# Orchestrator

Feature surface discovered from `Paralith-tauri/src/features/orchestrator`.

## Relationships

Outgoing:
- implemented_by -> [[ui - features - orchestrator - api]] (verified, 1)
- implemented_by -> [[ui - features - orchestrator - OrchestratorLauncher.test]] (verified, 1)
- implemented_by -> [[ui - features - orchestrator - OrchestratorLauncher]] (verified, 1)
- implemented_by -> [[ActivityFeed]] (verified, 1)
- implemented_by -> [[CapabilityRow]] (verified, 1)
- implemented_by -> [[CompactCard]] (verified, 1)
- implemented_by -> [[InvocationPanel]] (verified, 1)
- implemented_by -> [[OrchestratorLauncher]] (verified, 1)
- implemented_by -> [[ui - features - orchestrator - store.test]] (verified, 1)
- implemented_by -> [[ui - features - orchestrator - store]] (verified, 1)
- implemented_by -> [[ui - features - orchestrator - types]] (verified, 1)

Incoming:
- [[Project Overview]] -> has_feature (verified, 1)

## Evidence

- `file:Paralith-tauri/src/features/orchestrator`

<!-- PARALITH:AUTO:END -->
