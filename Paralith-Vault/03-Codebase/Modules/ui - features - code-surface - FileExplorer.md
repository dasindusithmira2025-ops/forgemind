---
id: module.aa05f65d38eb519d
type: module
name: ui / features / code-surface / FileExplorer
status: active
generated: true
confidence: 1
evidence_level: verified
created_at: 2026-08-13T19:20:37.121Z
updated_at: 2026-08-19T20:53:17.734Z
sources:
  - file:Paralith-tauri/src/features/code-surface/FileExplorer.tsx
related:
  - component.ExplorerMenu
  - component.FileExplorer
  - component.Tree
  - feature.code-surface
  - project.paralith
tags:
  - paralith
  - module
---
<!-- PARALITH:AUTO:START -->

# ui / features / code-surface / FileExplorer

TypeScript module `Paralith-tauri/src/features/code-surface/FileExplorer.tsx` defines UI component(s): ExplorerMenu, FileExplorer, Tree.

## Relationships

Incoming:
- [[Project Overview]] -> contains_module (verified, 1)
- [[ExplorerMenu]] -> implemented_by (verified, 1)
- [[FileExplorer]] -> implemented_by (verified, 1)
- [[Tree]] -> implemented_by (verified, 1)
- [[Code Surface]] -> implemented_by (verified, 1)

## Evidence

- `file:Paralith-tauri/src/features/code-surface/FileExplorer.tsx`

## Metadata

```json
{
  "path": "Paralith-tauri/src/features/code-surface/FileExplorer.tsx",
  "imports": [
    "../../components/ui/ErrorNotice",
    "../../components/ui/TextPromptDialog",
    "../../native/commands",
    "../../native/types",
    "./editorStore",
    "./explorerStore",
    "./fileIcons",
    "@tauri-apps/plugin-opener",
    "lucide-react",
    "react"
  ],
  "components": [
    "ExplorerMenu",
    "FileExplorer",
    "Tree"
  ],
  "invokes": []
}
```

<!-- PARALITH:AUTO:END -->
