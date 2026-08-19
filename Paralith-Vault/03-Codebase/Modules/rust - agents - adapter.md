---
id: module.7530f9066e278045
type: module
name: rust / agents / adapter
status: active
generated: true
confidence: 1
evidence_level: verified
created_at: 2026-08-13T19:20:37.121Z
updated_at: 2026-08-19T20:53:17.734Z
sources:
  - file:Paralith-tauri/src-tauri/src/agents/adapter.rs
related:
  - module.3ed764bcf4eee1d6
  - module.b04ab8816dabdb01
  - project.paralith
tags:
  - paralith
  - module
---
<!-- PARALITH:AUTO:START -->

# rust / agents / adapter

Rust module `Paralith-tauri/src-tauri/src/agents/adapter.rs` Defines: AgentLaunchSpec, ProviderAdapter.

## Relationships

Outgoing:
- uses -> `module.3ed764bcf4eee1d6` (inferred, 0.7)
- uses -> `module.b04ab8816dabdb01` (inferred, 0.7)

Incoming:
- [[Project Overview]] -> contains_module (verified, 1)

## Evidence

- `file:Paralith-tauri/src-tauri/src/agents/adapter.rs`

## Metadata

```json
{
  "path": "Paralith-tauri/src-tauri/src/agents/adapter.rs",
  "structs": [
    "AgentLaunchSpec",
    "ProviderAdapter"
  ],
  "enums": [],
  "functions": [
    "ansi_decorated_prompt_is_parsed_from_clean_text",
    "clean_terminal_text",
    "cmd_shim_is_launched_through_a_quote_safe_shell",
    "cmd_shim_path_with_spaces_is_quoted_as_one_command",
    "coding_agent_output_maps_to_working",
    "launch_spec",
    "parse_agent_output",
    "parse_signal",
    "permission_prompt_maps_to_attention_state",
    "powershell_shim_is_launched_through_powershell",
    "provider_id",
    "quote_powershell_literal",
    "real_executables_pass_through_untouched",
    "shell_prompt_boundary_maps_to_needs_input",
    "wrap_script_shim"
  ]
}
```

<!-- PARALITH:AUTO:END -->
