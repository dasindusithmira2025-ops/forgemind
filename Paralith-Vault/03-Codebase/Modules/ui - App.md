---
id: module.4f972a4035cfc326
type: module
name: ui / App
status: active
generated: true
confidence: 1
evidence_level: verified
created_at: 2026-08-13T19:20:37.121Z
updated_at: 2026-08-19T20:53:17.734Z
sources:
  - file:Paralith-tauri/src/App.tsx
related:
  - component.App
  - component.StartupWorkspaceRedirect
  - component.WorkspaceHandoffListener
  - project.paralith
tags:
  - paralith
  - module
---
<!-- PARALITH:AUTO:START -->

# ui / App

TypeScript module `Paralith-tauri/src/App.tsx` defines UI component(s): App, StartupWorkspaceRedirect, WorkspaceHandoffListener.

## Relationships

Incoming:
- [[Project Overview]] -> contains_module (verified, 1)
- [[App]] -> implemented_by (verified, 1)
- [[StartupWorkspaceRedirect]] -> implemented_by (verified, 1)
- [[WorkspaceHandoffListener]] -> implemented_by (verified, 1)

## Evidence

- `file:Paralith-tauri/src/App.tsx`

## Metadata

```json
{
  "path": "Paralith-tauri/src/App.tsx",
  "imports": [
    "./features/agent-resume/AgentResumeCenter",
    "./features/orchestrator/OrchestratorLauncher",
    "./features/terminals/runtimeStore",
    "./features/updates/updateController",
    "./features/updates/UpdateNotification",
    "./native/commands",
    "./native/types",
    "./native/windowContext",
    "./screens/RecoveryScreen",
    "./stores/appStore",
    "./theme/themeStore",
    "@tauri-apps/api/event",
    "react",
    "react-router-dom"
  ],
  "components": [
    "App",
    "StartupWorkspaceRedirect",
    "WorkspaceHandoffListener"
  ],
  "invokes": []
}
```

<!-- PARALITH:AUTO:END -->
