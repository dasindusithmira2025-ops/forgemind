---
id: module.0ffb6f2966b290a9
type: module
name: ui / features / swarms / SwarmsSidebarSection
status: active
generated: true
confidence: 1
evidence_level: verified
created_at: 2026-08-13T19:20:37.121Z
updated_at: 2026-08-19T20:53:17.734Z
sources:
  - file:Paralith-tauri/src/features/swarms/SwarmsSidebarSection.tsx
related:
  - component.SwarmSidebarRow
  - component.SwarmsSidebarSection
  - component.SwarmStatusIcon
  - feature.swarms
  - project.paralith
tags:
  - paralith
  - module
---
<!-- PARALITH:AUTO:START -->

# ui / features / swarms / SwarmsSidebarSection

TypeScript module `Paralith-tauri/src/features/swarms/SwarmsSidebarSection.tsx` defines UI component(s): SwarmSidebarRow, SwarmsSidebarSection, SwarmStatusIcon.

## Relationships

Incoming:
- [[Project Overview]] -> contains_module (verified, 1)
- [[SwarmSidebarRow]] -> implemented_by (verified, 1)
- [[SwarmsSidebarSection]] -> implemented_by (verified, 1)
- [[SwarmStatusIcon]] -> implemented_by (verified, 1)
- [[Swarms]] -> implemented_by (verified, 1)

## Evidence

- `file:Paralith-tauri/src/features/swarms/SwarmsSidebarSection.tsx`

## Metadata

```json
{
  "path": "Paralith-tauri/src/features/swarms/SwarmsSidebarSection.tsx",
  "imports": [
    "../../native/events",
    "../../native/types",
    "../sidebar/components/SidebarGroup",
    "../sidebar/sidebarSelectors",
    "../sidebar/sidebarStore",
    "./swarmPresentation",
    "./SwarmRowMenu",
    "./swarmStore",
    "lucide-react",
    "react",
    "react-router-dom"
  ],
  "components": [
    "SwarmSidebarRow",
    "SwarmsSidebarSection",
    "SwarmStatusIcon"
  ],
  "invokes": []
}
```

<!-- PARALITH:AUTO:END -->
