---
id: module.34f6e06db18b52a5
type: module
name: ui / features / database / components / sections / OverviewSection
status: active
generated: true
confidence: 1
evidence_level: verified
created_at: 2026-08-13T19:20:37.121Z
updated_at: 2026-08-19T20:53:17.734Z
sources:
  - file:Paralith-tauri/src/features/database/components/sections/OverviewSection.tsx
related:
  - component.OverviewSection
  - component.SourceCard
  - feature.database
  - project.paralith
tags:
  - paralith
  - module
---
<!-- PARALITH:AUTO:START -->

# ui / features / database / components / sections / OverviewSection

TypeScript module `Paralith-tauri/src/features/database/components/sections/OverviewSection.tsx` defines UI component(s): OverviewSection, SourceCard.

## Relationships

Incoming:
- [[Project Overview]] -> contains_module (verified, 1)
- [[OverviewSection]] -> implemented_by (verified, 1)
- [[SourceCard]] -> implemented_by (verified, 1)
- [[Database]] -> implemented_by (verified, 1)

## Evidence

- `file:Paralith-tauri/src/features/database/components/sections/OverviewSection.tsx`

## Metadata

```json
{
  "path": "Paralith-tauri/src/features/database/components/sections/OverviewSection.tsx",
  "imports": [
    "../../../../components/ui/Button",
    "../../databaseSelectors",
    "../../databaseStore",
    "../../databaseTypes",
    "../SectionError",
    "../StatusBadge",
    "lucide-react",
    "react"
  ],
  "components": [
    "OverviewSection",
    "SourceCard"
  ],
  "invokes": []
}
```

<!-- PARALITH:AUTO:END -->
