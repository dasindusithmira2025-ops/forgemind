---
id: module.6f86db89bfa3f9be
type: module
name: ui / features / code-surface / MonacoEditorPane
status: active
generated: true
confidence: 1
evidence_level: verified
created_at: 2026-08-13T19:20:37.121Z
updated_at: 2026-08-19T20:53:17.734Z
sources:
  - file:Paralith-tauri/src/features/code-surface/MonacoEditorPane.tsx
related:
  - component.DiffOverlay
  - component.MonacoEditorPane
  - feature.code-surface
  - project.paralith
tags:
  - paralith
  - module
---
<!-- PARALITH:AUTO:START -->

# ui / features / code-surface / MonacoEditorPane

TypeScript module `Paralith-tauri/src/features/code-surface/MonacoEditorPane.tsx` defines UI component(s): DiffOverlay, MonacoEditorPane.

## Relationships

Incoming:
- [[Project Overview]] -> contains_module (verified, 1)
- [[DiffOverlay]] -> implemented_by (verified, 1)
- [[MonacoEditorPane]] -> implemented_by (verified, 1)
- [[Code Surface]] -> implemented_by (verified, 1)

## Evidence

- `file:Paralith-tauri/src/features/code-surface/MonacoEditorPane.tsx`

## Metadata

```json
{
  "path": "Paralith-tauri/src/features/code-surface/MonacoEditorPane.tsx",
  "imports": [
    "../../theme/registry",
    "../../theme/themeStore",
    "../../theme/tokens",
    "@monaco-editor/react",
    "monaco-editor",
    "monaco-editor/esm/vs/editor/editor.worker?worker",
    "monaco-editor/esm/vs/language/css/css.worker?worker",
    "monaco-editor/esm/vs/language/html/html.worker?worker",
    "monaco-editor/esm/vs/language/json/json.worker?worker",
    "monaco-editor/esm/vs/language/typescript/ts.worker?worker",
    "react"
  ],
  "components": [
    "DiffOverlay",
    "MonacoEditorPane"
  ],
  "invokes": []
}
```

<!-- PARALITH:AUTO:END -->
