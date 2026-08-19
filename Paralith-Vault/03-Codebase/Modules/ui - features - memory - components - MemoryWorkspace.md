---
id: module.818da224ec3db284
type: module
name: ui / features / memory / components / MemoryWorkspace
status: active
generated: true
confidence: 1
evidence_level: verified
created_at: 2026-08-13T19:20:37.121Z
updated_at: 2026-08-19T20:53:17.734Z
sources:
  - file:Paralith-tauri/src/features/memory/components/MemoryWorkspace.tsx
related:
  - component.MemoryViewTabs
  - component.MemoryWorkspace
  - feature.memory
  - project.paralith
tags:
  - paralith
  - module
---
<!-- PARALITH:AUTO:START -->

# ui / features / memory / components / MemoryWorkspace

TypeScript module `Paralith-tauri/src/features/memory/components/MemoryWorkspace.tsx` defines UI component(s): MemoryViewTabs, MemoryWorkspace.

## Relationships

Incoming:
- [[Project Overview]] -> contains_module (verified, 1)
- [[MemoryViewTabs]] -> implemented_by (verified, 1)
- [[MemoryWorkspace]] -> implemented_by (verified, 1)
- [[Memory]] -> implemented_by (verified, 1)

## Evidence

- `file:Paralith-tauri/src/features/memory/components/MemoryWorkspace.tsx`

## Metadata

```json
{
  "path": "Paralith-tauri/src/features/memory/components/MemoryWorkspace.tsx",
  "imports": [
    "../../../components/ui/Button",
    "../../../components/ui/ErrorNotice",
    "../../../native/events",
    "../intelligenceStore",
    "../memoryStore",
    "./MemoryActivity",
    "./MemoryContext",
    "./MemoryEditor",
    "./MemoryGraph",
    "./MemoryInspector",
    "./MemoryList",
    "./MemoryOverview",
    "./MemoryReview",
    "./MemorySearch",
    "./MemoryTimeline",
    "lucide-react",
    "react"
  ],
  "components": [
    "MemoryViewTabs",
    "MemoryWorkspace"
  ],
  "invokes": []
}
```

<!-- PARALITH:AUTO:END -->
