---
id: module.e5804b90519e0ad4
type: module
name: ui / features / code-surface / CodeSurface
status: active
generated: true
confidence: 1
evidence_level: verified
created_at: 2026-08-13T19:20:37.121Z
updated_at: 2026-08-19T20:53:17.734Z
sources:
  - file:Paralith-tauri/src/features/code-surface/CodeSurface.tsx
related:
  - component.Breadcrumbs
  - component.CodeSurface
  - component.ConflictBanner
  - component.EmptyEditor
  - feature.code-surface
  - project.paralith
tags:
  - paralith
  - module
---
<!-- PARALITH:AUTO:START -->

# ui / features / code-surface / CodeSurface

TypeScript module `Paralith-tauri/src/features/code-surface/CodeSurface.tsx` defines UI component(s): Breadcrumbs, CodeSurface, ConflictBanner, EmptyEditor.

## Relationships

Incoming:
- [[Project Overview]] -> contains_module (verified, 1)
- [[Breadcrumbs]] -> implemented_by (verified, 1)
- [[CodeSurface]] -> implemented_by (verified, 1)
- [[ConflictBanner]] -> implemented_by (verified, 1)
- [[EmptyEditor]] -> implemented_by (verified, 1)
- [[Code Surface]] -> implemented_by (verified, 1)

## Evidence

- `file:Paralith-tauri/src/features/code-surface/CodeSurface.tsx`

## Metadata

```json
{
  "path": "Paralith-tauri/src/features/code-surface/CodeSurface.tsx",
  "imports": [
    "../../components/ui/ErrorNotice",
    "../../native/commands",
    "../../native/events",
    "./codeSurface.css",
    "./editorStore",
    "./EditorTabs",
    "./explorerStore",
    "./FileExplorer",
    "./QuickOpen",
    "lucide-react",
    "react"
  ],
  "components": [
    "Breadcrumbs",
    "CodeSurface",
    "ConflictBanner",
    "EmptyEditor"
  ],
  "invokes": []
}
```

<!-- PARALITH:AUTO:END -->
