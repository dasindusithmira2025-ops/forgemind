---
id: system.database-moc
type: system
name: database-moc
status: active
generated: true
confidence: 1
evidence_level: verified
created_at: 2026-08-19T20:53:17.734Z
updated_at: 2026-08-19T20:53:17.734Z
sources:
  - repository:.
related:
tags:
  - paralith
  - system
---
<!-- PARALITH:AUTO:START -->

# Database MOC

- [[Paralith SQLite]] - Application SQLite database managed by Rust migrations. Current schema version: 36.
- [[schema_migrations]] - SQLite table discovered from migration DDL with 2 column-like entries.
- [[projects]] - SQLite table discovered from migration DDL with 14 column-like entries.
- [[workspaces]] - SQLite table discovered from migration DDL with 9 column-like entries.
- [[workspace_panes]] - SQLite table discovered from migration DDL with 11 column-like entries.
- [[terminal_sessions]] - SQLite table discovered from migration DDL with 13 column-like entries.
- [[agent_detections]] - SQLite table discovered from migration DDL with 7 column-like entries.
- [[shell_profiles]] - SQLite table discovered from migration DDL with 8 column-like entries.
- [[app_settings]] - SQLite table discovered from migration DDL with 3 column-like entries.
- [[workspace_events]] - SQLite table discovered from migration DDL with 5 column-like entries.
- [[terminal_sessions_rebuilt]] - SQLite table discovered from migration DDL with 13 column-like entries.
- [[metadata_quarantine]] - SQLite table discovered from migration DDL with 6 column-like entries.
- [[migration_repair_history]] - SQLite table discovered from migration DDL with 9 column-like entries.
- [[agent_profiles]] - SQLite table discovered from migration DDL with 10 column-like entries.
- [[agent_sessions]] - SQLite table discovered from migration DDL with 11 column-like entries.
- [[missions]] - SQLite table discovered from migration DDL with 14 column-like entries.
- [[acceptance_criteria]] - SQLite table discovered from migration DDL with 7 column-like entries.
- [[mission_tasks]] - SQLite table discovered from migration DDL with 18 column-like entries.
- [[task_dependencies]] - SQLite table discovered from migration DDL with 4 column-like entries.
- [[task_acceptance_criteria]] - SQLite table discovered from migration DDL with 3 column-like entries.
- [[worktrees]] - SQLite table discovered from migration DDL with 14 column-like entries.
- [[mission_sessions]] - SQLite table discovered from migration DDL with 17 column-like entries.
- [[task_events]] - SQLite table discovered from migration DDL with 9 column-like entries.
- [[verification_profiles]] - SQLite table discovered from migration DDL with 6 column-like entries.
- [[verification_checks]] - SQLite table discovered from migration DDL with 9 column-like entries.
- [[verification_results]] - SQLite table discovered from migration DDL with 10 column-like entries.
- [[evidence_records]] - SQLite table discovered from migration DDL with 13 column-like entries.
- [[audit_events]] - SQLite table discovered from migration DDL with 8 column-like entries.
- [[recovery_states]] - SQLite table discovered from migration DDL with 10 column-like entries.
- [[project_contexts]] - SQLite table discovered from migration DDL with 9 column-like entries.
- [[project_context_suggestions]] - SQLite table discovered from migration DDL with 7 column-like entries.
- [[memory_settings]] - SQLite table discovered from migration DDL with 3 column-like entries.
- [[memory_events]] - SQLite table discovered from migration DDL with 23 column-like entries.
- [[memory_items]] - SQLite table discovered from migration DDL with 15 column-like entries.
- [[memory_revisions]] - SQLite table discovered from migration DDL with 17 column-like entries.
- [[memory_sources]] - SQLite table discovered from migration DDL with 22 column-like entries.
- [[memory_revision_sources]] - SQLite table discovered from migration DDL with 3 column-like entries.
- [[memory_chunks]] - SQLite table discovered from migration DDL with 16 column-like entries.
- [[open_project_sessions]] - SQLite table discovered from migration DDL with 7 column-like entries.
- [[workspace_placements]] - SQLite table discovered from migration DDL with 17 column-like entries.
- [[monitor_aliases]] - SQLite table discovered from migration DDL with 3 column-like entries.
- [[usage_providers]] - SQLite table discovered from migration DDL with 7 column-like entries.
- [[usage_profiles]] - SQLite table discovered from migration DDL with 17 column-like entries.
- [[usage_windows]] - SQLite table discovered from migration DDL with 9 column-like entries.
- [[usage_snapshots]] - SQLite table discovered from migration DDL with 16 column-like entries.
- [[usage_events]] - SQLite table discovered from migration DDL with 12 column-like entries.
- [[usage_reset_observations]] - SQLite table discovered from migration DDL with 8 column-like entries.
- [[usage_limit_events]] - SQLite table discovered from migration DDL with 10 column-like entries.
- [[usage_alert_prefs]] - SQLite table discovered from migration DDL with 3 column-like entries.
- [[usage_alerts]] - SQLite table discovered from migration DDL with 10 column-like entries.
- [[swarm_execution_defaults]] - SQLite table discovered from migration DDL with 3 column-like entries.
- [[ai_usage_snapshots]] - SQLite table discovered from migration DDL with 4 column-like entries.
- [[ai_usage_file_checkpoints]] - SQLite table discovered from migration DDL with 6 column-like entries.
- [[database_sources]] - SQLite table discovered from migration DDL with 11 column-like entries.
- [[database_source_evidence]] - SQLite table discovered from migration DDL with 17 column-like entries.
- [[database_snapshots]] - SQLite table discovered from migration DDL with 15 column-like entries.
- [[database_objects]] - SQLite table discovered from migration DDL with 29 column-like entries.
- [[database_edges]] - SQLite table discovered from migration DDL with 18 column-like entries.
- [[database_object_provenance]] - SQLite table discovered from migration DDL with 15 column-like entries.
- [[database_designs]] - SQLite table discovered from migration DDL with 13 column-like entries.
- [[database_design_revisions]] - SQLite table discovered from migration DDL with 16 column-like entries.
- [[database_design_operations]] - SQLite table discovered from migration DDL with 14 column-like entries.
- [[database_layouts]] - SQLite table discovered from migration DDL with 19 column-like entries.
- [[database_diffs]] - SQLite table discovered from migration DDL with 13 column-like entries.
- [[database_issues]] - SQLite table discovered from migration DDL with 15 column-like entries.
- [[database_usage_refs]] - SQLite table discovered from migration DDL with 15 column-like entries.
- [[ai_usage_daily]] - SQLite table discovered from migration DDL with 12 column-like entries.
- [[memory_links]] - SQLite table discovered from migration DDL with 9 column-like entries.
- [[memory_tags]] - SQLite table discovered from migration DDL with 4 column-like entries.
- [[memory_properties]] - SQLite table discovered from migration DDL with 7 column-like entries.
- [[memory_claims]] - SQLite table discovered from migration DDL with 13 column-like entries.
- [[memory_claim_sources]] - SQLite table discovered from migration DDL with 3 column-like entries.
- [[memory_relations]] - SQLite table discovered from migration DDL with 12 column-like entries.
- [[memory_jobs]] - SQLite table discovered from migration DDL with 13 column-like entries.
- [[knowledge_project_facts]] - SQLite table discovered from migration DDL with 11 column-like entries.
- [[knowledge_fact_evidence]] - SQLite table discovered from migration DDL with 6 column-like entries.
- [[knowledge_understanding]] - SQLite table discovered from migration DDL with 4 column-like entries.
- [[knowledge_entities]] - SQLite table discovered from migration DDL with 12 column-like entries.
- [[knowledge_entity_aliases]] - SQLite table discovered from migration DDL with 5 column-like entries.
- [[knowledge_candidates]] - SQLite table discovered from migration DDL with 22 column-like entries.
- [[knowledge_candidate_evidence]] - SQLite table discovered from migration DDL with 6 column-like entries.
- [[knowledge_conflicts]] - SQLite table discovered from migration DDL with 24 column-like entries.
- [[knowledge_handoffs]] - SQLite table discovered from migration DDL with 15 column-like entries.
- [[knowledge_timeline]] - SQLite table discovered from migration DDL with 12 column-like entries.
- [[knowledge_context_cache]] - SQLite table discovered from migration DDL with 4 column-like entries.
- [[knowledge_embeddings]] - SQLite table discovered from migration DDL with 12 column-like entries.
- [[code_files]] - SQLite table discovered from migration DDL with 12 column-like entries.
- [[code_symbols]] - SQLite table discovered from migration DDL with 12 column-like entries.
- [[code_imports]] - SQLite table discovered from migration DDL with 9 column-like entries.
- [[code_references]] - SQLite table discovered from migration DDL with 9 column-like entries.
- [[code_index_state]] - SQLite table discovered from migration DDL with 7 column-like entries.
- [[bases]] - SQLite table discovered from migration DDL with 13 column-like entries.
- [[base_views]] - SQLite table discovered from migration DDL with 15 column-like entries.
- [[canvases]] - SQLite table discovered from migration DDL with 7 column-like entries.
- [[canvas_nodes]] - SQLite table discovered from migration DDL with 17 column-like entries.
- [[canvas_edges]] - SQLite table discovered from migration DDL with 15 column-like entries.
- [[skills]] - SQLite table discovered from migration DDL with 24 column-like entries.
- [[skill_activations]] - SQLite table discovered from migration DDL with 11 column-like entries.
- [[mcp_clients]] - SQLite table discovered from migration DDL with 9 column-like entries.
- [[mcp_permissions]] - SQLite table discovered from migration DDL with 5 column-like entries.
- [[mcp_audit]] - SQLite table discovered from migration DDL with 15 column-like entries.
- [[mcp_tasks]] - SQLite table discovered from migration DDL with 12 column-like entries.
- [[mcp_server_state]] - SQLite table discovered from migration DDL with 5 column-like entries.
- [[knowledge_branch_merges]] - SQLite table discovered from migration DDL with 10 column-like entries.
- [[audit_events_v35]] - SQLite table discovered from migration DDL with 8 column-like entries.
- [[swarm_compiled_context_packs]] - SQLite table discovered from migration DDL with 15 column-like entries.
- [[pane_worktrees]] - SQLite table discovered from migration DDL with 11 column-like entries.
- [[repository_connections]] - SQLite table discovered from migration DDL with 17 column-like entries.
- [[repository_provider_accounts]] - SQLite table discovered from migration DDL with 15 column-like entries.
- [[repository_provider_installations]] - SQLite table discovered from migration DDL with 10 column-like entries.
- [[repository_policies]] - SQLite table discovered from migration DDL with 7 column-like entries.
- [[repository_worktree_leases]] - SQLite table discovered from migration DDL with 17 column-like entries.
- [[repository_operations]] - SQLite table discovered from migration DDL with 29 column-like entries.
- [[repository_approvals]] - SQLite table discovered from migration DDL with 20 column-like entries.
- [[repository_remote_cache]] - SQLite table discovered from migration DDL with 14 column-like entries.
- [[repository_sync_cursors]] - SQLite table discovered from migration DDL with 11 column-like entries.
- [[repository_webhook_deliveries]] - SQLite table discovered from migration DDL with 12 column-like entries.
- [[repository_recovery_checkpoints]] - SQLite table discovered from migration DDL with 7 column-like entries.
- [[swarms]] - SQLite table discovered from migration DDL with 20 column-like entries.
- [[swarm_roles]] - SQLite table discovered from migration DDL with 8 column-like entries.
- [[swarm_agents]] - SQLite table discovered from migration DDL with 10 column-like entries.
- [[swarm_tasks]] - SQLite table discovered from migration DDL with 13 column-like entries.
- [[swarm_task_deps]] - SQLite table discovered from migration DDL with 3 column-like entries.
- [[swarm_events]] - SQLite table discovered from migration DDL with 9 column-like entries.
- [[swarm_messages]] - SQLite table discovered from migration DDL with 5 column-like entries.
- [[swarm_presets]] - SQLite table discovered from migration DDL with 9 column-like entries.
- [[swarm_role_allocations]] - SQLite table discovered from migration DDL with 6 column-like entries.
- [[swarm_lifecycle_history]] - SQLite table discovered from migration DDL with 6 column-like entries.
- [[swarm_runtime_sessions]] - SQLite table discovered from migration DDL with 17 column-like entries.
- [[swarm_canvas_connections]] - SQLite table discovered from migration DDL with 10 column-like entries.
- [[swarm_decisions]] - SQLite table discovered from migration DDL with 12 column-like entries.
- [[swarm_evidence]] - SQLite table discovered from migration DDL with 12 column-like entries.
- [[swarm_reviews]] - SQLite table discovered from migration DDL with 10 column-like entries.
- [[swarm_recovery_states]] - SQLite table discovered from migration DDL with 8 column-like entries.
- [[swarm_worktrees]] - SQLite table discovered from migration DDL with 10 column-like entries.
- [[swarm_file_ownership]] - SQLite table discovered from migration DDL with 10 column-like entries.
- [[swarm_test_records]] - SQLite table discovered from migration DDL with 11 column-like entries.
- [[swarm_command_drafts]] - SQLite table discovered from migration DDL with 4 column-like entries.
- [[swarm_context_packs]] - SQLite table discovered from migration DDL with 19 column-like entries.
- [[swarm_runtime_event_receipts]] - SQLite table discovered from migration DDL with 4 column-like entries.
- [[swarm_runs]] - SQLite table discovered from migration DDL with 16 column-like entries.
- [[swarm_agent_runs]] - SQLite table discovered from migration DDL with 22 column-like entries.
- [[swarm_attention_requests]] - SQLite table discovered from migration DDL with 17 column-like entries.
- [[orchestration_sessions]] - SQLite table discovered from migration DDL with 18 column-like entries.
- [[orchestration_turns]] - SQLite table discovered from migration DDL with 7 column-like entries.
- [[orchestration_events]] - SQLite table discovered from migration DDL with 7 column-like entries.
- [[orchestration_capability_executions]] - SQLite table discovered from migration DDL with 11 column-like entries.
- [[repository_graph_snapshots]] - SQLite table discovered from migration DDL with 9 column-like entries.
- [[repository_graph_nodes]] - SQLite table discovered from migration DDL with 17 column-like entries.
- [[repository_graph_edges]] - SQLite table discovered from migration DDL with 18 column-like entries.
- [[repository_graph_index_state]] - SQLite table discovered from migration DDL with 14 column-like entries.

<!-- PARALITH:AUTO:END -->
