---
id: module.62bdd823c7b18847
type: module
name: ui / features / database / components / sections / ExplorerSection
status: active
generated: true
confidence: 1
evidence_level: verified
created_at: 2026-08-13T19:20:37.121Z
updated_at: 2026-08-19T20:53:17.734Z
sources:
  - file:Paralith-tauri/src/features/database/components/sections/ExplorerSection.tsx
related:
  - component.EntryRow
  - component.ExplorerSection
  - component.KindSection
  - component.VirtualEntries
  - feature.database
  - project.paralith
tags:
  - paralith
  - module
---
<!-- PARALITH:AUTO:START -->

# ui / features / database / components / sections / ExplorerSection

TypeScript module `Paralith-tauri/src/features/database/components/sections/ExplorerSection.tsx` defines UI component(s): EntryRow, ExplorerSection, KindSection, VirtualEntries.

## Relationships

Incoming:
- [[Project Overview]] -> contains_module (verified, 1)
- [[EntryRow]] -> implemented_by (verified, 1)
- [[ExplorerSection]] -> implemented_by (verified, 1)
- [[KindSection]] -> implemented_by (verified, 1)
- [[VirtualEntries]] -> implemented_by (verified, 1)
- [[Database]] -> implemented_by (verified, 1)

## Evidence

- `file:Paralith-tauri/src/features/database/components/sections/ExplorerSection.tsx`

## Metadata

```json
{
  "path": "Paralith-tauri/src/features/database/components/sections/ExplorerSection.tsx",
  "imports": [
    "../../databaseSelectors",
    "../../databaseStore",
    "../SectionError",
    "./explorerHierarchy",
    "./layerAvailability",
    "./LayerUnavailableNotice",
    "lucide-react",
    "react"
  ],
  "components": [
    "EntryRow",
    "ExplorerSection",
    "KindSection",
    "VirtualEntries"
  ],
  "invokes": []
}
```

<!-- PARALITH:AUTO:END -->
