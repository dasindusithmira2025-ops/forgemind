# PARALITH MASTER ENGINEERING SPECIFICATION

**Company:** Corelith Technologies
**Product:** Paralith
**Document type:** Canonical Product + UX + Systems + Engineering Specification
**Status:** Architecture baseline / living source of truth
**Target:** Paralith 1.0 → 2.0
**Date:** 2026-08-23

---

## Navigation map

This specification is intentionally large. Recommended reading order:

1. **Sections 0–8** — product definition, laws, vocabulary, architecture and data ownership.
2. **Sections 9–17** — Home, Projects, Workspace, command system, editor, search, terminal and services.
3. **Sections 18–33** — Agent Runtime, Profiles, Sessions, Inbox, Missions, Tasks, Run Engine, Context Fabric, Project Graph, Impact, Memory, Worktrees, Swarm, Goals and Automations.
4. **Sections 34–53** — Browser, visual verification, devices, databases, Git/provider integration, Review, Proof, QA, Security Review, Diagnostics, Tasks, Connections, MCP, Skills and Plugins.
5. **Sections 54–89** — Host abstraction, WSL/SSH/Node/mobile, Usage, releases, security, policy, storage, reliability, performance, design system, onboarding, privacy and team/enterprise architecture.
6. **Sections 90–115** — cross-feature flows, six-graph model, code organization, IPC, testing, roadmap, quality gates, product metrics and complete reference journey.
7. **Appendices A–Z** — state machines, evidence levels, safety defaults, subsystem ownership, events, IPC families, concurrency, transactions, artifact retention, remote protocol, UI states, threat model and engineering invariants.

Use this file as the whole-product source of truth. Create smaller subsystem documents only when implementation details become too volatile or code-specific for this master specification.

---

## 0. Why this document exists

This file defines Paralith as one coherent software system. It is intentionally deeper than a roadmap, pitch deck, design brief, or feature list. Every major capability is described from four angles:

1. **User behavior** — what the user sees and does.
2. **UI/UX behavior** — how the capability appears, reacts, fails, restores, and communicates state.
3. **Backend architecture** — what services, data models, state machines, and execution infrastructure make it work.
4. **System integration** — how the feature connects to Missions, Context Fabric, agents, Git, worktrees, Proof Ledger, Memory, remotes, and future automation.

This document is the architecture boundary for Paralith. New features should extend these primitives instead of creating parallel systems.

---

# 1. Product definition

## 1.1 One-sentence definition

> **Paralith is the agentic development operating system that turns developer intent into verified software.**

The complete lifecycle is:

```text
Intent
  ↓
Understand project
  ↓
Plan mission
  ↓
Compile context
  ↓
Isolate work
  ↓
Execute agents
  ↓
Observe runtime
  ↓
Verify behavior
  ↓
Review changes
  ↓
Merge / ship
  ↓
Update durable project knowledge
```

Paralith does not win because it embeds a chat panel beside a code editor. It wins if the entire loop above feels like one continuous system.

## 1.2 Product promise

A user should be able to open a repository and say:

> “Add Google and GitHub OAuth, keep password login working, use the current design system, test the real flow, and prepare the PR.”

Paralith should understand the repository, build a mission, create acceptance criteria, prepare context, isolate parallel work, launch agents, run the application, use the browser or device lab to verify it, collect proof, show a coherent review, and prepare delivery.

## 1.3 What Paralith is not

Paralith is **not**:

- a proprietary foundation-model company;
- a hosted website generator;
- a clone of GitHub.com;
- a clone of Jira;
- a full browser replacement;
- a full database administration suite;
- a new cloud hosting provider;
- a generic team chat product;
- a VS Code extension marketplace clone;
- a collection of unrelated AI buttons.

Every feature must strengthen the core engineering loop.

---

# 2. Product laws

These rules should be treated as architectural constraints.

## 2.1 Local-first, not local-only

A local repository must work without uploading source code to Corelith infrastructure. Remote hosts, Paralith Node, team sync, or future cloud workers are extensions of the same system.

## 2.2 One Run Engine

Missions, Swarms, Tasks, Automations, PR fixes, CI repair, and persistent Goals all execute through the same Run Engine.

There must never be a separate “automation agent engine,” “mission engine,” and “remote agent engine” that duplicate process launching, context compilation, approvals, and proof collection.

## 2.3 One Context Fabric

Every agent receives project knowledge through the same Context Fabric.

## 2.4 One Evidence model

Tests, screenshots, browser runs, device checks, CI, build output, and human review all become typed Evidence attached to Proof Ledger.

## 2.5 Done is a state

An agent saying “done” does not complete work. Completion is decided by acceptance criteria and evidence policies.

## 2.6 Work isolation by default

Any two write-capable agents that can collide must be isolated through worktrees, remote sandboxes, containers, VMs, or another explicit isolation boundary.

## 2.7 Memory must have provenance and staleness

AI summaries without source relationships become misinformation over time. Durable Memory must know where it came from and whether the underlying system has changed.

## 2.8 Context must be inspectable

A developer must always be able to answer: “What did this agent know?”

## 2.9 Capabilities must be explicit

Secrets, database writes, Git pushes, deployment actions, filesystem scope, network access, and destructive operations must be visible and policy-controlled.

## 2.10 UI is not the source of truth

Renderer state may crash or restart. Missions, Tasks, Runs, worktrees, terminals, agents, and important workspace state must survive because the durable source of truth lives below the UI.

---

# 3. Primary user model

## 3.1 Primary user: AI-native engineer

The primary Paralith user:

- works in real repositories;
- already uses Claude Code, Codex, Cursor Agent, OpenCode, or similar engines;
- uses Git and branches;
- runs multiple terminal processes;
- increasingly delegates implementation to agents;
- needs better coordination, context, verification, and recovery;
- values speed but refuses to sacrifice control.

## 3.2 Secondary user types

### Solo founder
Needs maximum throughput from one person.

### Senior engineer
Needs AI assistance without losing technical visibility.

### Small engineering team
Needs shared standards, work isolation, approvals, and project knowledge.

### Enterprise team
Eventually needs self-hosting, policy, audit, SSO, fleet execution, and controlled integrations.

---

# 4. Canonical vocabulary

These names should remain stable across UI, backend, API, docs, telemetry, and code.

| Term | Meaning |
|---|---|
| **Project** | A software project recognized by Paralith. |
| **Repository** | A Git repository contained in or attached to a Project. |
| **Host** | A machine capable of executing project work. |
| **Workspace** | Persistent working environment for a Project. |
| **Pane** | A rectangular container in the workspace layout. |
| **Tab** | A view displayed inside a Pane. |
| **Mission** | A high-level engineering outcome with acceptance criteria. |
| **Task** | A bounded executable piece of work. |
| **Run** | One execution instance handled by the Run Engine. |
| **Agent** | A logical AI worker role. |
| **Agent Profile** | Reusable role/configuration/policy bundle. |
| **Agent Session** | Provider-specific conversation/execution session normalized by Paralith. |
| **Context Request** | Typed description of what knowledge a task needs. |
| **Context Pack** | Compiled context delivered to an agent. |
| **Work Unit** | A specific isolated location where work executes. |
| **Worktree** | Git worktree used to isolate modifications. |
| **Evidence** | A concrete artifact proving some behavior or action. |
| **Proof Ledger** | Structured mapping from acceptance criteria to evidence. |
| **Memory** | Durable project knowledge. |
| **Project Graph** | Structural graph of code and system relationships. |
| **Skill** | Reusable agent procedure. |
| **Connection** | Authorized integration with an external provider. |
| **Automation** | Trigger + mission template + execution policy. |
| **Goal** | Persistent objective that may iterate across multiple Runs. |
| **Approval** | User authorization for a risky operation. |
| **Release** | Verified shipping event. |

---

# 5. Top-level information architecture

```text
PARALITH
├── Home
├── Projects
├── Tasks
├── Automations
├── Agent Inbox
├── Connections
├── Usage
└── Settings

OPEN PROJECT → WORKSPACE
├── Explorer
├── Search
├── Source Control
├── Missions
├── Tasks
├── Memory
├── Project Map
├── Workspace Canvas
│   ├── Code
│   ├── Terminal
│   ├── Browser
│   ├── Agent
│   ├── Diff
│   ├── Pull Request
│   ├── Database
│   ├── Device
│   ├── Logs
│   └── Documentation
├── Contextual Right Sidebar
│   ├── Agent
│   ├── Changes
│   ├── Context
│   ├── Proof
│   └── Inspector
└── Status Bar
```

---

# 6. System architecture overview

```text
┌────────────────────────────────────────────────────────────────┐
│                          PARALITH UI                            │
│ React / TypeScript / Monaco / Design System                    │
└──────────────────────────────┬─────────────────────────────────┘
                               │ typed IPC
┌──────────────────────────────▼─────────────────────────────────┐
│                         RUST CORE                              │
│                                                               │
│ Project Manager      Workspace Manager      Host Registry      │
│ Git Engine           Mission Engine        Run Engine          │
│ Agent Runtime        Context Fabric        Memory Engine       │
│ Project Graph        Proof Ledger          Policy Engine       │
│ Search               Connections           Automation Engine   │
│ Usage                Updater               Event Bus           │
└─────────────┬────────────────┬─────────────────┬───────────────┘
              │                │                 │
      ┌───────▼────────┐ ┌────▼─────────┐ ┌─────▼──────────────┐
      │ Terminal Host  │ │ Agent Host   │ │ Browser Automation │
      │ PTY / ConPTY   │ │ CLI adapters │ │ Playwright/Chromium│
      └────────────────┘ └──────────────┘ └────────────────────┘

┌────────────────────────────────────────────────────────────────┐
│ DATA                                                           │
│ SQLite/WAL • FTS5 • Event Journal • Graph tables • Blob Store │
└────────────────────────────────────────────────────────────────┘

                       HOST ABSTRACTION
           ┌───────────┬──────────┬──────────┬─────────────┐
           ▼           ▼          ▼          ▼
         Local        WSL        SSH      Paralith Node
```

---

# 7. Core data ownership rules

## 7.1 Rust Core owns durable truth

Rust/database owns:

- projects;
- workspaces;
- Missions;
- Tasks;
- Runs;
- Agent Sessions;
- worktrees;
- policies;
- approvals;
- Evidence;
- Memory;
- Project Graph;
- terminals and process identities;
- connections metadata.

## 7.2 Frontend owns ephemeral presentation state

Frontend may own:

- hover state;
- temporary menu state;
- unsaved local form drafts;
- animation state;
- drag preview state.

It must not be the only owner of Mission progress, terminal processes, or agent state.

## 7.3 Typed event journal

Important backend operations append typed domain events:

```text
MissionCreated
MissionPlanned
TaskStarted
AgentLaunched
AgentBlocked
FileChanged
TestExecuted
EvidenceRecorded
ApprovalRequested
ApprovalGranted
ReviewRequested
MissionCompleted
ReleasePublished
MemoryMarkedStale
```

Each event includes correlation fields:

```text
project_id
workspace_id?
mission_id?
task_id?
run_id?
agent_session_id?
host_id
timestamp
```

This event journal supports Activity UI, debugging, recovery, telemetry, auditability, and future synchronization.

---

# 8. Feature specification template

Each major feature below is described using the same engineering lens:

- **Purpose**
- **User experience**
- **UI structure**
- **Important states**
- **Backend components**
- **Data model**
- **Events**
- **Permissions/security**
- **Integration points**
- **Failure/recovery behavior**
- **1.0 acceptance criteria**

---

# 9. HOME — operational command center

## Purpose

Home answers one question:

> “What in my development work needs attention right now?”

It is not a dashboard for vanity metrics.

## User experience

On launch, the user sees recent projects and a compact operational overview. Running work receives visual priority over historical information.

Recommended sections:

1. **Continue** — recent Projects and Workspaces.
2. **Needs attention** — approvals, blocked Runs, failed CI, review-ready Missions.
3. **Running** — active Missions, Agents, services, or remote workers.
4. **Recent Missions** — recently completed or paused outcomes.
5. **Activity** — meaningful cross-project events.

## UI structure

Home should be spatially calm. Avoid twenty boxed cards. Use strong hierarchy, tables/lists, grouped activity rows, and only a few summary counters.

Example:

```text
PARALITH

Needs your attention                                   4
────────────────────────────────────────────────────────
OAuth Mission       Review ready             [Review]
Payment fix         Approval required        [Open]
PR #281             CI failed                [Diagnose]
Android worker      Blocked                   [Inspect]

Continue
Corelith / Paralith            Last active 12m ago
TrustCraft                      Last active yesterday
```

## Backend

`HomeService` queries the event journal and current entity state. It should not maintain duplicate home-specific state.

Data is synthesized from:

- Workspaces;
- Missions;
- Runs;
- Notifications;
- Pull Requests;
- Automations;
- recent Projects.

## Events

Home reacts to domain events and updates incrementally.

## Failure/recovery

If an external provider is unavailable, Home still loads local state and marks external status as unavailable instead of blocking.

## 1.0 acceptance

- home visible in under the general startup target;
- recent Projects correct;
- blocked/review-ready/running work updates live;
- clicking an item navigates to the exact Project/Mission/Run;
- external service failure never breaks Home.

---

# 10. PROJECTS — project registry and opening

## Purpose

Projects make local or remote codebases durable entities rather than transient folder paths.

## User experience

User can:

- open local folder;
- clone Git repository;
- reopen recent Project;
- connect remote Host and open remote repository;
- pin favorite Projects;
- remove Project from Paralith without deleting files.

## Project object

```text
Project
├── id
├── display_name
├── repositories[]
├── default_host_id
├── created_at
├── last_opened_at
├── icon/metadata
└── project_settings
```

## Project discovery pipeline

Opening a new Project starts background discovery without blocking file access.

### Stage A — repository discovery

Detect:

- Git root;
- nested repositories;
- remotes;
- current branch;
- worktrees;
- submodules;
- dirty state.

### Stage B — stack detection

Detect:

- languages;
- frameworks;
- runtimes;
- package managers;
- desktop/mobile frameworks;
- test frameworks;
- container tools.

### Stage C — command detection

Infer install/dev/build/test/lint/typecheck/format commands.

### Stage D — project structure

Identify monorepo packages, services, applications, shared libraries, database layers, API routes, test directories, and likely entrypoints.

### Stage E — agent availability

Detect installed Claude Code, Codex, and other supported adapters.

## UI behavior

The project can be used immediately while discovery progresses. A small non-blocking status appears:

> Understanding project… 6/8 signals indexed

Clicking opens details.

## Backend

Services:

- `ProjectRegistry`
- `ProjectDiscoveryService`
- `RepositoryDetector`
- `StackDetector`
- `CommandDetector`
- `AgentDetector`
- `ProjectGraphIndexer`

## Integration

Project Discovery feeds:

- Run Profiles;
- Context Fabric;
- Project Graph;
- Memory bootstrap;
- Mission Preflight;
- Usage categorization.

## Failure handling

Discovery stages are independent. If language-server detection fails, Git and files still work.

## 1.0 acceptance

- Project opens before heavy indexing completes;
- detection results are editable when incorrect;
- re-index can be triggered manually;
- removing Project never deletes repository unless explicitly requested;
- discovery errors are surfaced with actionable detail.

---

# 11. WORKSPACE SHELL — persistent development environment

## Purpose

The Workspace is the primary operating environment for a Project. It must survive layout changes, multi-monitor use, application restarts, and partial renderer crashes.

## Layout model

```text
Workspace
├── workspace_id
├── project_id
├── window_ids[]
├── pane_tree
├── active_context
├── sidebar_state
├── status_state
└── restoration_metadata
```

`pane_tree` is a recursive split model.

```text
PaneNode =
  LeafPane { pane_id, tabs[], active_tab }
  SplitPane { direction, ratio, children[] }
```

## UX

Any supported content type can become a Tab. Tabs can move between panes and windows.

Operations:

- split left/right/up/down;
- drag tab to another Pane;
- detach to new Window;
- move Window to another monitor;
- save layout preset;
- restore closed Tab;
- reopen last Workspace state.

## Important principle

The visual layout is flexible, but product navigation remains predictable. Explorer and major activity controls should not vanish behind arbitrary plugin layouts by default.

## Backend

`WorkspaceManager` stores layout snapshots and Window Registry state.

## Multi-window rule

A Window is only a view over shared backend state. It does not own terminals, agents, Missions, or Project truth.

## Failure recovery

If a renderer crashes:

- backend processes remain alive;
- Window Registry marks renderer unavailable;
- user can reopen the window and rebind Tabs;
- last stable pane snapshot restores.

## 1.0 acceptance

- tab movement preserves content state;
- detached windows can type into editor/terminal correctly;
- closing secondary window does not kill unrelated processes;
- workspace layout restores across restart;
- multi-monitor bounds restore safely when monitor configuration changes.

---

# 12. UNIVERSAL COMMAND SYSTEM

## Purpose

Keyboard-first control surface for almost every user action.

Default shortcut:

`Ctrl/Cmd + K`

## Command model

```text
Command
├── id
├── title
├── subtitle?
├── category
├── icon
├── keybinding?
├── availability(context)
├── arguments_schema?
└── execute(context, args)
```

## Commands include

- Open File
- Switch Project
- Create Mission
- Start Agent
- Open Terminal
- Start Run Profile
- Search Memory
- Open Current PR
- Create Worktree
- Launch Android Device
- Review Changes
- Open Proof Ledger

## UX

Results rank by context and recency. For example, inside a Git diff, “Review with Agent” should rank higher than “Open Android Device.”

## Plugins

Future plugins register Commands through controlled APIs.

## 1.0 acceptance

- local command search returns near-instantly;
- keyboard navigation complete;
- context-disabled commands explain why unavailable when selected;
- commands can be rebound.

---

# 13. PROJECT EXPLORER

## Purpose

Provide fast, trustworthy filesystem navigation with development context.

## UX capabilities

- file/folder tree;
- create/rename/move/delete;
- drag and drop;
- multi-select;
- Git status decorations;
- diagnostics decorations;
- ignore handling;
- compact folders;
- quick file preview;
- copy relative/absolute path;
- reveal in OS explorer;
- open terminal here.

## Agent contextual actions

Right-click file/folder:

- Ask Agent;
- Explain;
- Add to Context;
- Review File;
- Fix Diagnostics;
- Find Related Memory;
- Show Impact.

## Backend

File operations go through scoped Rust filesystem APIs. The frontend never receives an unrestricted arbitrary filesystem primitive.

## Watch integration

Explorer consumes canonical `FileChanged` events from the single File Watch Service.

## Security

Filesystem scope defaults to the Project root and known worktrees. Access outside scope requires explicit action/policy.

## 1.0 acceptance

- large trees virtualized;
- rename/move updates editor tabs and internal graph identities;
- external file changes reflected reliably;
- destructive operations confirm when necessary;
- Git/diagnostic decorations never block basic file rendering.

---

# 14. CODE EDITOR

## Purpose

Provide a professional editor sufficient for serious development while keeping Paralith focused on agentic engineering.

## Editor UI

Monaco-based editing surface with:

- syntax highlighting;
- multi-cursor;
- find/replace;
- folding;
- breadcrumbs;
- minimap;
- diagnostics;
- completion;
- go to definition;
- references;
- hover;
- symbol outline;
- formatting;
- diff view;
- multiple open tabs.

## LSP architecture

Language intelligence is supplied through standard language servers where practical.

```text
Editor
  ↓
LSP Client Bridge
  ↓
Language Server process on active Host
```

For remote Projects, language server runs on the remote Host when possible.

## AI interactions

AI should be contextual rather than permanently intrusive.

Examples:

- select code → “Ask Agent”;
- diagnostic → “Fix with Agent”;
- file tab → “Review file”;
- symbol → “Explain impact.”

## Save model

Editor tracks dirty buffers. Agent filesystem writes to an open dirty file require conflict handling.

### Conflict policy

If user buffer contains unsaved changes and an Agent modifies same file:

- do not silently overwrite;
- detect external modification;
- present merge/reload/keep options;
- where possible isolate agent work through worktree to avoid this entirely.

## 1.0 acceptance

- smooth typing under indexing load;
- LSP restarts recover cleanly;
- external writes do not silently destroy user edits;
- remote file latency handled with optimistic UI where safe;
- editor still works if AI providers are offline.

---

# 15. SEARCH

## Purpose

One interface for finding code, symbols, knowledge, agent history, and work artifacts.

## Search engines

### Literal code search
Use fast local text search such as ripgrep.

### Symbol search
Language-server/parser index.

### Memory search
SQLite FTS5 and graph relationships.

### Semantic search
Optional local embeddings or configured semantic index.

### Git search
Commit messages/history.

### Agent/session search
Normalized transcripts and events.

## Unified result model

```text
SearchResult
├── kind
├── title
├── location
├── snippet
├── score
├── source
└── action
```

## UX

Filters:

- Code
- Files
- Symbols
- Memory
- Missions
- Tasks
- Agents
- Git
- Terminal

Search must stream results rather than wait for every backend.

## 1.0 acceptance

- literal results appear rapidly;
- filters keyboard accessible;
- clicking result restores exact source context;
- failure of semantic index does not break literal search.

---

# 16. TERMINAL SYSTEM

## Purpose

Paralith terminal must behave like a real development terminal and remain stable across UI lifecycle events.

## Architecture

```text
Terminal Tab
   ↓
Terminal RPC
   ↓
Terminal Host
   ↓
PTY / ConPTY
   ↓
Shell process
```

### Windows
Use ConPTY.

### macOS/Linux
Use platform PTY support.

## TerminalSession

```text
TerminalSession
├── id
├── host_id
├── workspace_id
├── worktree_id?
├── cwd
├── shell
├── environment_profile
├── process_id
├── state
├── created_at
└── transcript_policy
```

## UI

- terminal tabs;
- splits;
- ANSI/color support;
- search;
- hyperlinks;
- copy/paste;
- drag files;
- command detection;
- exit status;
- shell profile selection;
- restart;
- detach/reattach.

## Process states

```text
STARTING
RUNNING
WAITING_INPUT
EXITED
FAILED
DETACHED
LOST
```

## Restoration

Closing UI should not automatically kill running terminal if configured to detach.

After OS reboot, session layout may restore but process state becomes `LOST/EXITED`, never falsely “running.”

## Agent integration

Agent CLI adapters may run through a dedicated Agent Host instead of ordinary user terminals, but users can always open a Raw Terminal view for transparency.

## 1.0 acceptance

- professional interactive shell behavior;
- no lost keystrokes in secondary windows;
- process survives pane movement;
- clear kill vs detach semantics;
- terminal output does not freeze UI.

---

# 17. RUN PROFILES AND SERVICE MANAGER

## Purpose

Turn recurring commands into understood project services.

## RunProfile

```text
RunProfile
├── id
├── project_id
├── name
├── command
├── cwd
├── environment
├── dependencies[]
├── readiness_probe
├── health_probe
└── stop_strategy
```

Examples:

- Web
- API
- Desktop
- Storybook
- Tests
- Android

## Service Manager

Running profiles become `ServiceInstance` entities.

```text
ServiceInstance
├── profile_id
├── terminal_session_id
├── status
├── discovered_ports[]
├── health
└── started_by
```

## UI

Status bar shows compact services:

```text
● Web :3000   ● API :8080   ○ Storybook stopped
```

Click opens:

- logs;
- restart;
- stop;
- browser;
- process details.

## Integration

Browser localhost detection and Mission verification consume Service Manager state.

## 1.0 acceptance

- user can override inferred commands;
- readiness/health probes distinguish process-alive from app-ready;
- service crashes trigger actionable notification;
- agents can request starting a known profile through policy.

---

# 18. AGENT RUNTIME — provider-independent execution

## Purpose

Paralith must treat Claude Code, Codex, Cursor Agent, OpenCode, and future engines as interchangeable execution providers behind one normalized contract. The user should experience one coherent agent system even though underlying providers differ.

## Adapter contract

Conceptual interface:

```text
AgentAdapter
├── detect_installation()
├── get_auth_state()
├── get_capabilities()
├── list_models()
├── start_session(request)
├── resume_session(session_ref)
├── send_message()
├── steer()
├── stop()
├── read_usage()
└── normalize_events()
```

The contract must expose capabilities rather than assume all providers behave the same.

## Capability model

```text
AgentCapabilities
├── supports_resume
├── supports_model_selection
├── supports_reasoning_effort
├── supports_images
├── supports_structured_tool_events
├── supports_subagents
├── supports_streaming
├── supports_usage_reporting
└── supports_native_sandbox
```

## UI behavior

When starting an Agent:

1. choose Agent Profile;
2. optionally choose engine/model;
3. show environment/worktree;
4. show permission mode;
5. launch.

The UI only exposes controls supported by the selected adapter.

## Normalized event stream

Paralith transforms provider-specific output into:

```text
USER_MESSAGE
AGENT_MESSAGE
THOUGHT_SUMMARY
TOOL_START
TOOL_COMPLETE
COMMAND_START
COMMAND_COMPLETE
FILE_CHANGE
APPROVAL_REQUIRED
EVIDENCE_CREATED
ERROR
STATUS_CHANGE
```

Raw provider output remains available for transparency/debugging.

## Backend components

- `AgentRegistry`
- `AgentAdapterManager`
- `AgentHost`
- `AgentSessionService`
- `AgentEventNormalizer`
- `UsageAdapter`

## Security

Provider processes are untrusted/limited-trust child processes. Credentials are not dumped into generic prompts. Environment variables are minimized.

## Failure handling

Adapter crashes or malformed output must produce a session failure event without corrupting Mission state. Session can retry/resume when provider supports it.

## 1.0 acceptance

- Claude Code and Codex first-class;
- provider output normalized into shared UI;
- raw output accessible;
- session stop/steer/reconnect reliable;
- unsupported capabilities never appear as fake controls.

---

# 19. AGENT PROFILES

## Purpose

Separate “what role should this worker perform?” from “which model/provider executes it?”

## Profile examples

- Architect
- Builder
- Frontend Engineer
- Backend Engineer
- QA Engineer
- Security Reviewer
- Release Engineer

## Data model

```text
AgentProfile
├── id
├── name
├── description
├── system_instructions
├── preferred_adapter
├── preferred_model
├── reasoning_policy
├── skills[]
├── default_permissions
├── context_policy
├── verification_policy
└── scope (global/project/org)
```

## Inheritance

```text
System safety policy
       ↓
Organization policy
       ↓
Project policy
       ↓
Agent Profile
       ↓
Mission override
```

More restrictive security always wins.

## UX

Profile editor should not feel like editing a raw JSON blob. Use sections:

- Identity
- Engine
- Instructions
- Skills
- Context
- Permissions
- Verification

Advanced raw configuration may exist behind an expert view.

## 1.0 acceptance

- profiles reusable across Missions;
- project-specific profile overrides supported;
- policy conflicts clearly explained;
- deleting a profile never destroys historical Run metadata.

---

# 20. AGENT SESSIONS

## Purpose

Make agent work durable, searchable, resumable, and understandable.

## AgentSession

```text
AgentSession
├── id
├── run_id
├── adapter
├── provider_session_ref?
├── profile_id
├── model
├── work_unit_id
├── status
├── started_at
├── ended_at?
└── resume_metadata
```

## UI

An Agent Tab contains:

1. header — role, engine, model, worktree, state;
2. transcript — normalized events;
3. composer — user steering;
4. context shortcut — inspect current Context Pack;
5. changes shortcut — current diff;
6. proof shortcut — generated Evidence;
7. raw terminal toggle.

## Session actions

- stop;
- resume;
- rename;
- duplicate/branch conversation where provider permits;
- hand off to another profile;
- archive;
- search transcript.

## Persistence

Session history lives in backend storage, not renderer memory.

## 1.0 acceptance

- application restart preserves transcript and session identity;
- provider resume used when available;
- lost provider session clearly marked;
- session can be associated with Mission/Task/worktree.

---

# 21. AGENT INBOX — fleet supervision

## Purpose

Let one human supervise many concurrent workers without watching terminal windows.

## Inbox categories

### Action Required
Approval or clarification needed.

### Review Ready
Implementation awaits human inspection.

### Blocked
Agent cannot make progress.

### Failed
Run failed unexpectedly.

### Running
Only significant status/progress items.

### Completed
Recently completed Runs.

## Inbox item model

```text
AgentInboxItem
├── id
├── project_id
├── mission_id?
├── run_id
├── priority
├── category
├── title
├── summary
├── actions[]
├── created_at
└── resolved_at?
```

## UX

The inbox favors actionable summaries rather than raw output.

Example:

```text
OAuth Mission / Backend Worker
Approval required
Run database migration in development database.

[Inspect command] [Approve once] [Reject]
```

## Backend

Inbox is derived from Runs, Approvals, Notifications, and Mission state. Avoid duplicate source-of-truth rows when possible.

## 1.0 acceptance

- user can resolve most routine intervention without opening terminal;
- actions navigate to relevant context;
- duplicates collapsed;
- resolved items disappear without losing audit history.

---

# 22. MISSION CONTROL — intent becomes executable work

## Purpose

Mission Control converts vague high-level intent into a structured engineering contract.

An agent prompt asks an engine to work. A Mission defines what success means.

## Mission creation UX

Mission composer accepts plain language, attachments, selected files, issue references, browser selections, or existing PR context.

Example input:

> Add Google and GitHub login. Keep existing password authentication. Existing users must be able to link OAuth providers. Match the current login UI and test the real flow.

### Creation modes

- **Quick Mission** — minimal review for low-risk work;
- **Planned Mission** — recommended default;
- **Manual Mission** — user defines criteria/tasks explicitly.

## Preflight

Before planning, Mission Engine asks Context Fabric for architecture and recent-change context.

Preflight may inspect:

- relevant code;
- Git status;
- Memory;
- Project Graph;
- current branch;
- tests;
- run profiles;
- environment health;
- provider availability.

## Mission specification

```text
Mission
├── id
├── title
├── objective
├── description
├── constraints[]
├── non_goals[]
├── acceptance_criteria[]
├── risk_level
├── verification_policy
├── base_ref
├── status
├── created_by
└── timestamps
```

### AcceptanceCriterion

```text
AcceptanceCriterion
├── id
├── mission_id
├── statement
├── required_evidence_level
├── verification_method?
├── status
└── linked_evidence[]
```

## UI structure

Mission page:

```text
MISSION: Team Invitations                    RUNNING

Goal
Build invite-by-email with 7-day expiration.

Acceptance Criteria                         4/6 verified
✓ Send invitation
✓ Prevent duplicate active invite
⋯ Seven-day expiration
⋯ Existing permissions unaffected

Execution
Architect        Complete
Backend          Running
Frontend         Running
QA               Waiting

[Timeline] [Tasks] [Changes] [Proof] [Context]
```

## Mission states

```text
DRAFT
PREFLIGHT
PLANNED
RUNNING
VERIFYING
REVIEW_READY
MERGING
COMPLETED
BLOCKED
FAILED
CANCELLED
```

Transitions are validated by backend state machine.

## Mission edits during execution

Changing scope after work begins should create a Mission revision. Acceptance criteria changes are logged. Agents affected by the revision receive refreshed Context Packs.

## 1.0 acceptance

- Mission criteria editable before execution;
- changes during execution versioned;
- Mission cannot become completed if required criteria lack proof;
- user can pause/cancel without orphaning worktrees;
- all Runs trace back to Mission/Task.

---

# 23. TASK GRAPH — Mission decomposition

## Purpose

Represent work dependencies explicitly so parallel execution is safe and visible.

## Task model

```text
Task
├── id
├── mission_id?
├── parent_task_id?
├── title
├── objective
├── dependencies[]
├── predicted_files[]
├── context_request
├── profile_id
├── execution_mode
├── verification_requirements
├── status
└── priority
```

## Task states

```text
PLANNED
READY
RUNNING
BLOCKED
VERIFYING
REVIEW_READY
COMPLETED
FAILED
CANCELLED
```

## Planner behavior

Planner should favor task boundaries that minimize write collision.

Bad decomposition:

- Worker A edits `auth.ts` for provider configuration.
- Worker B edits `auth.ts` for callback logic.

Better decomposition may serialize or assign the whole module to one worker.

## UI

Two views:

### List
Operational default.

### Dependency graph
Useful when Mission is complex.

Graph should not be used merely as futuristic decoration.

## Backend

`TaskScheduler` only marks a Task `READY` when dependencies are satisfied and execution policy allows it.

## 1.0 acceptance

- dependency cycles rejected;
- task status derived reliably;
- scheduler respects maximum parallelism;
- user can reassign profile/engine before task starts.

---

# 24. RUN ENGINE — canonical execution primitive

## Purpose

Provide one execution lifecycle for every autonomous operation in Paralith.

## Inputs

```text
RunRequest
├── project_id
├── source_type (mission/task/automation/goal/pr/manual)
├── source_id
├── objective
├── profile_id
├── host_policy
├── isolation_policy
├── context_request
├── permission_policy
├── verification_policy
└── budget_policy
```

## Execution pipeline

```text
Run Request
   ↓
Resolve policy
   ↓
Resolve Host
   ↓
Resolve Work Unit / worktree
   ↓
Prepare Environment
   ↓
Compile Context Pack
   ↓
Launch Agent Session
   ↓
Capture Events / Changes
   ↓
Handle Approvals
   ↓
Run Verification
   ↓
Collect Evidence
   ↓
Finalize Run
   ↓
Update Task / Mission / Goal
```

## Run states

```text
QUEUED
PREPARING
WAITING_ENVIRONMENT
WAITING_APPROVAL
RUNNING
VERIFYING
REVIEW_READY
SUCCEEDED
FAILED
CANCELLED
INTERRUPTED
```

## Idempotency and recovery

Run Engine operations that can be retried must use idempotency keys where practical. A process crash should not accidentally create three worktrees or rerun a destructive migration.

## Cancellation

Cancel has levels:

- graceful stop;
- terminate provider process;
- cleanup temporary resources;
- retain worktree by default for inspection.

## Backend components

- `RunService`
- `RunScheduler`
- `EnvironmentResolver`
- `HostResolver`
- `WorkUnitManager`
- `ContextCompiler`
- `AgentLauncher`
- `VerificationCoordinator`

## Events

Every major transition emits domain event.

## 1.0 acceptance

- every Agent execution uses Run Engine;
- restart recovery identifies interrupted Runs;
- Run never loses link to worktree/session/evidence;
- cancellation leaves repository recoverable;
- retry semantics are explicit.

## Implementation status (2026-08-23)

Implemented. See `Paralith-tauri/docs/RUN_ENGINE.md` for the architecture and
`docs/FORENSIC_COMPLETION_AUDIT.md` for the verification.

Against the acceptance list above:

| Criterion | Status |
| --- | --- |
| every Agent execution uses Run Engine | **Partial.** Single-agent execution and Swarm launch both enter through `RunService`. Swarm *worker* processes are still spawned by the Swarm engine and mirrored as child Runs. |
| restart recovery identifies interrupted Runs | **Met.** `RunService::reconcile_after_restart` runs before the scheduler; verified against the live database. |
| Run never loses link to worktree/session/evidence | **Met** for worktree, session and context pack, which are typed columns on `runs`. Evidence is the `run_events` journal; a Proof Ledger (§44) does not exist yet. |
| cancellation leaves repository recoverable | **Met.** Cancellation stops the process and retains the worktree by design. |
| retry semantics are explicit | **Met.** A retry creates a new Run linked by `retry_of_run_id`; terminal state is never rewritten. |

Not yet built from the components list: `HostResolver` (execution is implicitly local),
`VerificationCoordinator` (`VERIFYING` / `REVIEW_READY` are reachable states with no executor
behind them), and `EnvironmentResolver` beyond provider detection.

---

# 25. CONTEXT FABRIC — project-aware context compiler

## Purpose

Deliver the minimum high-value project knowledge required for a task instead of blindly sending the repository or relying on the agent to discover everything repeatedly.

## Context Request

```text
ContextRequest
├── id
├── project_id
├── objective
├── task_type
├── seed_entities[]
├── required_domains[]
├── token_budget
├── trust_policy
├── recency_policy
└── exclusions[]
```

## Candidate sources

- source files;
- symbols;
- Project Graph neighbors;
- Git history/diffs;
- Mission/Task data;
- Memory;
- prior verified Missions;
- terminal errors;
- browser console/network;
- database schema;
- PR comments/checks;
- docs;
- user-selected context.

## Retrieval pipeline

```text
Context Request
      ↓
Seed resolution
      ↓
Candidate retrieval
      ↓
Relationship expansion
      ↓
Relevance ranking
      ↓
Trust/policy filtering
      ↓
Deduplication
      ↓
Token budgeting
      ↓
Compression/summarization where safe
      ↓
Provenance attachment
      ↓
Context Pack
```

## Ranking signals

- exact symbol/name match;
- call/import relationship;
- path proximity;
- Git recency;
- Mission relevance;
- Memory relationship;
- runtime-error references;
- user pinning;
- semantic similarity.

No single vector similarity score should dominate.

## ContextItem

```text
ContextItem
├── id
├── kind
├── source_ref
├── revision
├── content_or_pointer
├── relevance_score
├── reason
├── trust_class
├── token_cost
└── provenance
```

## Context Pack

```text
ContextPack
├── id
├── request_id
├── items[]
├── total_tokens
├── created_at
├── compiler_version
└── fingerprint
```

## Trust classes

```text
SYSTEM_POLICY
USER_INSTRUCTION
PROJECT_TRUSTED
PROJECT_UNTRUSTED
EXTERNAL_UNTRUSTED
```

Repository text is data, not automatically instruction.

## Token budgets

Budget should adapt to task type and provider window. Small bug fix should not receive architecture-book-size context.

## Context Inspector UI

User can see:

- included items;
- why included;
- source/revision;
- approximate token use;
- excluded/ignored sources;
- stale Memory warnings.

User may pin/remove items and regenerate the Pack.

## Cache

Context Packs can be cached by fingerprint but invalidated when relevant source revisions change.

## 1.0 acceptance

- compiler provenance visible;
- Memory and code can both participate;
- context excludes ignored/private paths by policy;
- stale source relationships invalidate cached packs;
- user can inspect exactly what was sent.

---

# 26. PROJECT GRAPH — structural understanding

## Purpose

Maintain a queryable structural model of the Project that supports Context Fabric, Impact Intelligence, navigation, and planning.

## Node types

```text
Repository
Package
Directory
File
Symbol
Class
Function
Component
Service
API Route
Database Entity
Test
Configuration
External Dependency
```

## Edge types

```text
CONTAINS
IMPORTS
CALLS
IMPLEMENTS
EXTENDS
DEPENDS_ON
ROUTES_TO
READS
WRITES
TESTS
CONFIGURES
REFERENCES
```

## Indexing

Graph indexer should be incremental.

Input signals:

- parser/LSP results;
- import analysis;
- framework adapters;
- configuration analysis;
- test naming conventions;
- repository structure.

## Data storage

Start with SQLite relational graph tables unless scale proves a dedicated graph database necessary.

Example:

```text
project_nodes(id, project_id, kind, stable_key, metadata_json, revision)
project_edges(id, project_id, from_id, to_id, kind, metadata_json)
```

## Stable identity

Nodes should survive simple file moves when symbol identity can be reconciled.

## Project Map UI

The default graph visualization should be high-level and filtered, not tens of thousands of nodes.

Views:

- Architecture
- Packages
- Services
- APIs
- UI
- Data
- Tests
- Recent Changes

## 1.0 acceptance

- graph indexing incremental;
- opening Project never waits for full graph;
- graph failures do not block editor;
- Context Fabric can query neighbors;
- map supports drill-down and source navigation.

---

# 27. IMPACT INTELLIGENCE

## Purpose

Estimate blast radius before and after a change.

## Pre-change flow

User selects symbol/file/Mission and asks:

> Show impact.

System traverses graph and recent-change relationships.

Output:

- directly dependent components;
- likely affected tests;
- APIs/data paths;
- Memory potentially made stale;
- high-risk areas.

## Post-change flow

Git diff produces changed entities. Impact engine identifies:

- affected graph neighbors;
- recommended tests;
- stale docs/Memory candidates;
- Mission criteria that may need re-verification.

## Risk labels

Use understandable categories:

- Low
- Medium
- High
- Critical

Do not present pseudo-precise “87.3% risk.”

## Backend

`ImpactService` combines graph traversal, dependency types, change size, ownership, test coverage relationships, and project rules.

## 1.0 acceptance

- affected tests surfaced;
- Memory staleness loop receives impact reports;
- result explains why an item is considered affected;
- no claim of exhaustive certainty.

---

# 28. MEMORY — durable project intelligence

## Purpose

Preserve useful project knowledge across sessions and agent providers while preventing stale summaries from becoming trusted truth.

## Memory layers

### Event Memory
Raw durable facts: Mission completed, file changed, decision approved, incident occurred.

### Derived Knowledge
Automatically generated project understanding that can be regenerated.

### Stable Memory
Curated, verified, or explicitly pinned knowledge intended to guide future work.

## Memory types

- Architecture
- Decision
- Convention
- Feature
- Requirement
- Incident
- Discovery
- Process

## Memory model

```text
MemoryNode
├── id
├── project_id
├── type
├── title
├── content
├── confidence
├── trust_level
├── staleness_state
├── created_by
├── created_at
├── verified_at?
├── locked
└── current_revision_id

MemoryRevision
├── id
├── memory_id
├── content
├── provenance[]
├── created_at
└── reason
```

## Staleness states

```text
FRESH
AT_RISK
STALE
SUPERSEDED
```

## Automatic loop

```text
File Watch Event
    ↓
Relevance filter
    ↓
Impact Report
    ↓
Find related Memory
    ↓
Evaluate staleness policy
    ↓
Mark at-risk/stale or propose update
    ↓
Emit MemoryKnowledgeUpdated
```

## UI

Memory has several views:

### Library
Searchable list.

### Detail
Content, provenance, related code, revision history, freshness.

### Graph
Relationships among knowledge.

### Activity
Recent auto-updates/staleness events.

## User controls

- edit;
- verify;
- pin;
- lock;
- reject generated update;
- supersede;
- link to code/Mission;
- exclude from Context Fabric.

## Context integration

Only relevant Memory is compiled. Stale Memory is either excluded or clearly labeled depending on policy.

## 1.0 acceptance

- provenance visible;
- stale state automatic for changed relevant code;
- locked Memory never silently modified;
- Memory search fast;
- Context Fabric respects freshness/trust.

---

# 29. MEMORY GRAPH

## Purpose

Visualize conceptual project knowledge rather than raw code structure.

## Node examples

- Authentication Architecture
- OAuth Decision
- Session Security Rule
- Login Feature
- Incident: Refresh Race

## Edge examples

```text
RELATES_TO
DEPENDS_ON
SUPERSEDES
EXPLAINS
CONSTRAINS
DERIVED_FROM
```

## UX

Start with a focused neighborhood around selected memory. Offer expand controls rather than rendering whole graph.

Selecting a node opens right-side details with:

- summary;
- freshness;
- related code;
- relevant Missions;
- provenance.

## Integration

Memory Graph and Project Graph remain separate domains but can cross-link through source relationships.

---

# 30. WORKTREE ENGINE — safe parallel modification

## Purpose

Provide automatic Git isolation for concurrent agent work.

## WorkUnit model

```text
WorkUnit
├── id
├── project_id
├── repository_id
├── host_id
├── base_ref
├── branch_name
├── worktree_path
├── owner_run_id
├── lifecycle_state
└── cleanup_policy
```

## Lifecycle

```text
REQUESTED
CREATING
READY
ACTIVE
INTEGRATING
REVIEW
MERGED
ARCHIVED
CLEANUP_PENDING
REMOVED
ERROR
```

## UX

Users should see conceptual work, not filesystem trivia.

Example:

```text
Main
├── OAuth Mission
├── Dashboard Redesign
└── Payment Bug
```

Advanced details reveal branch/path.

## Creation policy

- read-only analysis may share checkout;
- write-capable Run receives worktree when collision is possible;
- tiny single-agent Mission may use current branch only when user policy allows.

## Integration branch

Complex Swarms may merge worker branches into a temporary integration worktree for verification before user branch.

## Conflict prediction

Planner predicts files likely to be modified. Task Scheduler detects overlapping predicted ownership and either serializes or warns.

## Actual collision tracking

File-change events update actual ownership map. Coordinator can react when assumptions fail.

## Cleanup

Never auto-delete a worktree with unmerged/unreviewed modifications without a strong explicit policy.

## 1.0 acceptance

- create/list/remove safe;
- worktree state survives restart;
- uncommitted work protected;
- Mission Review can inspect all worker diffs;
- cleanup never loses code silently.

---

# 31. SWARM — coordinated parallel agents

## Purpose

Use multiple workers only when parallel execution improves quality or speed.

## Roles

### Coordinator
Owns Mission/task graph and integration decisions.

### Worker
Performs bounded task.

### Reviewer
Inspects integrated changes.

### Verifier
Executes independent validation.

## Topologies

### Independent parallel

```text
        Coordinator
       /    |      \
     UI    API    Tests
```

### Research then build

```text
Researchers
    ↓
Architect
    ↓
Builders
    ↓
QA
```

### Competitive solution

```text
Worker A ─┐
Worker B ─┼→ Evaluator
Worker C ─┘
```

Used sparingly because it is expensive.

## Worker communication

Do not copy whole transcripts between agents.

Structured message types:

```text
Finding
Decision
InterfaceChange
Blocker
Request
Artifact
Warning
```

Example:

```text
InterfaceChange
source: backend-worker
scope: /oauth/link
message: provider is now a required request field
```

Context Fabric injects only relevant messages into dependent Tasks.

## Swarm UI

Default is operational list/timeline:

```text
Coordinator       Running
Backend           Complete
Frontend          Running
QA                Waiting
```

Graph is secondary visualization for complex topology.

## Resource policy

Mission defines maximum parallel workers and provider budgets.

## Failure behavior

A worker failure does not automatically fail entire Mission. Coordinator evaluates retry/replan/dependency impact.

## 1.0 acceptance

- worker isolation reliable;
- dependency scheduler respects readiness;
- structured handoffs visible;
- coordinator can retry/replace failed worker;
- user can stop individual worker or entire Swarm.

---

# 32. LONG-RUNNING GOALS

## Purpose

Represent persistent objectives that may require repeated observation and replanning.

Example:

> Get the full CI pipeline green.

## Goal model

```text
Goal
├── id
├── project_id
├── objective
├── success_condition
├── max_runtime
├── max_iterations
├── budget_policy
├── allowed_actions
├── observation_policy
└── status
```

## Control loop

```text
Observe
  ↓
Plan
  ↓
Create Run
  ↓
Act
  ↓
Verify
  ↓
Success? ─ yes → COMPLETE
  │
  no
  ↓
Replan / wait / request human
```

## Backend

Goals generate ordinary Run Requests. No separate execution framework.

## Safety

Long-running operation requires stricter budgets, time limits, and dangerous-action approvals.

---

# 33. AUTOMATIONS

## Purpose

Start predefined work from time or events.

## Automation model

```text
Automation
├── id
├── name
├── trigger
├── mission_template
├── profile_id
├── host_policy
├── permission_policy
├── schedule/event_filter
├── enabled
└── last_run
```

## Trigger families

- schedule;
- Git branch changes;
- PR events;
- issue events;
- CI failure;
- local file events;
- external webhook/plugin events;
- manual.

## Example

```text
WHEN
Current PR CI fails

DO
Create a Mission to diagnose and prepare a fix

VERIFY
Equivalent local checks pass

ASK BEFORE
Pushing changes
```

## UX

Automation editor uses readable WHEN / DO / USING / VERIFY / APPROVAL sections. Advanced cron/filter syntax is optional.

## Offline reality

If assigned Host is offline, automation status becomes `WAITING_FOR_HOST`. It does not pretend it ran.

## Integration

Automation → Mission template → Run Engine → Context Fabric → Agent → Proof.

---

# 34. DEVELOPMENT BROWSER

## Purpose

Provide a development-focused embedded browser tightly connected to services, agents, verification, and source context.

It is not intended to replace the user's normal browser.

## Human-facing Browser Tab

Capabilities:

- URL/navigation controls;
- localhost/service shortcuts;
- refresh/hard refresh;
- responsive viewport presets;
- console;
- network panel;
- storage/cookies;
- screenshot;
- open externally;
- Element Picker;
- attach page state to Mission/Agent.

## Architecture boundary

Separate two concepts:

1. **Embedded Development Browser** — UI for the human.
2. **Browser Automation Host** — deterministic automation runtime for agents.

The automation runtime should use a controlled Chromium/Playwright-style environment rather than depend completely on platform WebView behavior.

## BrowserSession

```text
BrowserSession
├── id
├── workspace_id
├── host_id
├── worktree_id?
├── service_instance_id?
├── current_url
├── viewport
├── state
├── console_buffer
└── network_buffer
```

## Localhost discovery

Service Manager reports discovered ports. Browser can offer:

> Web service ready on localhost:3000 — Open Preview

## Console/network integration

Errors become structured runtime signals available to Diagnostics and Context Fabric.

## Security

Web content is untrusted. Browser content cannot access privileged Rust commands simply because it is rendered inside Paralith.

## 1.0 acceptance

- localhost preview reliable;
- navigation and responsive presets work;
- console/network capture usable by Context Fabric;
- browser tab failures do not crash main workspace;
- external web content remains isolated from privileged APIs.

---

# 35. AGENT BROWSER AUTOMATION

## Purpose

Allow agents to verify the actual application they build.

## Actions

```text
navigate
click
type
press_key
scroll
select
wait_for
inspect_dom
read_console
read_network
take_screenshot
capture_video (later/optional)
```

## Tool contract

Every action produces structured result and optional Evidence candidate.

Example:

```text
BrowserActionResult
├── action
├── target
├── status
├── url
├── screenshot_ref?
├── console_delta?
├── network_delta?
└── timestamp
```

## Isolation

Automation browser belongs to a Run/Work Unit. Cookies/session state should not casually leak across unrelated Missions.

## Failure behavior

Selectors can become stale. Automation should prefer accessibility/semantic targeting where possible and return inspectable failure evidence.

---

# 36. ELEMENT PICKER — visual-to-source bridge

## Purpose

Let the user identify a UI element visually and give an agent the best possible implementation context.

## Flow

1. User clicks **Pick Element**.
2. Browser enters selection overlay.
3. Hover highlights DOM element.
4. User clicks element.
5. Paralith captures element context.
6. Context Fabric maps it to probable source.
7. User gives instruction.

## Captured data

- DOM path;
- semantic role;
- text;
- attributes;
- bounding box;
- computed styles;
- nearby DOM;
- screenshot crop;
- current route/URL;
- source map/component clues when available.

## Source mapping

Use several signals:

- React/Vue/Svelte dev metadata when available;
- source maps;
- text/class names;
- Project Graph component relationships;
- path/import relationships.

Do not promise perfect source mapping.

## UX

After selection, show a small chip in composer:

`Selected: LoginButton / 142×40 / /login`

The user can say:

> Make this less cramped and match the secondary button style.

## 1.0 acceptance

- selection remains fast;
- captured context inspectable;
- source candidate confidence visible when ambiguous;
- no DOM overlay remains after exiting picker.

---

# 37. VISUAL VERIFICATION

## Purpose

Turn screenshots and UI behavior into structured Evidence.

## Evidence types

- before screenshot;
- after screenshot;
- reference screenshot;
- viewport metadata;
- visual diff;
- interaction path;
- console/network cleanliness.

## UI

Comparison modes:

- side-by-side;
- overlay;
- diff heatmap where useful;
- viewport matrix.

## Caution

Image comparison must account for font rendering, animation, timestamps, and dynamic content. Visual-diff thresholds are project-configurable.

## Proof integration

Acceptance criterion:

> Login page matches existing design system and works at mobile width.

can attach screenshots at desktop/mobile widths plus browser behavior evidence.

---

# 38. ANDROID DEVICE LAB

## Purpose

Make Android testing and emulator setup a native part of the development loop, minimizing manual Android Studio setup where technically possible.

## User experience

Main action:

> **Add Android Device**

Paralith checks system dependencies and automatically completes safe setup steps.

## Setup pipeline

```text
Detect Java
  ↓
Detect/install Android command-line SDK
  ↓
platform-tools / adb
  ↓
emulator package
  ↓
system image
  ↓
create AVD
  ↓
launch emulator
  ↓
register DeviceSession
```

## DeviceSession

```text
DeviceSession
├── id
├── host_id
├── platform (android)
├── device_profile
├── api_level
├── emulator_id
├── adb_serial
├── state
├── work_unit_id?
└── log_stream
```

## Device Tab UI

Main area displays device stream/control. Side tools:

- Logs
- App install
- Screenshot
- Restart
- Rotate
- Deep link
- Permissions
- Inspector later

## Build integration

Run Profiles may define Android build/install flow.

Mission verification can:

1. build APK;
2. start emulator;
3. install APK;
4. launch app;
5. execute interactions;
6. read logcat;
7. capture Evidence.

## Backend services

- `AndroidSdkManager`
- `AvdManager`
- `AdbService`
- `AndroidDeviceService`
- `DeviceStreamService`

## Security

SDK downloads must come from verified sources. Commands generated by agent still pass through permission/policy layer.

## Failure UX

Example:

> Android system image download failed because disk space is below 8 GB.

Actions:

- choose another drive;
- retry;
- view requirement.

Not simply “AVD creation error.”

## 1.x acceptance

- first-run dependency detection automated;
- emulator create/start/stop reliable;
- app install/launch works;
- logcat available to agents and users;
- screenshots become Evidence.

---

# 39. iOS DEVICE LAB

## Purpose

Provide native iOS simulator workflows where Apple tooling exists.

## Platform rule

Local iOS Simulator requires macOS/Xcode. Windows/Linux UI should state this directly.

## macOS integration

- detect Xcode;
- list runtimes;
- create/start simulator;
- install application;
- launch;
- stream logs;
- screenshots;
- agent interaction.

## Remote future

A Windows user may eventually target a macOS Paralith Node and interact with a remote simulator through the same Host/Device abstraction.

---

# 40. DATABASE STUDIO

## Purpose

Give humans and agents enough database visibility to build and debug applications without replacing dedicated DBA tools.

## Initial engines

- SQLite
- PostgreSQL
- MySQL
- Supabase/PostgreSQL workflows

## Connection model

```text
DatabaseConnection
├── id
├── project_id
├── engine
├── environment_label
├── endpoint_metadata
├── credential_ref
├── read_only_default
└── production_flag
```

## UI

Navigation:

```text
Database
├── Tables
├── Views
├── Indexes
├── Functions
└── Saved Queries
```

Table view:

- schema;
- rows;
- filters;
- sorting;
- pagination;
- relationships;
- indexes;
- controlled editing.

## Production safety

Production connections use unmistakable visual treatment and stronger default policy.

Example:

> **PRODUCTION DATABASE — writes require approval**

## Agent behavior

Read schema is commonly allowed. Data reads depend on policy. Mutations default to `ASK` or `DENY`, especially production.

## Query execution

Every mutation operation can generate an audit event. Destructive operations may require preview/transaction.

## Context Fabric

Database schema can be included without necessarily exposing sensitive row data.

## 1.x acceptance

- schema browser fast;
- SQLite local support excellent;
- credentials stored in Vault;
- production visually distinct;
- agent DB writes policy-controlled.

---

# 41. SOURCE CONTROL — local Git as core

## Purpose

Provide excellent local Git workflows contextual to active Project/worktree.

## Main sections

### Changes
Working tree and staging.

### Commit
Commit composer.

### Branches
Branch switching/creation.

### History
Commit list.

### Graph
Branch visualization.

### Worktrees
Parallel work.

## Core operations

- stage/unstage;
- discard;
- commit;
- amend;
- branch;
- stash;
- merge;
- rebase;
- cherry-pick;
- fetch;
- pull;
- push;
- sync.

## Git engine

Use native Git CLI/libgit2 strategy according to operation reliability and repository compatibility. Preserve user Git configuration and hooks unless policy requires isolation.

## AI actions

Optional additions:

- Generate commit message;
- Explain diff;
- Review changes;
- Find risk.

Git remains fully usable without AI.

## Worktree context

Source Control always indicates which worktree/branch the panel refers to.

## Destructive safety

Discard/reset/force push are explicit operations with appropriate confirmations/policies.

## 1.0 acceptance

- no ambiguous active repository/worktree;
- stage/commit/pull/push reliable;
- large diffs remain responsive;
- Git error messages preserve real underlying error plus friendly explanation.

---

# 42. GITHUB / GITLAB / BITBUCKET CONTEXTUAL INTEGRATION

## Purpose

Bring remote collaboration state into the active development workflow without cloning provider websites.

## Provider adapter

```text
SourceProviderAdapter
├── auth
├── repository_info
├── issues
├── pull_requests
├── comments
├── checks
├── create_pr
├── update_pr
├── merge
└── webhooks/events
```

## Current PR tab

When active branch has a PR, show:

- title/body;
- target/base branch;
- review state;
- comments;
- changed files;
- CI/checks;
- mergeability;
- linked issue/task.

## Tasks integration

Issue can become Task/Mission:

> Start with Agent

The resulting Mission retains source reference.

## PR comment workflow

A review comment can become a targeted Task using:

- comment text;
- file/line;
- PR diff;
- Mission context;
- existing worktree.

## Explicit non-goals

No repository social dashboard, stars, releases browser clone, contributors analytics, Wiki, or Insights recreation.

---

# 43. REVIEW CENTER — human review of agent work

## Purpose

Make large AI-generated changes reviewable by intent rather than forcing users to inspect an undifferentiated wall of file diffs.

## Review inputs

- Mission objective;
- Task graph;
- actual Git diff;
- commits;
- Proof Ledger;
- agent explanations;
- impact analysis.

## Intent grouping

Paralith groups changes into logical review sections:

```text
Authentication backend
Database migration
Login interface
Tests
Configuration
```

Grouping is a view, never a replacement for raw diff.

## Review section

Shows:

- purpose;
- files;
- summarized behavior;
- risk;
- linked criteria;
- evidence;
- unresolved warnings.

## Actions

- open raw diff;
- comment;
- ask Agent;
- request change;
- revert selected change when technically safe;
- accept section;
- mark concern.

## AI explanation

Explanation must be grounded in actual diff and Mission intent.

## 1.0 acceptance

- raw diff always accessible;
- generated grouping can be corrected/ignored;
- comments trace to file/hunk/intent section;
- review state persists across restart.

---

# 44. PROOF LEDGER — evidence-driven completion

## Purpose

Replace “the agent claims it works” with auditable evidence mapped to requirements.

## Evidence levels

### E0 — Claim
Only an assertion.

### E1 — Static
A file/diff/configuration exists.

### E2 — Executed
A command/test/build ran successfully.

### E3 — Behavioral
The actual software behavior was exercised.

### E4 — Independent
Separate verifier/CI/environment confirmed behavior.

## Evidence model

```text
Evidence
├── id
├── project_id
├── mission_id?
├── criterion_id?
├── run_id
├── kind
├── level
├── producer
├── status
├── artifact_refs[]
├── command?
├── environment_fingerprint?
├── source_revision
├── created_at
└── metadata
```

## Evidence kinds

- TestResult
- BuildResult
- LintResult
- TypecheckResult
- BrowserInteraction
- Screenshot
- Video
- ApiCheck
- DeviceInteraction
- CIResult
- SecurityFinding
- HumanApproval

## Proof Ledger model

```text
ProofLedger
├── mission_id
├── criterion_proofs[]
├── unresolved_risks[]
├── final_status
└── verified_revision
```

## Criterion mapping

Example:

```text
AC-03: Existing password login still works
Required: E3

Evidence:
✓ browser_run_239
  /login → password login → dashboard
  console errors: 0
  screenshot: sha256:...
```

## Staleness of proof

Evidence is tied to source revision/environment. If code changes after verification, relevant proof may become `STALE` and require rerun.

## UI

Mission Proof tab:

```text
6/6 acceptance criteria verified

✓ Google OAuth             E3
✓ GitHub OAuth             E3
✓ Password login           E3
✓ Account linking          E3
✓ Secret handling          E4
✓ Test suite               E2

Risks
No open high-risk findings.
```

## Completion gate

Mission status transition to `COMPLETED` validates Proof policy.

## 1.0 acceptance

- criteria explicitly map to Evidence;
- proof becomes stale after relevant source changes;
- artifacts open from UI;
- claims without evidence never render as verified.

---

# 45. VERIFICATION ORCHESTRATOR

## Purpose

Select and execute appropriate verification methods after implementation.

## Inputs

- Mission criteria;
- changed files/entities;
- project test configuration;
- Impact Intelligence;
- available services/devices;
- verification policy.

## Verification plan

Example:

```text
1. pnpm typecheck
2. pnpm test auth
3. start Web service
4. browser password-login flow
5. browser OAuth UI flow
6. independent security review
```

## Backend

`VerificationCoordinator` creates verification Runs or direct tool jobs. Results become Evidence.

## Retry behavior

Failure is not silently retried indefinitely. Builder may receive failure context and execute a repair Run.

---

# 46. QA MODE

## Purpose

Provide independent validation of a completed or in-progress feature.

## User action

> Verify Feature

or automatic Mission stage.

## QA input

- acceptance criteria;
- diff;
- Impact report;
- runtime environment;
- existing tests;
- previous Evidence.

## QA methods

- unit/integration/E2E tests;
- browser behavior;
- responsive checks;
- accessibility checks;
- device tests;
- API checks;
- edge-case exploration;
- regression checks.

## Independent context principle

QA should not simply inherit the builder's exact reasoning transcript. It receives task specification and observable implementation context so it can challenge assumptions.

## Output

- Evidence;
- defects;
- unresolved risks;
- recommended new Tasks.

---

# 47. SECURITY REVIEW

## Purpose

Run an explicit security-oriented review of relevant changes and architecture.

## Focus areas

- secret exposure;
- authentication;
- authorization;
- insecure direct object access;
- input validation;
- SQL/command injection;
- XSS;
- SSRF;
- unsafe filesystem access;
- insecure deserialization;
- dependency risk;
- CI/release permissions;
- dangerous network access;
- credential handling.

## UX

Security findings have severity and evidence:

```text
HIGH
OAuth callback does not validate state parameter.

Location: auth/oauth.ts:84
Evidence: code path + test gap
[Open] [Create Fix Task]
```

## Product honesty

Paralith must say which checks were performed, not claim “your application is secure.”

---

# 48. DIAGNOSTICS

## Purpose

Automatically assemble debugging context when something fails.

## Diagnostic bundle can include

- exception;
- stack trace;
- relevant source;
- recent diff;
- terminal output;
- browser console;
- network failure;
- related Memory;
- Git history;
- environment details.

## UX

Error surfaces expose **Diagnose**.

Example:

> Web service exited because port 3000 is already in use.

Actions:

- Diagnose;
- restart on another port;
- inspect process;
- view logs.

## Backend

Diagnostics creates a Context Request with failure-specific seeds and launches either a diagnostic Run or deterministic analysis first.

---

# 49. TASKS — unified work queue

## Purpose

Provide one actionable backlog across internal and external sources.

## Sources

- manual;
- Mission-generated;
- GitHub/GitLab issue;
- Linear/Jira;
- Automation;
- QA/security findings;
- PR comments.

## Task card

```text
AUTH-128
Fix refresh-token race
Source: GitHub #84
Priority: High
Status: Ready

[Start Mission] [Start Agent]
```

## Data model

External reference is attached without making external provider the source of all local execution state.

## Actions

- assign to Mission;
- run directly;
- snooze;
- link issue;
- close/sync status where permission exists.

---

# 50. CONNECTIONS — integration control plane

## Purpose

Centralize external service authorization and scope.

## Categories

- source control;
- project management;
- deployment;
- data;
- observability;
- MCP;
- future collaboration providers.

## Connection model

```text
Connection
├── id
├── provider
├── account_identity
├── scopes[]
├── credential_ref
├── status
├── last_verified_at
├── project_bindings[]
└── policy
```

## UI

Each connection shows:

- account;
- granted permissions;
- affected Projects;
- last verification;
- reconnect;
- revoke.

## Security

Credentials live in secure Vault. Database stores references and non-secret metadata only.

---

# 51. MCP GATEWAY

## Purpose

Allow multiple agent providers to use approved external tools through one controlled integration layer.

## Architecture

```text
Claude ─┐
Codex ──┼── Paralith MCP Gateway ── GitHub
Other ──┘                         ├─ Linear
                                  ├─ Sentry
                                  └─ custom MCP
```

## Components

- MCP server registry;
- transport adapters;
- protocol version adapter;
- authorization adapter;
- tool catalog;
- policy filter;
- audit events;
- credential broker.

## Tool invocation

Every agent tool call has:

```text
provider
run_id
tool
arguments summary
permission decision
result status
timestamp
```

Sensitive argument values may be redacted from UI/logs.

## Security

An MCP server is not automatically trusted because it connected successfully. Tools receive scopes and may be `ALLOW`, `ASK`, or `DENY`.

---

# 52. SKILLS

## Purpose

Represent reusable procedural knowledge that can be applied by different agent engines.

## Skill model

```text
Skill
├── id
├── name
├── description
├── version
├── instructions
├── required_tools[]
├── compatible_profiles[]
├── permissions
├── inputs_schema?
├── verification_rules?
└── scope
```

## Examples

- Tauri Release
- React UI Review
- Database Migration
- Security Audit
- Create Pull Request
- Write Regression Tests

## Versioning

Runs record the exact skill version used.

## UX

Skills page shows:

- installed;
- project-specific;
- updates;
- permissions;
- usage history.

## Project Skills

A repository may define its own skill instructions, but repository-provided skill content remains untrusted until policy permits its actions.

---

# 53. PLUGIN PLATFORM

## Purpose

Extend Paralith without bloating core or granting arbitrary native access.

## Plugin categories

- Integration Plugin
- UI Extension
- Skill Pack
- MCP Integration

## Manifest

```text
PluginManifest
├── id
├── publisher
├── version
├── capabilities[]
├── permissions[]
├── commands[]
├── views[]
├── connections[]
└── signature
```

## Security model

Avoid unrestricted native DLL/plugin execution. Prefer capability-scoped APIs and sandboxable runtimes such as WASM/WASI where technically appropriate.

## UI extension rules

Plugins should use design-system primitives rather than arbitrary HTML/CSS that destroys consistency.

## Delivery timing

Plugin platform is not a 1.0 blocker. Build only after core lifecycle is stable.

---

# 54. HOST ABSTRACTION — local and remote execution foundation

## Purpose

Make Local, WSL, SSH, Paralith Node, and future managed workers implement the same execution concepts.

## Host interface

```text
Host
├── identity
├── capabilities
├── filesystem
├── git
├── pty
├── processes
├── agents
├── environment
├── browser
└── devices
```

## HostCapabilities

Examples:

```text
filesystem_write
pty
container_runtime
gpu
android_emulator
ios_simulator
browser_automation
docker
agent_claude
agent_codex
```

## Local Host

Default implementation using native Rust/platform services.

## Routing rule

Project resources always carry Host identity. Avoid hidden assumptions that every path is a Windows local path.

## UX

Host is shown in status when non-local or when relevant:

`Host: This PC`

`Host: WSL Ubuntu`

`Host: Build Server`

## 1.0 architecture requirement

Even if SSH/Node ships later, 1.0 internal interfaces must avoid hardcoding local-only assumptions that force a rewrite.

---

# 55. WSL HOST

## Purpose

Treat WSL as a real Linux execution Host for Windows users.

## Behavior

- Project may live inside WSL filesystem;
- Git runs inside WSL;
- language servers can run inside WSL;
- terminals are native Linux shell sessions;
- Agent CLI may execute inside WSL;
- paths remain Linux-native internally for Host operations.

## Avoid

Do not repeatedly convert everything through mounted `C:` paths when the repository is naturally Linux-hosted.

## UX

Opening `~/projects/app` from WSL should feel equivalent to opening a local Project with clear Host badge.

---

# 56. SSH REMOTE DEVELOPMENT

## Purpose

Provide a complete remote Project environment, not merely SSH terminal + SFTP.

## Architecture

```text
Paralith Desktop
      ↓ secure transport
Remote Host Service / bootstrap
      ├── filesystem
      ├── watcher
      ├── git
      ├── PTY
      ├── processes
      ├── language services
      └── agent runtime
```

## Connection states

```text
DISCONNECTED
CONNECTING
AUTHENTICATING
READY
DEGRADED
RECONNECTING
FAILED
```

## Offline/reconnect

Editor should distinguish:

- cached view;
- unsynced user changes;
- confirmed remote state.

Do not pretend remote writes succeeded during disconnection.

## Security

SSH keys remain in secure OS-managed locations/agents where possible. Host-key verification must be explicit.

---

# 57. PARALITH NODE — self-hosted worker

## Purpose

Turn another machine into a controlled execution Host for agents, builds, browsers, or devices.

## Node components

```text
Paralith Node Service
├── secure enrollment
├── host capability discovery
├── repository workspace manager
├── worktree/sandbox manager
├── terminal/agent host
├── browser automation
├── environment cache
└── telemetry/health
```

## Enrollment

Desktop generates time-limited pairing request. Node and desktop establish mutually authenticated channel. Long-lived credentials stored securely.

## Node UX

Connections > Nodes:

```text
RTX Workstation
Online
Windows 11
GPU: available
Claude: available
Codex: available
Android: available

Running jobs: 3
```

## Execution

Run Engine can choose Node based on policy/capabilities.

Example:

> Run QA on RTX Workstation.

## Isolation

Node eventually supports stronger managed execution through containers/VMs where platform permits.

## Multi-user future

Team Nodes require quotas, project authorization, user isolation, and audit trails.

---

# 58. MOBILE COMPANION

## Purpose

Provide supervision and approval, not a miniature desktop IDE.

## Core screens

### Home
- running Agents;
- approvals;
- Missions;
- important notifications.

### Mission
- criteria;
- tasks;
- progress;
- proof.

### Agent
- normalized transcript;
- steer;
- stop;
- approve.

### Review
- concise diff/review information;
- open external web review when full desktop inspection is needed.

## Backend requirement

Mobile control requires a reachable sync/control service or user-owned Node. This is not required for local-only 1.0.

## Security

High-risk approvals may require re-authentication/biometric confirmation depending on platform.

---

# 59. VOICE INPUT

## Purpose

Make voice an input method for Missions, agent messages, search, and commands.

## UX

Hold configurable key → speak → release → transcription appears in current composer.

User can edit before sending by default.

## Architecture

`VoiceInputService` abstracts local transcription engine and optional future providers.

## Privacy

Local transcription preferred when available. UI identifies when audio would leave device.

## Non-goal

No giant assistant avatar or unrelated ambient voice personality in core Paralith.

---

# 60. USAGE INTELLIGENCE

## Purpose

Show what development activity consumes without inventing provider data.

## Sources

- adapter-reported usage;
- session duration;
- Run duration;
- model/provider metadata;
- tool execution counts;
- available provider quota/reset data.

## UsageRecord

```text
UsageRecord
├── provider
├── project_id?
├── mission_id?
├── run_id?
├── metric
├── value
├── unit
├── source
├── confidence
└── timestamp
```

## UI views

- Today
- Week
- Provider
- Project
- Mission

Example:

```text
OAuth Mission
Claude Code      46m
Codex             21m
QA                12m
4 agent sessions
3 worktrees
127 tests
```

## Honesty rule

If provider does not expose exact quota, display “Unavailable from provider.” Do not fabricate remaining percentage.

---

# 61. NOTIFICATIONS

## Purpose

Interrupt only when a human should know or act.

## Priority classes

- Critical
- Action Required
- Completion
- Informational

## Good notification examples

- Mission ready for review.
- Agent requests database migration approval.
- CI failed after PR update.
- Android build failed.
- Remote Node disconnected while Run active.

## Noise suppression

Repeated identical errors collapse into one item with count.

## Routing

Notifications may appear:

- in-app;
- OS notification;
- future mobile push.

Project/user settings control routing.

---

# 62. SHIP CENTER

## Purpose

Understand and orchestrate the Project's existing release path.

## Detection

Identify:

- GitHub Actions;
- GitLab CI;
- Tauri updater configuration;
- Vercel;
- Cloudflare;
- custom scripts;
- tags/releases;
- package publishing.

## Release Plan

```text
ReleasePlan
├── version
├── source_ref
├── prechecks[]
├── build_jobs[]
├── artifact_requirements[]
├── publish_steps[]
├── deployment_steps[]
└── verification_steps[]
```

## UI

```text
Release 1.8.0

Source                clean
Tests                 ✓
Typecheck             ✓
Windows build         ✓
Updater signature     ✓
PR                    approved
CI                    ✓
Artifacts             4

[Publish Release]
```

## Product rule

Paralith follows established repository release systems rather than inventing a new deployment platform.

## Proof integration

Release checks create Evidence and remain attached to Release history.

---

# 63. PARALITH SELF-UPDATE SYSTEM

## Purpose

Deliver Corelith updates safely to installed users.

## Channels

- Stable
- Beta
- Internal/nightly later

## Requirements

- signed artifacts;
- signed/validated metadata;
- background download where appropriate;
- explicit restart/install;
- release notes;
- rollback protection;
- recovery when update fails.

## UX

Status:

> Paralith 1.4.2 available — 84 MB

Actions:

- View changes
- Update now
- Install on exit
- Skip this version when policy allows

## Failure

A failed update must leave last known good version recoverable.

---

# 64. SECURITY MODEL — trust boundaries

## Purpose

Prevent a powerful ADE from becoming a universal local privilege bridge.

## Trust zones

### Trusted
- Rust Core;
- Credential Vault;
- Policy Engine;
- signed updater.

### Limited trust
- Paralith frontend;
- controlled first-party helper processes;
- agent child processes.

### Untrusted
- repository content;
- browser pages;
- agent output;
- plugin content;
- MCP tool output;
- external issue/PR text.

## IPC principle

Frontend calls narrow typed operations.

Good:

```text
create_worktree(project_id, base_ref)
start_agent(run_id)
read_project_file(project_id, path)
```

Bad:

```text
execute_any_shell_command(text)
read_any_file(path)
```

where no policy or scope exists.

## WebView boundary

Browser/web content never receives the same bridge as trusted Paralith UI.

## Content injection

Repository files and external text may contain adversarial instructions. Context Fabric labels them as data. System/user policy remains higher priority.

---

# 65. POLICY ENGINE

## Purpose

Decide whether a requested action is allowed, requires approval, or is denied.

## Capability domains

- filesystem;
- processes;
- network;
- secrets;
- Git;
- databases;
- deployment;
- external tools;
- remote hosts.

## Decision

```text
ALLOW
ASK
DENY
```

## Example policy

```text
Read Project files          ALLOW
Modify assigned worktree    ALLOW
Install dependency          ASK
Push branch                 ASK
Force push                  DENY
Read SSH private key        DENY
Write production database   DENY
Deploy production           ASK
```

## Rule precedence

```text
System hard safety
     ↓
Organization
     ↓
Project
     ↓
Profile
     ↓
Mission
```

Child rules may become stricter but cannot bypass immutable system safety rules.

## Approval model

```text
ApprovalRequest
├── id
├── run_id
├── capability
├── action_summary
├── risk
├── exact_target
├── requested_scope
├── expires_at?
└── status
```

Approval choices may include:

- allow once;
- allow for this Run;
- allow for this Project where safe;
- reject.

---

# 66. NATIVE MODE VS MANAGED ISOLATION

## Native Mode

Agent CLI runs under the user's OS account for maximum compatibility.

Paralith can control:

- worktree;
- provided environment;
- credentials;
- Run context;
- tool gateway;

but cannot honestly guarantee that a fully capable external CLI cannot access everything available to that OS user.

## Managed Isolation Mode

For stronger enforcement, execute inside:

- container;
- VM;
- restricted Node worker;
- sandbox.

Then filesystem/network/secrets can be enforced more strongly.

## UX

Run header indicates security mode:

`Native` or `Isolated`.

No misleading “sandboxed” badge when process is merely in a Git worktree.

---

# 67. CREDENTIAL VAULT

## Purpose

Keep secrets outside ordinary app databases, logs, prompts, and project files.

## Storage

Use OS-backed secure credential facilities where possible.

Database stores:

```text
credential_ref
provider
account metadata
scope metadata
```

not plaintext token.

## Secret access

A service requests credential through Vault with capability context. Policy Engine evaluates use.

## Logging

Secret-like values are redacted from logs and diagnostic bundles.

## Rotation/revocation

Connections can detect invalid credential and request re-auth without losing unrelated configuration.

---

# 68. CHECKPOINTS AND RECOVERY

## Purpose

Make dangerous autonomous work reversible.

## Checkpoint types

- Git ref/commit;
- stash;
- worktree state;
- database transaction/snapshot when configured;
- configuration backup.

## Automatic checkpoints

Possible before:

- broad refactor on current branch;
- destructive migration;
- dependency mass update;
- release/version operation.

## Restore UX

Explain exact consequences:

> Restore checkpoint from before migration? This will reset 12 files in the OAuth worktree. Untracked files will be preserved.

Never use vague “undo everything.”

---

# 69. APP DATA ARCHITECTURE

## Global SQLite database

Stores:

- Project registry;
- Hosts;
- global settings;
- Agent Profiles;
- Connections metadata;
- global Skills;
- plugins;
- notifications;
- recent Workspaces.

## Project-domain storage

Stores:

- Missions;
- criteria;
- Tasks;
- Runs;
- sessions/events;
- worktrees;
- Context metadata;
- Memory;
- Project Graph;
- Evidence;
- activity.

Physical implementation may use one application database with project-scoped tables initially or separate project databases. The logical boundaries must remain explicit.

## SQLite configuration

- WAL mode;
- migrations;
- foreign keys;
- indexed query paths;
- background transactions;
- integrity checks.

## Blob Store

Large artifacts live outside relational rows.

Examples:

- screenshots;
- video;
- huge command logs;
- generated reports.

Content-addressed layout:

```text
blobs/<sha256-prefix>/<sha256>
```

Metadata row records MIME type, size, producer, retention, and hash.

---

# 70. CORE DATABASE ENTITY MAP

The initial durable schema should contain equivalent entities to:

```text
projects
repositories
hosts
workspaces
windows
panes
tabs

missions
mission_revisions
mission_criteria
tasks
task_dependencies

runs
agent_profiles
agent_sessions
agent_events

work_units
worktrees
environment_profiles
service_instances

context_requests
context_packs
context_items

project_nodes
project_edges

memory_nodes
memory_revisions
memory_edges
memory_sources

proof_ledgers
evidence
evidence_artifacts

approvals
policies

connections
skills
plugins

automations
automation_runs
goals

notifications
usage_records
activities
releases
```

## Schema rule

Important searchable/filterable properties should not all be buried in arbitrary JSON. JSON metadata is for extensibility, not as an excuse to skip schema design.

---

# 71. STABLE IDENTIFIERS

Every durable entity receives a stable generated ID.

Do not use display title, filename, branch name, or array position as identity.

Examples:

```text
project_id
mission_id
task_id
run_id
session_id
evidence_id
memory_id
```

File/symbol entities use stable keys plus reconciliation when moved/renamed.

---

# 72. INTERNAL EVENT BUS

## Purpose

Decouple domain reactions without scattering frontend event hacks across the application.

## Example flow

```text
FileChanged
  ├─ Explorer refresh
  ├─ Git status refresh
  ├─ Project Graph incremental index
  ├─ Impact analysis
  └─ Memory staleness evaluation
```

## Event requirements

Events are:

- typed;
- versionable;
- timestamped;
- correlated;
- safe to replay only when explicitly designed for replay.

Commands mutate state. Events describe what happened.

---

# 73. FILE WATCH SERVICE

## Purpose

One canonical source for filesystem change observation.

## Pipeline

```text
OS watcher
  ↓
normalize path
  ↓
debounce/coalesce
  ↓
ignore rules
  ↓
classify internal/external change
  ↓
batch
  ↓
FileChanged events
```

## Ignore defaults

- `.git` internals where not needed;
- dependency directories;
- generated build directories;
- application metadata;
- lockfile churn according to subsystem needs.

Different consumers may request additional scopes, but they share watcher infrastructure.

---

# 74. ENVIRONMENT MANAGER

## Purpose

Understand what is required to run a Project and make agent execution reproducible.

## EnvironmentProfile

```text
EnvironmentProfile
├── id
├── host_id
├── project_id
├── runtimes[]
├── required_tools[]
├── install_steps[]
├── environment_variables[]
├── service_profiles[]
├── verification_commands[]
├── fingerprint
└── state
```

## States

```text
UNKNOWN
PREPARING
READY
DEGRADED
BROKEN
```

## Fingerprint

May include:

- lockfile hashes;
- runtime versions;
- dependency manifests;
- setup configuration.

## Cache

Reusable remote/isolated environments should avoid repeated expensive setup when fingerprint matches.

## UI

Project Environment view explains detected runtimes, missing requirements, and repair actions.

---

# 75. OBSERVABILITY AND DIAGNOSTIC LOGGING

## Purpose

Make Paralith debuggable as a complex multi-process system.

## Structured log fields

```text
timestamp
severity
subsystem
operation
correlation_id
project_id?
run_id?
host_id?
duration_ms?
error_code?
```

## Diagnostic bundle

User can export sanitized bundle containing:

- app version;
- OS/hardware summary;
- recent relevant logs;
- subsystem health;
- crash metadata;
- active feature configuration.

Redact:

- tokens;
- secret env variables;
- SSH keys;
- raw source unless user explicitly includes it.

---

# 76. CRASH RECOVERY

## Purpose

Restore trustworthy state after renderer/core/process failure.

## Recovery journal

Persist enough information to know:

- active Workspaces;
- active Runs;
- running child-process identities;
- worktrees;
- incomplete critical transactions.

## Startup reconciliation

On launch:

1. load durable state;
2. check process existence;
3. reconcile terminal/agent sessions;
4. mark interrupted operations;
5. resume safe background jobs;
6. show recovery notice only if user action is needed.

## UX

```text
Previous session ended unexpectedly.

Recovered
✓ Workspace layout
✓ OAuth Mission
✓ Worktree changes

Needs attention
Agent process no longer exists. [Resume]
```

---

# 77. PERFORMANCE ARCHITECTURE

## Principles

- opening files outranks indexing;
- typing outranks background graph work;
- UI renders incrementally;
- large lists virtualized;
- expensive computation off renderer thread;
- semantic indexing cancellable/throttled;
- logs streamed and bounded.

## Engineering targets

Targets are internal goals, not guaranteed marketing claims.

### Cold usable shell
p50 under ~1.5 seconds on supported modern hardware; p95 under ~3 seconds.

### Command palette local results
Target under ~50 ms.

### Literal search first streamed results
Target under ~150 ms for normal Projects.

### Interaction
Maintain smooth 60 FPS-class UI behavior under ordinary workload.

### Editor
Background indexing must not visibly degrade typing.

## Resource Manager

Track:

- child processes;
- CPU;
- memory;
- language servers;
- browsers;
- agents;
- emulators;
- remote jobs.

Inactive Workspaces may reduce optional background work without killing important Runs.

---

# 78. UX DESIGN SYSTEM

## Product feel

Professional engineering instrument, not neon AI dashboard.

## Principles

- hierarchy over decoration;
- compact but breathable;
- consistent density;
- strong typography;
- minimal unnecessary borders;
- motion communicates state;
- color communicates meaning;
- dark and light modes are both designed intentionally.

## Avoid

- excessive glassmorphism;
- purple-blue neon gradients everywhere;
- nested rounded cards;
- giant empty hero areas inside productivity views;
- graph visualizations where lists are more useful;
- animation that slows routine work.

## Layout tokens

Centralize:

- spacing scale;
- typography scale;
- radii;
- borders;
- shadows;
- elevation;
- motion duration/easing;
- semantic colors.

## Semantic status language

Recommended conceptual colors:

```text
Neutral  → idle/inactive
Blue     → active/in progress
Green    → successful/verified
Yellow   → warning/action required
Red      → failed/danger
```

Do not overload colors with multiple conflicting meanings.

---

# 79. AGENT STATUS UX

Canonical visible states:

```text
Idle
Thinking
Working
Waiting
Blocked
Verifying
Review Ready
Failed
Completed
```

## Rules

- “Thinking” and “Working” should not produce distracting constant animation;
- Blocked/Approval should be more visually prominent than token streaming;
- Completed should distinguish `Completed with proof` from `Agent stopped successfully` where needed.

---

# 80. ONBOARDING

## First launch

### Step 1 — Welcome
One sentence explaining intent-to-verified-software.

### Step 2 — Detect engines

```text
Claude Code       Detected
Codex             Detected
OpenCode          Not installed
```

Provide setup guidance only when requested.

### Step 3 — Open Project

### Step 4 — Background discovery

### Step 5 — Ready

Suggested primary action:

> Create your first Mission

## Rule

No 15-screen forced tour.

---

# 81. EMPTY STATES

Every empty state should explain the concept and next action.

Example:

Bad:

> No proof.

Better:

> Proof Ledger connects Mission acceptance criteria to tests, builds, browser checks, and other evidence.

`[Run verification]`

---

# 82. ERROR UX

Every user-visible error should answer:

1. What happened?
2. What was affected?
3. Is work safe?
4. What can the user do?
5. Can Paralith diagnose/retry it?

Example:

```text
The Web service stopped.

Cause
Port 3000 is already being used by process 18204.

Your files are safe.

[Restart on another port] [Inspect process] [View logs]
```

Avoid raw error codes without human context, while keeping technical details expandable.

---

# 83. ACCESSIBILITY

Required across the product:

- complete keyboard navigation;
- visible focus states;
- screen-reader labels;
- semantic roles;
- contrast compliance;
- reduced-motion support;
- zoom/scaling;
- configurable editor/terminal font sizes;
- no state communicated only by color.

Complex graphs must have list/table alternatives.

---

# 84. KEYBOARD SYSTEM

## Principles

Power users should control routine actions without mouse.

## Keybinding registry

Commands own semantic IDs; user mappings are separate.

Examples:

- command palette;
- quick open;
- new terminal;
- focus explorer;
- focus agent;
- toggle right sidebar;
- next/previous pane;
- review changes;
- create Mission.

Conflicts detected in Settings.

---

# 85. SETTINGS ARCHITECTURE

## Scopes

```text
Default
  ↓
User
  ↓
Project
  ↓
Workspace
```

Not every setting supports every scope.

## Major settings groups

- Appearance
- Editor
- Terminal
- Agents
- Missions
- Context
- Memory
- Git
- Browser
- Devices
- Hosts
- Connections
- Security
- Notifications
- Usage/Privacy
- Updates

## Storage

Typed settings schema with migrations. Avoid uncontrolled string-key dictionaries scattered through frontend.

---

# 86. PRIVACY

## Default principle

Project code remains on the selected Host except when a user-selected agent/provider necessarily receives context.

## Transparency

For each Agent Run, Context Inspector shows what data was prepared for that agent.

## Telemetry

Product analytics must never silently upload source code, secret values, terminal contents, or agent conversations as generic telemetry.

## Crash reporting

Sanitize aggressively. User can inspect diagnostic bundle before manual upload where practical.

---

# 87. SYNC — future, not 1.0 dependency

## Potential synced entities

- preferences;
- Agent Profiles;
- Skills;
- selected Memory;
- Missions;
- lightweight Workspace metadata;
- organization policy.

## Rule

Git remains source-code synchronization mechanism. Paralith does not invent a second repository sync protocol.

---

# 88. TEAM MODE

## Organization model

```text
Organization
├── members
├── roles
├── projects
├── policies
├── skills
├── profiles
├── connections
└── knowledge
```

## Roles

- Owner
- Admin
- Developer
- Reviewer
- Viewer

## Shared capabilities

- shared Missions;
- shared Memory;
- shared Skills;
- organization Agent Profiles;
- policy-controlled Connections;
- Node fleet;
- audit trail.

## Collaboration rule

Do not turn Paralith into chat. Comments/review discussion exist only where they support engineering work.

---

# 89. ENTERPRISE ROADMAP

Future enterprise capabilities:

- SSO;
- SCIM;
- managed policy;
- audit export;
- data retention;
- network restrictions;
- private Nodes;
- private plugin/Skill registry;
- custom update channels;
- deployment controls;
- organization credential management.

Do not allow enterprise complexity to pollute the solo developer 1.0 experience.

---

# 90. CROSS-FEATURE SYSTEM FLOWS

## 90.1 Build a feature

```text
User Intent
  ↓
Mission Control
  ↓
Mission Preflight
  ↓
Task Graph
  ↓
Run Engine
  ↓
Worktree Engine + Host
  ↓
Context Fabric
  ↓
Agent Runtime
  ↓
File Changes / Services
  ↓
Browser / Device / Tests
  ↓
Evidence
  ↓
Proof Ledger
  ↓
Review Center
  ↓
Git Provider / PR
  ↓
Ship Center
  ↓
Memory + Project Graph update
```

## 90.2 Fix CI

```text
GitHub check failure
  ↓
Provider event
  ↓
Task/Automation
  ↓
Diagnostic Context Request
  ↓
Run Engine
  ↓
Agent fix in existing PR worktree
  ↓
Targeted verification
  ↓
Approval to push
  ↓
CI observed again
  ↓
E4 Evidence
```

## 90.3 UI refinement

```text
Browser Element Picker
  ↓
DOM + screenshot + source candidates
  ↓
Context Fabric
  ↓
Frontend Agent Run
  ↓
Dev Service reload
  ↓
Visual/browser verification
  ↓
Screenshot Evidence
  ↓
Review
```

## 90.4 Memory staleness

```text
FileChanged
  ↓
Project Graph update
  ↓
Impact Report
  ↓
Memory source relationship lookup
  ↓
Staleness policy
  ↓
AT_RISK / STALE
  ↓
Future Context Pack excludes or labels stale knowledge
```

## 90.5 Remote swarm

```text
Mission
  ↓
Task Scheduler
  ↓
Host Resolver
  ├─ Local Builder
  ├─ Paralith Node Backend Worker
  └─ Paralith Node QA
  ↓
Unified Run Events
  ↓
Integration worktree
  ↓
Proof Ledger
```

---

# 91. THE SIX-GRAPH MODEL

Paralith's long-term architecture can be understood as six connected graphs.

## 91.1 Project Graph — what exists

```text
Files → Symbols → Components → Services → Dependencies
```

## 91.2 Knowledge Graph — what is known

```text
Architecture → Decisions → Conventions → Incidents
```

## 91.3 Mission Graph — what should happen

```text
Objective → Tasks → Dependencies → Acceptance Criteria
```

## 91.4 Execution Graph — what is happening

```text
Runs → Agents → Hosts → Worktrees → Tools
```

## 91.5 Evidence Graph — what is proven

```text
Criteria → Tests → Browser Runs → Screenshots → CI
```

## 91.6 Delivery Graph — what shipped

```text
Changes → Commits → PRs → Releases → Deployments
```

## Cross-links create the moat

Example:

```text
OAuth Mission
   ↓ implemented-by
Backend Run
   ↓ modified
AuthService
   ↓ verified-by
Browser Run
   ↓ evidence-for
AC-03
   ↓ shipped-in
PR #281
   ↓ changed
Authentication Memory
```

The value is not any single graph. The value is the relationship system.

---

# 92. FRONTEND ENGINEERING ORGANIZATION

Recommended feature-oriented structure:

```text
src/
├── app/
├── design-system/
├── shared/
└── features/
    ├── home/
    ├── projects/
    ├── workspace/
    ├── explorer/
    ├── editor/
    ├── search/
    ├── terminal/
    ├── agents/
    ├── missions/
    ├── tasks/
    ├── context/
    ├── memory/
    ├── project-map/
    ├── source-control/
    ├── review/
    ├── proof/
    ├── browser/
    ├── devices/
    ├── database/
    ├── automations/
    ├── connections/
    ├── usage/
    └── settings/
```

## Rule

UI feature folders should consume typed domain clients. They should not directly know SQLite schemas or shell process details.

---

# 93. RUST BACKEND ORGANIZATION

Recommended domain boundaries:

```text
src-tauri/src/
├── app/
├── ipc/
├── storage/
├── events/
├── policy/
├── project/
├── workspace/
├── host/
├── filesystem/
├── git/
├── terminal/
├── environment/
├── agents/
├── missions/
├── tasks/
├── runs/
├── context/
├── graph/
├── memory/
├── proof/
├── browser/
├── devices/
├── database/
├── automation/
├── connections/
├── skills/
├── usage/
├── release/
└── updater/
```

Avoid a giant command file containing unrelated business logic.

---

# 94. IPC / API CONTRACT DESIGN

## Principle

IPC defines capabilities, not generic escape hatches.

### Good

```text
project.open(path)
mission.create(input)
mission.start(id)
agent.steer(session_id, message)
git.stage(worktree_id, paths)
proof.run_verification(mission_id)
```

### Dangerous

```text
system.execute(command_string)
system.read_file(any_path)
sql.execute(any_database, raw_sql)
```

Generic low-level operations, when necessary internally, remain behind trusted backend domain services and policy.

## Versioning

Payload schemas should be serializable, typed, and migration-friendly. UI/backend version mismatch should fail clearly during development.

---

# 95. BACKGROUND JOB SYSTEM

## Purpose

Run indexing, Memory evaluation, artifact processing, cleanup, and other durable background work without hiding it inside ad-hoc async tasks.

## Job model

```text
Job
├── id
├── kind
├── project_id?
├── payload
├── priority
├── state
├── attempts
├── scheduled_at
├── started_at
└── last_error
```

## States

```text
QUEUED
RUNNING
SUCCEEDED
FAILED
RETRY_WAIT
CANCELLED
```

## Uses

- Project Graph indexing;
- Memory impact/staleness;
- screenshot processing;
- blob cleanup;
- semantic index updates;
- provider sync;
- release polling.

## Reliability

Jobs requiring durability are persisted. Pure UI prefetch tasks do not need durable jobs.

---

# 96. TESTING STRATEGY FOR PARALITH ITSELF

A product orchestrating agents and Git must have unusually strong test discipline.

## Unit tests

Critical pure logic:

- Mission state transitions;
- Task DAG readiness;
- policy resolution;
- evidence gating;
- staleness policy;
- context ranking helpers;
- worktree naming/path logic.

## Integration tests

- SQLite migrations;
- Git operations in temporary repositories;
- PTY lifecycle;
- agent adapter parsing;
- worktree creation/cleanup;
- Run Engine recovery;
- event journal.

## Contract tests

Each Agent Adapter runs against fixtures and, in controlled CI where possible, real provider CLI smoke tests.

## E2E desktop tests

Critical user flows:

- open Project;
- edit/save;
- terminal;
- create Mission;
- start Agent;
- review diff;
- restore Workspace;
- updater path.

## Failure injection

Test:

- agent process killed;
- Tauri renderer crash;
- network disconnect;
- Git conflict;
- disk full;
- remote Host disconnect;
- corrupt provider output;
- database lock/recovery;
- missing SDK.

## Golden repositories

Maintain representative fixture repos:

- React/Node;
- Tauri/Rust;
- Python;
- monorepo;
- Android/Flutter later.

Used for discovery, graph, Context Fabric, and Mission tests.

---

# 97. SECURITY TESTING OF PARALITH

Required test classes:

- IPC capability bypass attempts;
- path traversal;
- symlink escape;
- malicious repository prompt injection;
- credential redaction;
- browser-to-core boundary;
- plugin/MCP permission enforcement;
- updater signature failure;
- SSH host-key behavior;
- production database policy;
- destructive Git operation approvals.

Security-sensitive functionality should have explicit threat-model notes in code/design docs.

---

# 98. DATA MIGRATION STRATEGY

Every database schema change ships as ordered migration.

Requirements:

- transactional when possible;
- forward migration tested from supported older versions;
- backup/checkpoint before risky migration;
- migration version recorded;
- failure leaves clear recovery path.

Do not edit production user database schema ad hoc on startup without migration records.

---

# 99. FEATURE FLAGS

Use feature flags for:

- incomplete beta systems;
- staged rollout;
- provider experiments;
- risky new execution behavior.

Flags are not permanent architecture. Remove obsolete flags.

Security policy must never depend on a client-visible flag alone.

---

# 100. RELEASE CHANNEL QUALITY

## Internal
Can contain incomplete features behind flags.

## Beta
Features should preserve user data and have known limitations documented.

## Stable
Must meet reliability and migration bar.

A feature that exists visually but is unsafe/recovery-incomplete is not Stable-ready.

---

# 101. PARALITH 1.0 SCOPE

The first commercial core should include the complete smallest version of the differentiating loop.

## Workspace

- Projects
- Explorer
- Editor
- Search
- Terminal
- Run Profiles
- Browser
- multi-pane
- multi-window
- Workspace restoration

## Agents

- Claude Code adapter
- Codex adapter
- Agent Profiles
- Agent Sessions
- Agent Inbox

## Agentic execution

- Missions
- acceptance criteria
- Tasks
- Run Engine
- Worktree Engine
- Swarm
- Context Fabric

## Intelligence

- Project Graph
- Memory
- Impact Intelligence

## Trust/review

- Source Control
- Review Center
- Proof Ledger
- QA foundation
- permissions/policy

## Integration/product

- GitHub contextual integration
- Connections foundation
- MCP foundation
- Usage
- onboarding
- updater

---

# 102. PARALITH 1.1

After 1.0 reliability:

- Android Device Lab;
- Database Studio;
- deeper visual verification;
- Element Picker source mapping improvements;
- GitLab/Bitbucket;
- Linear/Jira;
- Skills;
- plugin foundation;
- advanced security review;
- voice input.

---

# 103. PARALITH 1.2

- Automations;
- persistent Goals;
- WSL Host;
- SSH Host;
- environment snapshots/caching;
- deeper CI repair loops;
- remote browser execution.

---

# 104. PARALITH 1.5

- Paralith Node;
- multi-machine execution;
- remote worker fleet;
- mobile companion;
- distributed Swarm;
- remote approvals;
- stronger managed isolation.

---

# 105. PARALITH 2.0

Paralith becomes a true agentic engineering control plane:

- persistent event-driven engineering;
- distributed autonomous Runs;
- team Mission Control;
- shared organizational Memory;
- Node clusters;
- enterprise policy;
- self-hosted execution infrastructure;
- organization-wide Skills/Connections;
- advanced delivery automation.

---

# 106. IMPLEMENTATION DEPENDENCY ORDER

The order matters more than feature hype.

```text
FOUNDATION
Tauri/Rust Core
Typed IPC
Storage/Event Journal
Design System
        ↓
WORKSPACE
Project/Host models
Window Registry
Pane system
Explorer/Editor/Terminal
        ↓
AGENTS
Adapter interface
Claude/Codex
Normalized events
Sessions/Inbox
        ↓
ISOLATION
Git Engine
Worktree Engine
        ↓
MISSION EXECUTION
Mission state machine
Task DAG
Run Engine
        ↓
INTELLIGENCE
Context Fabric
Project Graph
Impact Intelligence
        ↓
TRUST
Verification
Proof Ledger
Review Center
        ↓
RUNTIME OBSERVATION
Browser Automation
Element Picker
Visual Evidence
        ↓
KNOWLEDGE
Memory hardening
Staleness/graph
        ↓
PROVIDER INTEGRATION
GitHub/CI/MCP
        ↓
1.0 POLISH
Performance
Recovery
Usage
Onboarding
Updater
```

Building features above a missing dependency produces duplicate hacks and later rewrites.

---

# 107. PHASE EXIT GATES

## Foundation exit

- typed IPC conventions established;
- DB migrations stable;
- event journal working;
- no giant unrestricted backend bridge.

## Workspace exit

- editor/terminal/multi-window reliable;
- restart restoration reliable;
- Project usable without agents.

## Agent exit

- Claude and Codex sessions normalized;
- stop/resume/steer works;
- Inbox works;
- restart preserves sessions.

## Isolation exit

- concurrent write agents cannot casually collide;
- worktree cleanup safe.

## Mission exit

- high-level objective decomposes into traceable Tasks;
- Run Engine executes all work;
- interruption/retry safe.

## Context exit

- Context Packs inspectable;
- provenance/freshness handled;
- ranking materially better than naive file dumping.

## Proof exit

- criteria mapped to evidence;
- source changes stale relevant proof;
- “done” no longer equals completed.

## 1.0 exit

- full intent → verified software flow works reliably on supported stacks;
- no P0 data-loss bugs;
- updater proven;
- critical security boundaries tested.

---

# 108. PRIORITIZATION RULE

Every new feature proposal should answer:

1. Which core-loop stage does it improve?
2. How often will target users use it?
3. Does it reuse existing primitives?
4. Does it create durable differentiation?
5. What new security/reliability burden does it add?
6. Can it be deferred without breaking the loop?

A useful mental score:

```text
(Core Loop Impact × 3)
+ Frequency
+ Differentiation
+ Dependency Value
- Complexity
- Risk
```

This is guidance, not fake precision.

---

# 109. FEATURE QUALITY DEFINITION OF DONE

A Paralith feature is not finished because the happy-path UI exists.

It requires:

## Functional
Main behavior works.

## State
Loading/empty/success/failure/blocked/permission states defined.

## Recovery
Restart/disconnect/crash behavior defined.

## Persistence
Durable state correctly stored.

## Security
Trust boundary and permissions assessed.

## Performance
Large/slow cases measured.

## Accessibility
Keyboard/focus/labels addressed.

## Observability
Errors can be diagnosed.

## Tests
Appropriate unit/integration/E2E coverage.

## Documentation
User-facing concept understandable.

## Integration
Relevant Mission/Context/Proof/Memory hooks implemented rather than left as future glue.

---

# 110. PRODUCT METRICS

## North Star

> **Verified Missions Completed**

A Verified Mission means:

- outcome defined;
- implementation performed;
- required criteria have acceptable Evidence;
- human or policy accepted the result.

## Supporting metrics

- time to first useful Agent Run;
- Mission success rate;
- percentage of criteria with behavioral evidence;
- review rejection/rework rate;
- user interventions per Mission;
- crash-free sessions;
- context usefulness/override rate;
- Workspace restoration success;
- weekly active Projects.

Do not optimize product toward token consumption or message count.

---

# 111. PRODUCT FLYWHEEL

Every successful Mission produces:

```text
Intent
 ↓
Plan
 ↓
Execution
 ↓
Changes
 ↓
Evidence
 ↓
Review
 ↓
Delivery
 ↓
Knowledge
```

That knowledge improves future:

- Context Packs;
- Mission planning;
- impact prediction;
- verification selection;
- agent instructions.

Over time Paralith becomes specifically better at each Project, not merely generically smarter.

---

# 112. FULL REFERENCE USER JOURNEY — TEAM INVITATIONS

The following scenario demonstrates how the entire architecture should behave.

## User intent

> Add team invitations. Owners can invite members by email. Invitations expire after seven days. Prevent duplicate active invitations. Use existing UI components, add tests, verify the real flow, and prepare the PR.

## Step 1 — Mission creation

Mission Control captures the request.

Preflight asks Context Fabric for:

- organization/member model;
- auth/permission model;
- email infrastructure;
- database schema;
- dashboard components;
- test setup;
- recent organization-related changes.

## Step 2 — Mission contract

Paralith proposes:

### Goal
Allow organization owners to invite members by email.

### Constraints
- existing membership behavior unchanged;
- only authorized users may invite;
- use existing email service;
- use current design system.

### Acceptance Criteria

```text
AC-01 Owner can send invitation.
AC-02 Non-owner cannot invite.
AC-03 Duplicate active invite is prevented.
AC-04 Invitation expires after seven days.
AC-05 Valid invite can be accepted.
AC-06 Management UI handles empty/loading/error states.
AC-07 Existing organization tests remain green.
```

## Step 3 — Impact analysis

Project Graph identifies:

```text
Organization Service
Membership DB
Email Service
Auth middleware
Dashboard members page
Organization tests
```

Risk: High because authorization + email + database are involved.

## Step 4 — Task graph

```text
Architecture review
      ↓
Database/model task ─────────┐
Backend invitation API       │
Email integration            │
                             ├→ Integration
Frontend management UI ──────┘
      ↓
QA / Security verification
```

Planner detects which tasks can safely run concurrently.

## Step 5 — Work isolation

Backend and frontend receive worktrees. Shared interface decisions are communicated through structured messages.

## Step 6 — Context Fabric

Backend worker receives:

- organization service;
- permission checks;
- database patterns;
- email service;
- relevant Memory;
- Mission criteria.

Frontend worker receives:

- members page;
- design-system components;
- API client conventions;
- loading/error patterns;
- Mission criteria.

Neither receives unrelated repository noise.

## Step 7 — Execution

Agents run through Run Engine. File changes emit events. Actual touched files update collision tracking.

Backend worker reports interface change:

```text
Finding
POST /organizations/:id/invitations
body: { email }
returns Invitation
```

Frontend worker receives that structured message.

## Step 8 — Integration

Worker changes merge into integration worktree. Conflicts are surfaced to Coordinator or human if not safely resolvable.

## Step 9 — Environment

Service Manager starts API and Web using known Run Profiles.

## Step 10 — verification

Verification Coordinator runs:

- typecheck;
- targeted backend tests;
- existing organization tests;
- browser invite flow;
- permission-negative flow;
- duplicate invite flow;
- UI responsive checks;
- Security Review.

## Step 11 — Evidence

Proof Ledger maps:

```text
AC-01 → browser behavior E3
AC-02 → API/browser negative test E3
AC-03 → integration test + browser E3
AC-04 → automated time/expiration test E2/E3
AC-05 → browser acceptance flow E3
AC-06 → screenshots + browser states E3
AC-07 → regression suite E2
```

## Step 12 — human review

Review Center groups changes:

- data model;
- invitation API;
- email;
- dashboard UI;
- tests.

User notices empty state copy is poor and comments:

> Make this shorter and use our normal empty-state spacing.

A targeted repair Run receives selected UI element + source + review comment.

## Step 13 — proof refresh

UI changed after prior screenshot evidence. Relevant UI proof becomes stale. Browser reruns UI checks and produces updated screenshots.

## Step 14 — PR

User approves. GitHub adapter creates PR with Mission summary, linked criteria, testing summary, and relevant Evidence links/artifacts where suitable.

## Step 15 — CI

CI failure appears as provider event. If permitted, Paralith creates diagnostic Task in same PR work context.

## Step 16 — release/delivery

PR becomes green and is merged according to user policy.

## Step 17 — knowledge update

Project Graph refreshes changed entities. Memory Engine creates or updates verified Feature knowledge:

> Organization invitations use single-use tokens, expire after seven days, and require owner permission.

Architecture/permission Memory relationships are updated. Any superseded old knowledge is marked appropriately.

## Result

The entire process is traceable:

```text
Intent
→ Mission
→ Tasks
→ Agents
→ Worktrees
→ Changes
→ Tests
→ Evidence
→ Review
→ PR
→ Merge
→ Memory
```

That traceability is the product.

---

# 113. FINAL ENGINEERING PRINCIPLE

The worst possible implementation of Paralith would be a giant application containing:

- an editor feature;
- a terminal feature;
- a browser feature;
- a Swarm feature;
- a Memory feature;
- a GitHub feature;
- an automation feature;

that barely understand one another.

The correct implementation is a set of reusable domain primitives where every surface participates in the same lifecycle.

A browser interaction can become Evidence.

Evidence proves an Acceptance Criterion.

An Acceptance Criterion belongs to a Mission.

A Mission owns Tasks.

Tasks create Runs.

Runs execute through Agents on Hosts inside Work Units.

Agents receive Context Packs derived from Project Graph and Memory.

File changes update Project Graph and Impact Intelligence.

Impact Intelligence updates proof freshness and Memory freshness.

Review operates on the exact changes produced by those Runs.

Source Control delivers them.

Ship Center records what was released.

Memory records what the Project has now become.

That circular relationship is what turns Paralith from a feature-heavy ADE into an engineering operating system.

---

# 114. ARCHITECTURAL SUMMARY

```text
                         USER INTENT
                              │
                              ▼
                       MISSION CONTROL
                              │
                    ┌─────────┴─────────┐
                    ▼                   ▼
              PROJECT GRAPH         MEMORY
                    │                   │
                    └─────────┬─────────┘
                              ▼
                       CONTEXT FABRIC
                              │
                              ▼
                          TASK GRAPH
                              │
                              ▼
                          RUN ENGINE
                    ┌─────────┼─────────┐
                    ▼         ▼         ▼
                  HOST     WORK UNIT   POLICY
                    │         │         │
                    └─────────┼─────────┘
                              ▼
                        AGENT RUNTIME
                              │
                  ┌───────────┼────────────┐
                  ▼           ▼            ▼
                FILES      TERMINAL      TOOLS
                  │           │            │
                  └───────────┼────────────┘
                              ▼
                        APPLICATION RUN
                    ┌─────────┼─────────┐
                    ▼         ▼         ▼
                 BROWSER    DEVICE     TESTS
                    └─────────┼─────────┘
                              ▼
                           EVIDENCE
                              │
                              ▼
                        PROOF LEDGER
                              │
                              ▼
                         REVIEW CENTER
                              │
                              ▼
                         SOURCE CONTROL
                              │
                              ▼
                       PR / CI / RELEASE
                              │
                              ▼
                         SHIP CENTER
                              │
                    ┌─────────┴─────────┐
                    ▼                   ▼
              PROJECT GRAPH         MEMORY
                    └─────────┬─────────┘
                              ▼
                       NEXT USER INTENT
```

---

# 115. LOCKED PRODUCT STATEMENT

> **Paralith is the Agentic Development Operating System from Corelith Technologies. It gives developers one local-first control plane for understanding software projects, defining engineering outcomes, compiling project-aware context, coordinating isolated AI workers, observing real applications, proving behavior, reviewing changes, shipping through existing development infrastructure, and maintaining durable project intelligence.**

The product is not measured by how many AI buttons it contains.

It is measured by how reliably one human can turn an engineering intention into verified, reviewable, shippable software.

---

# Appendix A — canonical state machines

## Mission

```text
DRAFT
  ↓
PREFLIGHT
  ↓
PLANNED
  ↓
RUNNING ↔ BLOCKED
  ↓
VERIFYING
  ↓
REVIEW_READY
  ↓
MERGING
  ↓
COMPLETED

Any active state may transition to FAILED or CANCELLED according to policy.
```

## Task

```text
PLANNED → READY → RUNNING → VERIFYING → REVIEW_READY → COMPLETED
                     ↘ BLOCKED
                     ↘ FAILED
```

## Run

```text
QUEUED
 ↓
PREPARING
 ↓
WAITING_ENVIRONMENT / WAITING_APPROVAL
 ↓
RUNNING
 ↓
VERIFYING
 ↓
REVIEW_READY / SUCCEEDED

Exceptional: FAILED / CANCELLED / INTERRUPTED
```

## Worktree

```text
REQUESTED → CREATING → READY → ACTIVE → INTEGRATING → REVIEW → MERGED → ARCHIVED → REMOVED
```

## Memory

```text
FRESH → AT_RISK → STALE → SUPERSEDED
  ↑         │
  └─ verified/update ─┘
```

---

# Appendix B — evidence reference table

| Level | Meaning | Typical proof |
|---|---|---|
| E0 | Claim only | Agent message |
| E1 | Static existence | Diff/file/config inspection |
| E2 | Executed check | Test/build/lint/typecheck |
| E3 | Behavioral verification | Browser/device/API flow |
| E4 | Independent verification | Separate QA, CI, separate environment |

---

# Appendix C — default safety posture

| Capability | Default suggested posture |
|---|---|
| Read Project source | Allow |
| Modify assigned worktree | Allow |
| Run project tests/builds | Allow |
| Start known Run Profile | Allow |
| Install dependency | Ask |
| Write outside Project | Ask/Deny |
| Push branch | Ask |
| Force push | Deny/Ask only explicit expert policy |
| Read unrelated credentials | Deny |
| Read configured connection secret | Brokered, not raw |
| Development DB read | Ask/Allow by project policy |
| Development DB write | Ask |
| Production DB read | Ask |
| Production DB write | Deny by default |
| Deploy production | Ask |
| Delete repository/worktree with unique changes | Deny until explicit destructive confirmation |

---

# Appendix D — engineering review checklist for every new subsystem

Before implementation begins, answer:

- What domain owns this feature?
- What durable entities are created?
- What state machine exists?
- What events are emitted?
- Which Host capabilities does it require?
- Does it need a Work Unit?
- Does it generate/consume Context?
- Does it generate Evidence?
- Can it stale existing Evidence?
- Does it update Project Graph?
- Does it update Memory?
- What permissions are needed?
- What data contains secrets?
- What happens when provider/network/process fails?
- What survives application restart?
- What happens after OS restart?
- What is the cleanup behavior?
- How is it tested?
- How does it behave in secondary windows?
- How does it behave on remote Hosts?
- Is there a non-AI fallback where appropriate?
- Does this duplicate another subsystem?

If these questions cannot be answered, the feature is not architecturally ready.

---

# Appendix E — product review checklist for every new feature

Before accepting a feature into the roadmap:

- Does it strengthen Intent → Verified Software?
- Is it frequently useful to primary users?
- Does it reuse the existing Run/Context/Proof/Host primitives?
- Is the UI simpler than performing the workflow manually?
- Is there a clear failure/recovery experience?
- Does it add permanent maintenance/security burden?
- Are we building it because users need it or because a competitor screenshot looked impressive?
- Could a plugin/integration solve it instead of core product code?
- Does it preserve local-first behavior?
- Can we ship it with a professional quality bar?

---

# End of canonical specification

This file is intended to evolve through explicit revisions. Major architectural deviations should be recorded as decisions rather than silently implemented around it.

---

# Appendix F — subsystem ownership matrix

This matrix is intended to stop cross-domain ownership drift.

| Subsystem | Owns | Does not own | Primary dependencies |
|---|---|---|---|
| Project Registry | Project identity, repository associations | Git operations, file content | Storage, Host Registry |
| Workspace Manager | windows, panes, tab restoration | terminal process lifetime | Window Registry, storage |
| File Service | scoped file operations | indexing policy | Host, Policy |
| File Watch Service | canonical file-change observation | Memory decisions | Host FS, Event Bus |
| Git Engine | Git state and operations | PR provider state | Host, Policy |
| Terminal Host | PTY/process lifecycle | Agent semantics | Host process layer |
| Environment Manager | runtime/tool readiness | Mission planning | Host, terminal/process |
| Agent Runtime | provider sessions/events | Mission completion | Adapter Registry, Run Engine |
| Mission Engine | Mission specification/state | process execution | Task Graph, Proof |
| Task Scheduler | dependency readiness | provider execution details | Mission, Run Engine |
| Run Engine | execution lifecycle | product-level acceptance semantics | Host, Agent, Context, Policy |
| Context Fabric | context selection/packaging | source-of-truth code mutation | Project Graph, Memory, Search |
| Project Graph | structural code relationships | curated conceptual knowledge | parsers/LSP/indexing |
| Impact Service | blast-radius estimation | final verification result | Project Graph, Git diff |
| Memory Engine | durable project knowledge | raw code truth | Impact, Graph, Event Bus |
| Browser Host | automated browser sessions | editor rendering | Run Engine, Evidence |
| Device Service | emulator/device sessions | mobile app source code | Host, Environment |
| Proof Ledger | criteria-to-evidence mapping | running arbitrary tools itself | Verification, Mission |
| Verification Coordinator | verification plan execution | implementation planning | Proof, Browser, Test tools |
| Review Center | human inspection state | raw Git implementation | Git, Mission, Proof |
| Policy Engine | authorization decisions | credential storage | Vault, org/project policy |
| Credential Vault | secret storage/retrieval | authorization decisions | OS secure storage |
| Connections | provider account metadata | core source-control truth | Vault, provider adapters |
| Automation Engine | trigger evaluation | separate agent executor | Event Bus, Run Engine |
| Usage | normalized usage facts | fake quota estimation | Agent/provider adapters |
| Ship Center | release orchestration/status | new hosting platform | Git providers, Release adapters |
| Updater | Paralith self-update | Project deployment | signed release metadata |

---

# Appendix G — domain event catalogue

Exact names may evolve, but event families should remain stable and typed.

## Project events

```text
ProjectRegistered
ProjectOpened
ProjectClosed
ProjectRemoved
ProjectDiscoveryStarted
ProjectDiscoveryStageCompleted
ProjectDiscoveryFailed
ProjectGraphIndexStarted
ProjectGraphIndexCompleted
```

## Workspace events

```text
WorkspaceCreated
WorkspaceOpened
WorkspaceSnapshotSaved
WindowCreated
WindowClosed
PaneSplit
TabMoved
WorkspaceRestored
WorkspaceRestoreDegraded
```

## Filesystem events

```text
FileCreated
FileChanged
FileDeleted
FileRenamed
FileBatchChanged
ExternalModificationDetected
```

Each event should indicate origin when possible:

```text
USER_EDITOR
AGENT_RUN
GIT_OPERATION
EXTERNAL_PROCESS
UNKNOWN
```

## Git events

```text
GitStatusChanged
BranchChanged
CommitCreated
FetchCompleted
PullCompleted
PushCompleted
MergeCompleted
MergeConflictDetected
WorktreeCreated
WorktreeRemoved
```

## Agent events

```text
AgentInstallationDetected
AgentSessionCreated
AgentSessionStarted
AgentSessionResumed
AgentSessionSteered
AgentSessionWaiting
AgentSessionBlocked
AgentSessionStopped
AgentSessionFailed
AgentSessionCompleted
```

## Mission events

```text
MissionCreated
MissionPreflightStarted
MissionPlanned
MissionRevised
MissionStarted
MissionBlocked
MissionVerificationStarted
MissionReviewReady
MissionCompleted
MissionFailed
MissionCancelled
```

## Task events

```text
TaskCreated
TaskReady
TaskStarted
TaskBlocked
TaskVerificationStarted
TaskReviewReady
TaskCompleted
TaskFailed
TaskCancelled
```

## Run events

```text
RunQueued
RunPreparing
RunEnvironmentReady
RunContextCompiled
RunAgentStarted
RunApprovalRequested
RunVerificationStarted
RunSucceeded
RunFailed
RunInterrupted
RunCancelled
```

## Context events

```text
ContextRequestCreated
ContextCompilationStarted
ContextPackCreated
ContextPackInvalidated
ContextItemRejected
ContextOverrideApplied
```

## Memory events

```text
MemoryCreated
MemoryRevised
MemoryVerified
MemoryLocked
MemoryMarkedAtRisk
MemoryMarkedStale
MemorySuperseded
MemoryKnowledgeUpdated
```

## Evidence events

```text
EvidenceCreated
EvidenceValidated
EvidenceInvalidated
EvidenceMarkedStale
CriterionVerified
CriterionVerificationFailed
ProofLedgerCompleted
ProofLedgerReopened
```

## Browser/device events

```text
BrowserSessionStarted
BrowserNavigationCompleted
BrowserConsoleError
BrowserEvidenceCaptured
DeviceStarted
DeviceConnected
DeviceDisconnected
AppInstalled
DeviceEvidenceCaptured
```

## Security events

```text
ApprovalRequested
ApprovalGranted
ApprovalRejected
PolicyDeniedAction
CredentialAccessed
ConnectionRevoked
SecurityFindingCreated
```

## Release events

```text
ReleasePlanCreated
ReleaseVerificationStarted
ReleaseArtifactBuilt
ReleasePublished
DeploymentStarted
DeploymentSucceeded
DeploymentFailed
UpdaterMetadataVerified
```

---

# Appendix H — IPC endpoint families

The concrete implementation may use Tauri commands/events, but the conceptual contract should be domain-oriented.

## Project

```text
project.list
project.register_local
project.open
project.close
project.remove
project.discovery_status
project.reindex
```

## Workspace

```text
workspace.get
workspace.update_layout
workspace.restore
workspace.create_window
workspace.close_window
workspace.move_tab
```

High-frequency drag/resize interactions should avoid hammering durable storage on every pixel. Frontend may keep transient layout during drag and commit final snapshot.

## Files

```text
files.list
files.read
files.write
files.create
files.rename
files.move
files.delete
files.stat
```

Every call carries Project/Host scope.

## Git

```text
git.status
git.diff
git.stage
git.unstage
git.commit
git.branches
git.checkout
git.pull
git.push
git.worktrees
git.create_worktree
git.remove_worktree
```

## Terminal

```text
terminal.create
terminal.attach
terminal.input
terminal.resize
terminal.kill
terminal.detach
terminal.list
```

Terminal output is streamed through a bounded event/channel mechanism rather than request/response polling.

## Agents

```text
agents.detect
agents.capabilities
agents.start
agents.resume
agents.steer
agents.stop
agents.raw_stream
```

## Missions

```text
mission.create
mission.preflight
mission.plan
mission.revise
mission.start
mission.pause
mission.cancel
mission.get
mission.list
```

## Runs

```text
run.get
run.list
run.cancel
run.retry
run.approve
run.reject
```

## Context

```text
context.compile
context.inspect
context.pin_item
context.exclude_item
context.recompile
```

## Memory

```text
memory.search
memory.get
memory.create
memory.update
memory.verify
memory.lock
memory.supersede
memory.graph
```

## Proof

```text
proof.get
proof.verify
proof.run_plan
proof.open_artifact
proof.invalidate
```

## Browser

```text
browser.create
browser.navigate
browser.capture
browser.pick_element
browser.console
browser.network
```

Automation actions should usually be backend-internal tools tied to Runs rather than generic unrestricted frontend remote-control calls.

## Connections

```text
connections.list
connections.begin_auth
connections.complete_auth
connections.verify
connections.revoke
```

## Usage

```text
usage.summary
usage.by_project
usage.by_mission
usage.by_provider
```

---

# Appendix I — concurrency and locking model

Paralith will have many concurrent writers: user editor, Git operations, agents, watchers, background jobs, and remote events. Concurrency must be designed intentionally.

## Principle 1 — prefer isolation over locking

Agent write conflicts should primarily be reduced using Worktrees, not giant global mutexes.

## Principle 2 — database transactions are short

Do not hold SQLite write transactions while waiting for:

- provider network call;
- agent process;
- shell command;
- browser action.

Persist transition, perform external operation, then persist result.

## Principle 3 — optimistic revision checks

Mutable durable entities may carry revision/version integer.

Example:

```text
UPDATE missions
SET ..., revision = revision + 1
WHERE id = ? AND revision = ?
```

If update loses race, caller reloads and resolves.

## Principle 4 — per-entity operation serialization where necessary

Examples:

- two branch checkout operations on same worktree cannot execute simultaneously;
- two environment setup jobs for same fingerprint should coalesce;
- one Mission planning revision commits at a time.

Use keyed operation coordinators rather than global application lock.

## Principle 5 — filesystem origin tracking

When possible, backend records files a Run intends/modifies so watcher events can be correlated instead of recursively triggering redundant work.

## Principle 6 — bounded channels

Terminal output, agent streams, browser logs, and file events use bounded queues/backpressure. A runaway process must not allocate unbounded renderer memory.

## Principle 7 — cancellation tokens

Long-running indexing, search, context compilation, and verification accept cancellation signals.

---

# Appendix J — transaction boundaries for critical flows

## Create Mission

Atomic database transaction:

- create Mission;
- create initial revision;
- create criteria if supplied;
- append MissionCreated event.

Preflight happens afterward.

## Create Worktree

1. reserve WorkUnit row as `CREATING`;
2. execute Git operation outside long DB transaction;
3. update `READY` with actual path/ref;
4. on failure mark `ERROR` and preserve diagnostic details.

On startup, `CREATING` rows are reconciled against actual Git worktrees.

## Start Run

Atomic reservation:

- Run row `QUEUED`;
- source relationship;
- scheduler ownership token;
- event.

External setup occurs after reservation.

## Record Evidence

Evidence metadata + blob references + criterion relationship should commit atomically so Proof Ledger never points at a missing artifact row.

## Publish Release

Release publishing is a saga, not one database transaction. Every step is recorded and compensating/retry behavior is explicit.

---

# Appendix K — artifact lifecycle and retention

## Artifact categories

- screenshots;
- videos;
- test reports;
- build logs;
- agent raw logs;
- browser traces;
- generated reports;
- release artifacts references.

## Retention classes

```text
EPHEMERAL
RUN_LIFETIME
MISSION_HISTORY
PROJECT_HISTORY
PINNED
RELEASE_RECORD
```

## Garbage collection

Background GC deletes unreferenced blobs only after reference scan and grace period.

Never delete blobs attached to:

- pinned Evidence;
- active Mission;
- release record;
- explicit user pin.

## Storage pressure UX

Settings > Storage shows:

- total Paralith data;
- browser traces;
- screenshots/videos;
- agent logs;
- indexes;
- caches.

User can clear safe caches separately from historical proof.

---

# Appendix L — remote transport requirements

A future remote transport should satisfy these properties.

## Authentication

Mutual device/host authentication after enrollment.

## Encryption

All transport encrypted.

## Multiplexing

One connection can carry:

- filesystem RPC;
- terminal stream;
- agent events;
- browser/device streams;
- heartbeat;
- job control.

## Reconnect

Session IDs allow reattachment without treating every network flap as a destroyed Run.

## Flow control

Large terminal/browser streams must not starve control messages.

## Capability negotiation

Node reports version and capabilities. Desktop chooses compatible operations.

## Upgrade compatibility

Protocol has explicit version handshake. Unsupported combinations show upgrade guidance rather than undefined behavior.

## File transfer

Use chunking/hash verification for large artifacts. Prefer Git for source synchronization when repository already provides it.

---

# Appendix M — UI state matrix

Every network/process-backed panel must define at least these states.

| State | UX requirement |
|---|---|
| Initial | Skeleton or immediate empty shell; avoid unnecessary spinner takeover. |
| Loading | User knows what is being loaded and can navigate elsewhere. |
| Ready | Primary operation obvious. |
| Empty | Explain concept and next action. |
| Partial | Show available data while one dependency is unavailable. |
| Offline | State what local functions remain usable. |
| Permission required | Explain exact action and scope. |
| Blocked | State blocker and owner. |
| Failure | Preserve useful data; show recovery actions. |
| Reconnecting | Existing data remains visible with freshness indicator. |
| Stale | Explain what changed and how to refresh/reverify. |

Examples:

### Agent panel partial state
Transcript remains visible while provider reconnects.

### PR panel partial state
Local diff remains visible if GitHub API is unavailable.

### Memory stale state
Content remains inspectable, but Context Fabric warns/excludes according to policy.

---

# Appendix N — user-facing freshness language

Paralith deals with dynamic information everywhere. UI should distinguish:

- **Live** — actively connected current state;
- **Updated 30s ago** — recently fetched external state;
- **Cached** — last known data while offline;
- **Stale** — underlying revision changed;
- **Unknown** — cannot establish validity.

Never show an old CI/PR/provider value as if it were live.

---

# Appendix O — detailed Mission completion algorithm

Mission completion should follow a deterministic backend policy.

Pseudo-flow:

```text
function evaluateMissionCompletion(mission):
    if mission.status not in [VERIFYING, REVIEW_READY]:
        return NOT_ELIGIBLE

    for criterion in mission.criteria:
        evidence = validEvidenceForCurrentRevision(criterion)

        if evidence does not satisfy criterion.required_level:
            return MISSING_PROOF(criterion)

    if unresolvedBlockingSecurityFindings(mission):
        return BLOCKED_SECURITY

    if unresolvedRequiredApprovals(mission):
        return WAITING_APPROVAL

    if mission.policy.requires_human_review and not humanApproved(mission):
        return WAITING_REVIEW

    return ELIGIBLE_FOR_COMPLETION
```

The exact policy can evolve, but completion should never be an arbitrary frontend button that sets a boolean.

---

# Appendix P — Context Fabric scoring model guidance

A candidate context item's score can be composed from normalized signals.

Conceptually:

```text
score =
  lexical_match_weight
+ symbol_relationship_weight
+ graph_distance_weight
+ mission_seed_weight
+ runtime_reference_weight
+ git_recency_weight
+ user_pin_weight
+ semantic_similarity_weight
- staleness_penalty
- duplication_penalty
- trust_penalty_when_applicable
```

Do not freeze arbitrary numbers into product doctrine. Evaluate against benchmark tasks.

## Context benchmark suite

Maintain repository fixtures with questions/tasks where expected relevant files are known.

Metrics:

- recall of required context;
- precision of selected context;
- token efficiency;
- agent task success;
- user override frequency.

Context Fabric quality should be measured, not judged by “looks intelligent.”

---

# Appendix Q — Project Graph indexing adapters

Generic parsers cover basics. Framework adapters improve high-value relationships.

Potential adapters:

- JavaScript/TypeScript imports/symbols;
- React component hierarchy hints;
- Next.js routes/server actions;
- Tauri commands/frontend invoke relationships;
- Rust modules/functions/traits;
- Python modules/functions;
- database migration/schema relationships;
- test-to-source relationships;
- API route definitions.

Adapters emit normalized Nodes/Edges.

A failed framework adapter must not invalidate generic graph data.

---

# Appendix R — Worktree integration algorithm

For a multi-worker Mission:

1. freeze Mission base ref;
2. create worker worktrees from base or dependency-integrated ref;
3. execute worker Runs;
4. commit or snapshot each completed worker change according to policy;
5. create/update integration worktree;
6. integrate completed worker changes in dependency order;
7. resolve conflicts through coordinator/human;
8. run integration verification;
9. present final integrated diff;
10. apply/merge to user's target branch only after review policy.

The system must keep worker history available until final work is safely integrated.

---

# Appendix S — agent interruption and resume rules

## User closes Agent tab
Session continues unless explicitly stopped.

## Renderer crashes
Agent Host remains authoritative.

## Agent child process exits unexpectedly
Run becomes `INTERRUPTED` or `FAILED` depending on detectable cause.

## App Core restarts
Startup reconciliation checks provider process/session state. If provider supports resume, UI offers Resume.

## Computer reboots
Running process is gone. Durable worktree, transcript, Mission, and Context history remain. UI must never display worker as still running.

## Provider auth expires
Run enters blocked/auth-required state. Worktree remains intact.

---

# Appendix T — approval UX rules

Approvals are security decisions, not annoying modal spam.

## Approval prompt includes

- who/what requested action;
- exact target;
- reason;
- risk;
- whether action is reversible;
- requested duration/scope.

Bad:

> Agent wants permission. Allow?

Good:

> Backend Worker wants to run `pnpm prisma migrate dev` against **Local Development / PostgreSQL** to apply the new invitation table migration.

`[Allow once] [Reject] [Inspect command]`

## Batch approvals

Only combine actions when same capability/target/risk. Never hide a production deploy inside a batch of harmless tests.

---

# Appendix U — threat-model starter list

Each security-sensitive feature should consider at least:

## Repository threats

- malicious scripts;
- prompt injection in docs/comments;
- symlink traversal;
- package lifecycle scripts;
- secrets already present in repo.

## Agent threats

- hallucinated destructive command;
- compromised provider process;
- overbroad environment variables;
- arbitrary network exfiltration in Native Mode.

## Browser threats

- hostile web content;
- XSS into trusted UI boundary;
- localhost CSRF-like interactions;
- credential/session leakage.

## MCP/plugin threats

- malicious tool descriptions;
- tool output injection;
- overbroad OAuth scopes;
- credential exfiltration;
- unsigned plugin updates.

## Remote threats

- MITM/host impersonation;
- stale enrollment tokens;
- compromised Node;
- cross-user job access.

## Update threats

- unsigned artifacts;
- downgrade attack;
- compromised release metadata;
- partial update corruption.

---

# Appendix V — engineering invariants

These invariants should be tested and defended.

1. A `COMPLETED` Mission cannot contain a required unverified criterion.
2. Evidence references a concrete source revision or clearly declares when revision is not applicable.
3. Deleting a UI tab never deletes unique code changes.
4. Removing a Project from registry never deletes repository contents unless user explicitly selects a destructive delete flow.
5. Closing a renderer does not implicitly kill backend-owned processes.
6. A worktree with unique unmerged modifications is never silently garbage-collected.
7. A credential secret is never stored in ordinary SQLite plaintext fields.
8. Browser web content cannot call privileged app IPC.
9. External untrusted text cannot override system/user policy merely by appearing in Context.
10. An offline external integration cannot make stale data look live.
11. A Production DB connection cannot visually look identical to Local Development.
12. Run cancellation always has a deterministic resulting state.
13. Every provider-specific Agent event can be inspected in raw form even if normalization fails.
14. Context Inspector can reconstruct the Context Pack associated with a historical Run, subject to retention policy.
15. Mission revisions remain auditable after scope changes.
16. Policy denial cannot be bypassed by switching Agent provider.
17. Remote Host identity is explicit for filesystem/process operations.
18. File Watch Service has one canonical normalized event source per watched Host scope.
19. A failed background index never blocks editing.
20. Stable updater refuses artifacts failing signature/integrity policy.

---

# Appendix W — product non-goal enforcement

When a proposal arrives, map it to one of these outcomes.

## Core feature
Directly strengthens core lifecycle; build in core.

## Integration
Useful but provider-specific; build adapter/plugin.

## Skill
Procedural agent knowledge; implement as Skill rather than product UI.

## External-link/contextual surface
Provider already owns full workflow; show contextual summary + deep link.

## Reject
Does not improve software engineering lifecycle enough to justify complexity.

Examples:

### “Build full GitHub releases browser”
Contextual integration / reject full clone.

### “Add Figma import for UI implementation context”
Integration.

### “Add Tauri release process knowledge”
Skill + Ship Center integration.

### “Add social feed for developers”
Reject.

---

# Appendix X — architectural decision record requirement

Major deviations from this specification require an ADR containing:

```text
Title
Status
Context
Decision
Alternatives considered
Consequences
Security impact
Migration impact
Affected domains
Rollback strategy
```

Examples requiring ADR:

- replacing SQLite;
- introducing a cloud-required control plane;
- adding a new privileged plugin runtime;
- changing Host protocol;
- changing Mission completion semantics;
- replacing worktrees as primary local isolation;
- moving agent execution into a separate daemon.

This prevents architectural drift caused by individual implementation prompts.

---

# Appendix Y — recommended repository documentation set

This Master Spec should be accompanied over time by smaller code-adjacent documents:

```text
docs/
├── architecture/
│   ├── system-overview.md
│   ├── run-engine.md
│   ├── context-fabric.md
│   ├── mission-engine.md
│   ├── proof-ledger.md
│   ├── memory.md
│   ├── host-protocol.md
│   └── security-model.md
├── adr/
├── product/
│   ├── ui-navigation.md
│   └── terminology.md
└── operations/
    ├── release.md
    ├── migrations.md
    └── diagnostics.md
```

The Master Spec remains the canonical whole-product map; subsystem docs can hold code-level evolving details.

---

# Appendix Z — final lock

Paralith should always be able to trace an important engineering outcome through this chain:

```text
Why was this change requested?
→ Mission

What did success mean?
→ Acceptance Criteria

Who/what performed the work?
→ Runs + Agent Sessions

Where was it performed?
→ Host + Work Unit + Worktree

What information did the worker receive?
→ Context Pack

What changed?
→ Git/File events

What might those changes affect?
→ Project Graph + Impact

How do we know it works?
→ Evidence + Proof Ledger

Who reviewed it?
→ Review state

Where did it ship?
→ PR + Release

What should future agents know?
→ Memory
```

If a major feature cannot participate in that trace where relevant, its architecture should be questioned before it becomes permanent Corelith code.
