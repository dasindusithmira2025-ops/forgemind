---
id: module.828ac53930d3b1b4
type: module
name: ui / features / orchestrator / OrchestratorLauncher
status: active
generated: true
confidence: 1
evidence_level: verified
created_at: 2026-08-13T19:20:37.121Z
updated_at: 2026-08-19T20:53:17.734Z
sources:
  - file:Paralith-tauri/src/features/orchestrator/OrchestratorLauncher.tsx
related:
  - component.ActivityFeed
  - component.CapabilityRow
  - component.CompactCard
  - component.InvocationPanel
  - component.OrchestratorLauncher
  - component.RiskBadge
  - feature.orchestrator
  - project.paralith
tags:
  - paralith
  - module
---
<!-- PARALITH:AUTO:START -->

# ui / features / orchestrator / OrchestratorLauncher

TypeScript module `Paralith-tauri/src/features/orchestrator/OrchestratorLauncher.tsx` defines UI component(s): ActivityFeed, CapabilityRow, CompactCard, InvocationPanel, OrchestratorLauncher, RiskBadge.

## Relationships

Incoming:
- [[Project Overview]] -> contains_module (verified, 1)
- [[ActivityFeed]] -> implemented_by (verified, 1)
- [[CapabilityRow]] -> implemented_by (verified, 1)
- [[CompactCard]] -> implemented_by (verified, 1)
- [[InvocationPanel]] -> implemented_by (verified, 1)
- [[OrchestratorLauncher]] -> implemented_by (verified, 1)
- [[RiskBadge]] -> implemented_by (verified, 1)
- [[Orchestrator]] -> implemented_by (verified, 1)

## Evidence

- `file:Paralith-tauri/src/features/orchestrator/OrchestratorLauncher.tsx`

## Metadata

```json
{
  "path": "Paralith-tauri/src/features/orchestrator/OrchestratorLauncher.tsx",
  "imports": [
    "../../native/commands",
    "../agent-resume/events",
    "./api",
    "./store",
    "./types",
    "react"
  ],
  "components": [
    "ActivityFeed",
    "CapabilityRow",
    "CompactCard",
    "InvocationPanel",
    "OrchestratorLauncher",
    "RiskBadge"
  ],
  "invokes": []
}
```

<!-- PARALITH:AUTO:END -->
