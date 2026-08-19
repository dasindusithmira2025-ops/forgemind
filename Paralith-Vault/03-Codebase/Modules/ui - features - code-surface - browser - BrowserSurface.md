---
id: module.defa40677e5a3bf2
type: module
name: ui / features / code-surface / browser / BrowserSurface
status: active
generated: true
confidence: 1
evidence_level: verified
created_at: 2026-08-13T19:20:37.121Z
updated_at: 2026-08-19T20:53:17.734Z
sources:
  - file:Paralith-tauri/src/features/code-surface/browser/BrowserSurface.tsx
related:
  - component.BrowserErrorStrip
  - component.BrowserStartPage
  - component.BrowserSurface
  - component.SelectedElementBar
  - feature.code-surface
  - project.paralith
tags:
  - paralith
  - module
---
<!-- PARALITH:AUTO:START -->

# ui / features / code-surface / browser / BrowserSurface

TypeScript module `Paralith-tauri/src/features/code-surface/browser/BrowserSurface.tsx` defines UI component(s): BrowserErrorStrip, BrowserStartPage, BrowserSurface, SelectedElementBar.

## Relationships

Incoming:
- [[Project Overview]] -> contains_module (verified, 1)
- [[BrowserErrorStrip]] -> implemented_by (verified, 1)
- [[BrowserStartPage]] -> implemented_by (verified, 1)
- [[BrowserSurface]] -> implemented_by (verified, 1)
- [[SelectedElementBar]] -> implemented_by (verified, 1)
- [[Code Surface]] -> implemented_by (verified, 1)

## Evidence

- `file:Paralith-tauri/src/features/code-surface/browser/BrowserSurface.tsx`

## Metadata

```json
{
  "path": "Paralith-tauri/src/features/code-surface/browser/BrowserSurface.tsx",
  "imports": [
    "../../../native/commands",
    "../../../native/events",
    "../../../native/types",
    "../../../stores/nativeOverlay",
    "./browser.css",
    "./browserInspectBridge",
    "./browserSessionStore",
    "./browserUrl",
    "./inspectContext",
    "@tauri-apps/plugin-opener",
    "lucide-react",
    "react"
  ],
  "components": [
    "BrowserErrorStrip",
    "BrowserStartPage",
    "BrowserSurface",
    "SelectedElementBar"
  ],
  "invokes": []
}
```

<!-- PARALITH:AUTO:END -->
