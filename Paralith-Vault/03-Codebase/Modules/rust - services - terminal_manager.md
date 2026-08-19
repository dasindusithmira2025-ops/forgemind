---
id: module.4c30ec2b4cfd0c42
type: module
name: rust / services / terminal_manager
status: active
generated: true
confidence: 1
evidence_level: verified
created_at: 2026-08-13T19:20:37.121Z
updated_at: 2026-08-19T20:53:17.734Z
sources:
  - file:Paralith-tauri/src-tauri/src/services/terminal_manager.rs
related:
  - module.0b662c3f4f16d304
  - module.3ed764bcf4eee1d6
  - module.57709159fa023727
  - module.b04ab8816dabdb01
  - module.c1c61288f02a50d9
  - module.d41b399eea584041
  - module.dd683ad11325a344
  - project.paralith
tags:
  - paralith
  - module
---
<!-- PARALITH:AUTO:START -->

# rust / services / terminal_manager

Rust module `Paralith-tauri/src-tauri/src/services/terminal_manager.rs` Defines: CreationReservation, TerminalHandle, TerminalLog, TerminalManager.

## Relationships

Outgoing:
- uses -> `module.d41b399eea584041` (inferred, 0.7)
- uses -> `module.c1c61288f02a50d9` (inferred, 0.7)
- uses -> `module.3ed764bcf4eee1d6` (inferred, 0.7)
- uses -> `module.b04ab8816dabdb01` (inferred, 0.7)
- uses -> `module.0b662c3f4f16d304` (inferred, 0.7)
- uses -> `module.57709159fa023727` (inferred, 0.7)
- uses -> `module.dd683ad11325a344` (inferred, 0.7)

Incoming:
- [[Project Overview]] -> contains_module (verified, 1)

## Evidence

- `file:Paralith-tauri/src-tauri/src/services/terminal_manager.rs`

## Metadata

```json
{
  "path": "Paralith-tauri/src-tauri/src/services/terminal_manager.rs",
  "structs": [
    "CreationReservation",
    "TerminalHandle",
    "TerminalLog",
    "TerminalManager"
  ],
  "enums": [],
  "functions": [
    "a_spawned_pane_process_does_not_inherit_no_color",
    "agent_signal_buffer_trims_unicode_at_a_character_boundary",
    "agent_signal_parser_handles_partial_ansi_chunks_and_clears_after_match",
    "append",
    "append_and_sequence",
    "buffered_agent_signal",
    "claude_launches_receive_an_exact_session_id_without_latest",
    "clear_inherited_colour_suppression",
    "close_input",
    "closing_input_allows_a_one_shot_process_waiting_for_eof_to_exit",
    "collect_recent_jsonl",
    "colour_enabling_and_unrelated_variables_are_preserved",
    "concurrent_creates_for_one_pane_yield_exactly_one_session",
    "concurrent_noisy_sessions_remain_responsive_and_terminable",
    "consume_cursor_position_queries",
    "create_output_log",
    "create_session",
    "discover_provider_session_identity",
    "drop",
    "emit_output",
    "empty_no_color_and_uppercase_falsy_values_are_still_cleared",
    "exact_resume_detection_rejects_latest_and_injection_text",
    "for_test",
    "hidden_machine_protocol_terminals_answer_split_cursor_queries",
    "ignore_already_gone",
    "inherited_colour_suppression_is_cleared_for_pane_processes",
    "is_coding_agent",
    "is_machine_protocol_workspace",
    "launch_contains_exact_session",
    "list_live_sessions",
    "... 26 more"
  ]
}
```

<!-- PARALITH:AUTO:END -->
