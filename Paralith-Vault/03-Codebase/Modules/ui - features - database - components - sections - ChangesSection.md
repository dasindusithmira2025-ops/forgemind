---
id: module.00cc1afaa6363cd1
type: module
name: ui / features / database / components / sections / ChangesSection
status: active
generated: true
confidence: 1
evidence_level: verified
created_at: 2026-08-13T19:20:37.121Z
updated_at: 2026-08-19T20:53:17.734Z
sources:
  - file:Paralith-tauri/src/features/database/components/sections/ChangesSection.tsx
related:
  - component.ChangeList
  - component.ChangesSection
  - feature.database
  - project.paralith
tags:
  - paralith
  - module
---
<!-- PARALITH:AUTO:START -->

# ui / features / database / components / sections / ChangesSection

TypeScript module `Paralith-tauri/src/features/database/components/sections/ChangesSection.tsx` defines UI component(s): ChangeList, ChangesSection.

## Relationships

Incoming:
- [[Project Overview]] -> contains_module (verified, 1)
- [[ChangeList]] -> implemented_by (verified, 1)
- [[ChangesSection]] -> implemented_by (verified, 1)
- [[Database]] -> implemented_by (verified, 1)

## Evidence

- `file:Paralith-tauri/src/features/database/components/sections/ChangesSection.tsx`

## Metadata

```json
{
  "path": "Paralith-tauri/src/features/database/components/sections/ChangesSection.tsx",
  "imports": [
    "../../../../components/ui/Button",
    "../../databaseStore",
    "../../databaseTypes",
    "../SectionError",
    "../StatusBadge",
    "lucide-react",
    "react"
  ],
  "components": [
    "ChangeList",
    "ChangesSection"
  ],
  "invokes": []
}
```

<!-- PARALITH:AUTO:END -->
