---
id: module.9366e38dd18c3ad3
type: module
name: rust / commands / settings_commands
status: active
generated: true
confidence: 1
evidence_level: verified
created_at: 2026-08-13T19:20:37.121Z
updated_at: 2026-08-19T20:53:17.734Z
sources:
  - file:Paralith-tauri/src-tauri/src/commands/settings_commands.rs
related:
  - command.apply_window_chrome
  - command.get_settings
  - command.get_sidebar_preferences
  - command.get_theme_preference
  - command.save_settings
  - command.set_sidebar_preferences
  - command.set_theme_preference
  - module.3b35b2137d04a251
  - module.3ed764bcf4eee1d6
  - module.b13b30928c81b69f
  - module.d4e87cfed4ea9333
  - module.ffb55f65a79237da
  - project.paralith
tags:
  - paralith
  - module
---
<!-- PARALITH:AUTO:START -->

# rust / commands / settings_commands

Rust module `Paralith-tauri/src-tauri/src/commands/settings_commands.rs` exposes Tauri command(s): get_settings, save_settings, get_theme_preference, set_theme_preference, get_sidebar_preferences, set_sidebar_preferences, apply_window_chrome.

## Relationships

Outgoing:
- uses -> `module.b13b30928c81b69f` (inferred, 0.7)
- uses -> `module.3ed764bcf4eee1d6` (inferred, 0.7)
- uses -> `module.d4e87cfed4ea9333` (inferred, 0.7)
- uses -> `module.ffb55f65a79237da` (inferred, 0.7)
- uses -> `module.3b35b2137d04a251` (inferred, 0.7)

Incoming:
- [[Project Overview]] -> contains_module (verified, 1)
- [[get_settings]] -> implemented_by (verified, 1)
- [[save_settings]] -> implemented_by (verified, 1)
- [[get_theme_preference]] -> implemented_by (verified, 1)
- [[set_theme_preference]] -> implemented_by (verified, 1)
- [[get_sidebar_preferences]] -> implemented_by (verified, 1)
- [[set_sidebar_preferences]] -> implemented_by (verified, 1)
- [[apply_window_chrome]] -> implemented_by (verified, 1)

## Evidence

- `file:Paralith-tauri/src-tauri/src/commands/settings_commands.rs`

## Metadata

```json
{
  "path": "Paralith-tauri/src-tauri/src/commands/settings_commands.rs",
  "structs": [],
  "enums": [],
  "functions": [
    "apply_window_chrome",
    "get_settings",
    "get_sidebar_preferences",
    "get_theme_preference",
    "save_settings",
    "set_sidebar_preferences",
    "set_theme_preference"
  ]
}
```

<!-- PARALITH:AUTO:END -->
