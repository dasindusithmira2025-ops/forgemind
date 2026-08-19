---
id: system.context-pack-memory
type: system
name: context-pack-memory
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

# Context Pack - Memory

## Focus

- [[Project Overview]] (project) - Corelith Technologies / Paralith repository intelligence vault generated from source, Git, database migrations, and existing knowledge infrastructure.
- [[Memory]] (feature) - Feature surface discovered from `Paralith-tauri/src/features/memory`.
- [[rust - commands - fabric_ipc]] (module) - Rust module `Paralith-tauri/src-tauri/src/commands/fabric_ipc.rs` exposes Tauri command(s): fabric_memory, fabric_intelligence, fabric_code, fabric_semantic. Defines: ClaimArgs, Im
- [[fabric_memory]] (command) - Tauri command `fabric_memory` declared in `Paralith-tauri/src-tauri/src/commands/fabric_ipc.rs`.
- [[fabric_intelligence]] (command) - Tauri command `fabric_intelligence` declared in `Paralith-tauri/src-tauri/src/commands/fabric_ipc.rs`.
- [[fabric_code]] (command) - Tauri command `fabric_code` declared in `Paralith-tauri/src-tauri/src/commands/fabric_ipc.rs`.
- [[fabric_semantic]] (command) - Tauri command `fabric_semantic` declared in `Paralith-tauri/src-tauri/src/commands/fabric_ipc.rs`.
- [[rust - commands - memory_commands]] (module) - Rust module `Paralith-tauri/src-tauri/src/commands/memory_commands.rs`
- [[rust - database - graph]] (module) - Rust module `Paralith-tauri/src-tauri/src/database/graph.rs` Defines: ContextBody, GraphRow, RawEdge, RelationEdge.
- [[rust - database - knowledge_jobs]] (module) - Rust module `Paralith-tauri/src-tauri/src/database/knowledge_jobs.rs`
- [[rust - database - memory]] (module) - Rust module `Paralith-tauri/src-tauri/src/database/memory.rs` Defines: ParsedQuery.
- [[rust - models - graph]] (module) - Rust module `Paralith-tauri/src-tauri/src/models/graph.rs` Defines: GraphEdge, GraphNode, GraphRequest, ImpactHit, ImpactReport, KnowledgeGraph, KnowledgeHealth.
- [[rust - models - knowledge]] (module) - Rust module `Paralith-tauri/src-tauri/src/models/knowledge.rs` Defines: AnalyzeImpactPayload, AnalyzeProjectOutcome, AnalyzeProjectPayload, CandidateOutcome, ExtractHandoffPayload,
- [[rust - models - memory]] (module) - Rust module `Paralith-tauri/src-tauri/src/models/memory.rs` Defines: AttachSourceRequest, MemoryBacklink, MemoryClaim, MemoryConnections, MemoryDetail, MemoryLink, MemoryProperty,
- [[rust - services - context_compiler]] (module) - Rust module `Paralith-tauri/src-tauri/src/services/context_compiler.rs` Defines: Candidate, ContextCompiler, Fixture, PackCandidate, TestEmbeddingProvider.
- [[rust - services - database_studio - graph]] (module) - Rust module `Paralith-tauri/src-tauri/src/services/database_studio/graph.rs` Defines: DiscoveredSource.
- [[rust - services - knowledge_intelligence]] (module) - Rust module `Paralith-tauri/src-tauri/src/services/knowledge_intelligence.rs` Defines: Fixture, KnowledgeIntelligence.
- [[rust - services - knowledge_lifecycle]] (module) - Rust module `Paralith-tauri/src-tauri/src/services/knowledge_lifecycle.rs` Defines: Fixture, KnowledgeLifecycle.
- [[rust - services - memory_markdown]] (module) - Rust module `Paralith-tauri/src-tauri/src/services/memory_markdown.rs` Defines: ParsedLink, ParsedMemory.
- [[rust - services - memory_service]] (module) - Rust module `Paralith-tauri/src-tauri/src/services/memory_service.rs` Defines: Fixture, MemoryService.
- [[rust - services - project_analyzer]] (module) - Rust module `Paralith-tauri/src-tauri/src/services/project_analyzer.rs` exposes Tauri command(s): tauri_command_names, memory_search, memory_list. Defines: Entry, Findings, Sandbox
- [[tauri_command_names]] (command) - Tauri command `tauri_command_names` declared in `Paralith-tauri/src-tauri/src/services/project_analyzer.rs`.
- [[memory_search]] (command) - Tauri command `memory_search` declared in `Paralith-tauri/src-tauri/src/services/project_analyzer.rs`.
- [[memory_list]] (command) - Tauri command `memory_list` declared in `Paralith-tauri/src-tauri/src/services/project_analyzer.rs`.
- [[ui - features - memory - api.test]] (module) - TypeScript module `Paralith-tauri/src/features/memory/api.test.ts`
- [[ui - features - memory - api]] (module) - TypeScript module `Paralith-tauri/src/features/memory/api.ts`
- [[ui - features - memory - components - MemoryActivity.test]] (module) - TypeScript module `Paralith-tauri/src/features/memory/components/MemoryActivity.test.tsx`
- [[ui - features - memory - components - MemoryActivity]] (module) - TypeScript module `Paralith-tauri/src/features/memory/components/MemoryActivity.tsx` defines UI component(s): JobRow, MemoryActivity, StatusBadge.
- [[JobRow]] (component) - React/UI component discovered in `Paralith-tauri/src/features/memory/components/MemoryActivity.tsx`.
- [[MemoryActivity]] (component) - React/UI component discovered in `Paralith-tauri/src/features/memory/components/MemoryActivity.tsx`.
- [[ui - features - memory - components - MemoryContext.test]] (module) - TypeScript module `Paralith-tauri/src/features/memory/components/MemoryContext.test.tsx`
- [[ui - features - memory - components - MemoryContext]] (module) - TypeScript module `Paralith-tauri/src/features/memory/components/MemoryContext.tsx` defines UI component(s): EntryRow, MemoryContext.
- [[MemoryContext]] (component) - React/UI component discovered in `Paralith-tauri/src/features/memory/components/MemoryContext.tsx`.
- [[ui - features - memory - components - MemoryEditor]] (module) - TypeScript module `Paralith-tauri/src/features/memory/components/MemoryEditor.tsx` defines UI component(s): MemoryEditor.
- [[MemoryEditor]] (component) - React/UI component discovered in `Paralith-tauri/src/features/memory/components/MemoryEditor.tsx`.
- [[ui - features - memory - components - MemoryGraph.test]] (module) - TypeScript module `Paralith-tauri/src/features/memory/components/MemoryGraph.test.tsx`
- [[ui - features - memory - components - MemoryGraph]] (module) - TypeScript module `Paralith-tauri/src/features/memory/components/MemoryGraph.tsx` defines UI component(s): MemoryGraph.
- [[MemoryGraph]] (component) - React/UI component discovered in `Paralith-tauri/src/features/memory/components/MemoryGraph.tsx`.
- [[ui - features - memory - components - MemoryInspector.test]] (module) - TypeScript module `Paralith-tauri/src/features/memory/components/MemoryInspector.test.tsx`
- [[ui - features - memory - components - MemoryInspector]] (module) - TypeScript module `Paralith-tauri/src/features/memory/components/MemoryInspector.tsx` defines UI component(s): ClaimComposer, EvidenceComposer, MemoryInspector, RelationEditor, Sec

## Key Relationships

- [[Project Overview]] has_feature [[Agent Resume]] [verified]
- [[Project Overview]] has_feature [[Code Surface]] [verified]
- [[Project Overview]] has_feature [[Database]] [verified]
- [[Project Overview]] has_feature [[Memory]] [verified]
- [[Project Overview]] has_feature [[Orchestrator]] [verified]
- [[Project Overview]] has_feature [[Repository]] [verified]
- [[Project Overview]] has_feature [[Sidebar]] [verified]
- [[Project Overview]] has_feature [[Swarms]] [verified]
- [[Project Overview]] has_feature [[Terminals]] [verified]
- [[Project Overview]] has_feature [[Updates]] [verified]
- [[Project Overview]] has_feature [[Usage]] [verified]
- [[Project Overview]] has_feature [[Workspace Canvas]] [verified]
- [[Project Overview]] has_feature [[Workspace Setup]] [verified]
- [[Project Overview]] has_feature [[Workspace Windows]] [verified]
- [[Project Overview]] has_package [[corelith_site]] [verified]
- [[Project Overview]] has_package [[corelith_web]] [verified]
- [[Project Overview]] has_package [[paralith-marketing-video]] [verified]
- [[Project Overview]] has_package [[paralith]] [verified]
- [[Project Overview]] has_package [[forgemind]] [verified]
- [[Project Overview]] has_package [[dbstudio-fixture-drizzle]] [verified]
- [[Project Overview]] has_package [[@repo-analytics]] [verified]
- [[Project Overview]] has_package [[@repo-api]] [verified]
- [[Project Overview]] has_package [[@repo-worker]] [verified]
- [[Project Overview]] has_package [[dbstudio-fixture-monorepo]] [verified]
- [[Project Overview]] has_package [[@repo-db]] [verified]
- [[Project Overview]] has_package [[dbstudio-fixture-multi-logical-db]] [verified]
- [[Project Overview]] has_package [[dbstudio-fixture-prisma]] [verified]
- [[Project Overview]] contains_module [[Paralith-tauri - src-tauri - build]] [verified]
- [[Project Overview]] contains_module [[rust - agents - adapter]] [verified]
- [[Project Overview]] contains_module [[rust - agents - mod]] [verified]
- [[Project Overview]] contains_module [[rust - agents - model_registry]] [verified]
- [[Project Overview]] contains_module [[rust - build_info]] [verified]
- [[Project Overview]] contains_module [[rust - commands - agent_commands]] [verified]
- [[Project Overview]] contains_module [[rust - commands - browser_commands]] [verified]
- [[Project Overview]] contains_module [[rust - commands - code_commands]] [verified]
- [[Project Overview]] contains_module [[rust - commands - database_commands]] [verified]
- [[Project Overview]] contains_module [[rust - commands - diagnostics_commands]] [verified]
- [[Project Overview]] contains_module [[rust - commands - fabric_ipc]] [verified]
- [[fabric_memory]] implemented_by [[rust - commands - fabric_ipc]] [verified]
- [[fabric_intelligence]] implemented_by [[rust - commands - fabric_ipc]] [verified]
- [[fabric_code]] implemented_by [[rust - commands - fabric_ipc]] [verified]
- [[fabric_semantic]] implemented_by [[rust - commands - fabric_ipc]] [verified]
- [[rust - commands - fabric_ipc]] uses `module.b13b30928c81b69f` [inferred]
- [[rust - commands - fabric_ipc]] uses `module.3ed764bcf4eee1d6` [inferred]
- [[rust - commands - fabric_ipc]] uses `module.06428a45de853457` [inferred]
- [[rust - commands - fabric_ipc]] uses `module.d8e94d73bbebef19` [inferred]
- [[rust - commands - fabric_ipc]] uses `module.75f2ae6ea8dbdb02` [inferred]
- [[rust - commands - fabric_ipc]] uses `module.b30f0713fb3f8e55` [inferred]
- [[rust - commands - fabric_ipc]] uses `module.224dcb86418c4695` [inferred]
- [[Project Overview]] contains_module [[rust - commands - fabric_scope]] [verified]
- [[Project Overview]] contains_module [[rust - commands - filesystem_commands]] [verified]
- [[Project Overview]] contains_module [[rust - commands - git_commands]] [verified]
- [[Project Overview]] contains_module [[rust - commands - intelligence_commands]] [verified]
- [[Project Overview]] contains_module [[rust - commands - memory_commands]] [verified]
- [[rust - commands - memory_commands]] uses `module.b13b30928c81b69f` [inferred]
- [[rust - commands - memory_commands]] uses `module.3ed764bcf4eee1d6` [inferred]
- [[rust - commands - memory_commands]] uses `module.f35c0b284135b1c4` [inferred]
- [[rust - commands - memory_commands]] uses `module.970c3b894e9c6f2c` [inferred]
- [[rust - commands - memory_commands]] uses `module.e049ddf8c61bb921` [inferred]
- [[rust - commands - memory_commands]] uses `module.b30f0713fb3f8e55` [inferred]
- [[rust - commands - memory_commands]] uses `module.366deef54093df74` [inferred]
- [[Project Overview]] contains_module [[rust - commands - mod]] [verified]
- [[Project Overview]] contains_module [[rust - commands - orchestration_commands]] [verified]
- [[Project Overview]] contains_module [[rust - commands - project_commands]] [verified]
- [[Project Overview]] contains_module [[rust - commands - repository_commands]] [verified]
- [[Project Overview]] contains_module [[rust - commands - semantic_commands]] [verified]
- [[Project Overview]] contains_module [[rust - commands - settings_commands]] [verified]
- [[Project Overview]] contains_module [[rust - commands - swarm_commands]] [verified]
- [[Project Overview]] contains_module [[rust - commands - terminal_commands]] [verified]
- [[Project Overview]] contains_module [[rust - commands - update_commands]] [verified]
- [[Project Overview]] contains_module [[rust - commands - usage_commands]] [verified]
- [[Project Overview]] contains_module [[rust - commands - usage_telemetry_commands]] [verified]
- [[Project Overview]] contains_module [[rust - commands - window_commands]] [verified]
- [[Project Overview]] contains_module [[rust - commands - workspace_commands]] [verified]
- [[Project Overview]] contains_module [[rust - database - backup]] [verified]
- [[Project Overview]] contains_module [[rust - database - code]] [verified]
- [[Project Overview]] contains_module [[rust - database - database_studio]] [verified]
- [[Project Overview]] contains_module [[rust - database - embeddings]] [verified]
- [[Project Overview]] contains_module [[rust - database - graph]] [verified]
- [[rust - database - graph]] uses `module.327579f22c257d7d` [inferred]

<!-- PARALITH:AUTO:END -->
