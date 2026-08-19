---
id: module.42e990a1668f289e
type: module
name: ui / native / workspaceLayoutCommands
status: active
generated: true
confidence: 1
evidence_level: verified
created_at: 2026-08-13T19:20:37.121Z
updated_at: 2026-08-19T20:53:17.734Z
sources:
  - file:Paralith-tauri/src/native/workspaceLayoutCommands.ts
related:
  - command.get_workspace_canvas_layout
  - command.save_workspace_canvas_layout
  - project.paralith
tags:
  - paralith
  - module
---
<!-- PARALITH:AUTO:START -->

# ui / native / workspaceLayoutCommands

TypeScript module `Paralith-tauri/src/native/workspaceLayoutCommands.ts`

## Relationships

Outgoing:
- invokes -> [[get_workspace_canvas_layout]] (strong, 0.9)
- invokes -> [[save_workspace_canvas_layout]] (strong, 0.9)

Incoming:
- [[Project Overview]] -> contains_module (verified, 1)

## Evidence

- `file:Paralith-tauri/src/native/workspaceLayoutCommands.ts`

## Metadata

```json
{
  "path": "Paralith-tauri/src/native/workspaceLayoutCommands.ts",
  "imports": [
    "../features/workspace-canvas/canvasTypes",
    "@tauri-apps/api/core"
  ],
  "components": [],
  "invokes": [
    "get_workspace_canvas_layout",
    "save_workspace_canvas_layout"
  ]
}
```

<!-- PARALITH:AUTO:END -->
