---
id: module.068d3ada1d8efbd9
type: module
name: ui / screens / WorkspaceSetup
status: active
generated: true
confidence: 1
evidence_level: verified
created_at: 2026-08-13T19:20:37.121Z
updated_at: 2026-08-19T20:53:17.734Z
sources:
  - file:Paralith-tauri/src/screens/WorkspaceSetup.tsx
related:
  - component.AgentRow
  - component.AgentsFooter
  - component.AgentsStep
  - component.CustomCommandDialog
  - component.CustomCommands
  - component.LayoutCard
  - component.LayoutFooter
  - component.LayoutStep
  - component.ReduceDialog
  - component.StartFooter
  - component.StartStep
  - component.Stepper
  - component.WorkspaceSetup
  - project.paralith
tags:
  - paralith
  - module
---
<!-- PARALITH:AUTO:START -->

# ui / screens / WorkspaceSetup

TypeScript module `Paralith-tauri/src/screens/WorkspaceSetup.tsx` defines UI component(s): AgentRow, AgentsFooter, AgentsStep, CustomCommandDialog, CustomCommands, LayoutCard, LayoutFooter, LayoutStep, ReduceDialog, StartFooter, ... 3 more.

## Relationships

Incoming:
- [[Project Overview]] -> contains_module (verified, 1)
- [[AgentRow]] -> implemented_by (verified, 1)
- [[AgentsFooter]] -> implemented_by (verified, 1)
- [[AgentsStep]] -> implemented_by (verified, 1)
- [[CustomCommandDialog]] -> implemented_by (verified, 1)
- [[CustomCommands]] -> implemented_by (verified, 1)
- [[LayoutCard]] -> implemented_by (verified, 1)
- [[LayoutFooter]] -> implemented_by (verified, 1)
- [[LayoutStep]] -> implemented_by (verified, 1)
- [[ReduceDialog]] -> implemented_by (verified, 1)
- [[StartFooter]] -> implemented_by (verified, 1)
- [[StartStep]] -> implemented_by (verified, 1)
- [[Stepper]] -> implemented_by (verified, 1)
- [[WorkspaceSetup]] -> implemented_by (verified, 1)

## Evidence

- `file:Paralith-tauri/src/screens/WorkspaceSetup.tsx`

## Metadata

```json
{
  "path": "Paralith-tauri/src/screens/WorkspaceSetup.tsx",
  "imports": [
    "../components/ui/Brand",
    "../components/ui/Button",
    "../components/ui/ErrorNotice",
    "../components/ui/TextPromptDialog",
    "../features/workspace-setup/agentRegistry",
    "../features/workspace-setup/allocationCompiler",
    "../features/workspace-setup/setupStore",
    "../features/workspace-setup/setupTypes",
    "../native/commands",
    "../native/types",
    "../shared/layout",
    "@tauri-apps/plugin-dialog",
    "lucide-react",
    "react",
    "react-router-dom"
  ],
  "components": [
    "AgentRow",
    "AgentsFooter",
    "AgentsStep",
    "CustomCommandDialog",
    "CustomCommands",
    "LayoutCard",
    "LayoutFooter",
    "LayoutStep",
    "ReduceDialog",
    "StartFooter",
    "StartStep",
    "Stepper",
    "WorkspaceSetup"
  ],
  "invokes": []
}
```

<!-- PARALITH:AUTO:END -->
