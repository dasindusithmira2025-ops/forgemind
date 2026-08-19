---
id: module.872b1983cd5e6160
type: module
name: ui / screens / SettingsScreen
status: active
generated: true
confidence: 1
evidence_level: verified
created_at: 2026-08-13T19:20:37.121Z
updated_at: 2026-08-19T20:53:17.734Z
sources:
  - file:Paralith-tauri/src/screens/SettingsScreen.tsx
related:
  - component.SettingRow
  - component.SettingsScreen
  - component.SettingsSection
  - component.Toggle
  - project.paralith
tags:
  - paralith
  - module
---
<!-- PARALITH:AUTO:START -->

# ui / screens / SettingsScreen

TypeScript module `Paralith-tauri/src/screens/SettingsScreen.tsx` defines UI component(s): SettingRow, SettingsScreen, SettingsSection, Toggle.

## Relationships

Incoming:
- [[Project Overview]] -> contains_module (verified, 1)
- [[SettingRow]] -> implemented_by (verified, 1)
- [[SettingsScreen]] -> implemented_by (verified, 1)
- [[SettingsSection]] -> implemented_by (verified, 1)
- [[Toggle]] -> implemented_by (verified, 1)

## Evidence

- `file:Paralith-tauri/src/screens/SettingsScreen.tsx`

## Metadata

```json
{
  "path": "Paralith-tauri/src/screens/SettingsScreen.tsx",
  "imports": [
    "../components/ui/Brand",
    "../components/ui/Button",
    "../components/ui/ErrorNotice",
    "../components/ui/TextPromptDialog",
    "../features/updates/updateController",
    "../native/commands",
    "../native/types",
    "../stores/appStore",
    "../theme/ThemeGallery",
    "../theme/themeStore",
    "@tauri-apps/plugin-dialog",
    "@tauri-apps/plugin-opener",
    "lucide-react",
    "react",
    "react-router-dom"
  ],
  "components": [
    "SettingRow",
    "SettingsScreen",
    "SettingsSection",
    "Toggle"
  ],
  "invokes": []
}
```

<!-- PARALITH:AUTO:END -->
