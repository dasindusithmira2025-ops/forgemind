Paralith Design System & Product UI Architecture

Status: Canonical design source of truthApplies to: paralith-tauri/ desktop applicationAudience: Product engineers, UI engineers, UX designers, agent implementers, reviewers, and future maintainersPriority: This document governs the visual language, interaction grammar, layout architecture, and UI implementation quality of Paralith. When an implementation conflicts with this document, the implementation is considered incorrect unless this document is intentionally updated first.

0. Purpose

Paralith is not a dashboard, a website wrapped in a desktop shell, or a collection of AI features.

Paralith is a native-feeling operating environment for software engineering agents.

Every interface decision must reinforce that identity.

The design system is built around five goals:

Artifact-first work — code, terminals, diffs, browser content, graphs, database schemas, agent runs, and evidence occupy the majority of the screen.

High information density without visual noise — the product should feel powerful without feeling crowded.

Structural consistency — Terminal, Browser, Editor, Git, Memory, Database Studio, Mission Control, Swarm, and future tools must feel like parts of the same system.

Operational clarity — users should always understand what is active, what requires attention, what changed, and what will happen next.

Desktop-grade quality — keyboard navigation, focus, resizing, multi-window behavior, high-DPI rendering, motion, accessibility, and error states are first-class engineering concerns.

This system draws inspiration from the restraint and structural discipline of premium engineering tools, but Paralith must preserve its own product identity and workflows.

1. Product Design Thesis

1.1 The target feeling

When a user opens Paralith, the product should communicate:

serious engineering tool

calm control center

agent-native workstation

precision

speed

trust

modularity

intelligence without theatrics

The interface should not communicate:

AI SaaS dashboard

gaming HUD

neon cyberpunk tool

glassmorphism showcase

rounded-card marketplace

marketing site inside an app

visual experimentation at the expense of usability

The intended emotional profile is:

Calm, dense, precise, restrained, trustworthy, technical.

1.2 Design equation

Paralith's UI genome is:

High information density + low visual noise + precise hierarchy + consistent geometry + semantic state + restrained motion.

A useful internal approximation:

90% neutral surfaces

8% semantic state

2% brand accent

Accent color is not decoration.Color is earned by meaning.

2. Non-Negotiable Design Principles

2.1 Artifact before chrome

The thing the user is working on must visually dominate.

Examples:

Terminal session > terminal toolbar

Code > editor chrome

Database schema > designer controls

Browser content > browser frame

Git diff > repository actions

Memory graph > navigation

Mission execution > mission settings

If a toolbar becomes visually stronger than the work surface, the hierarchy is wrong.

2.2 A surface must earn its container

Do not create nested cards simply to separate content.

Avoid:

Page
└── Card
    └── Section card
        └── Row card
            └── Control card

Prefer:

Canvas
├── Section
│   ├── Label
│   ├── Control
│   └── Divider
└── Artifact

Use borders, spacing, alignment, and typographic hierarchy before adding a container.

2.3 Borders before shadows

Paralith uses hairline structure, not floating-card elevation.

Primary separation mechanisms:

1px borders

surface luminance differences

spacing

typography

semantic tint

Shadows are reserved for:

transient popovers

dropdowns

floating command surfaces

selected drag layers

destructive confirmation dialogs

Never use strong shadows on ordinary panes.

2.4 Structure before decoration

Every visible element must have a functional purpose.

Do not add:

decorative gradients

decorative circles

pointless icon containers

glow effects

meaningless colored borders

ornamental illustrations inside core workflows

The application may have branded launch/empty states, but active workspaces remain utilitarian.

2.5 Progressive configuration

Complex workflows should reveal complexity in stages.

Preferred pattern:

Start → Configure → Assign → Review → Run

Examples:

workspace creation

swarm creation

mission setup

database planning

agent assignment

multi-terminal layout

release/update flow

Do not expose 30 unrelated settings simultaneously.

3. Application Spatial Architecture

Paralith uses a pane-oriented desktop architecture.

3.1 Canonical application regions

┌───────────────────────────────────────────────────────────────────────────┐
│ Application chrome / native title bar integration                        │
├───────────────┬──────────────────────────────────┬────────────────────────┤
│               │                                  │                        │
│ Primary       │ Main Workbench                   │ Secondary Workbench    │
│ Sidebar       │                                  │ / Inspector / Tool     │
│               │                                  │                        │
│               │                                  │                        │
├───────────────┴──────────────────────────────────┴────────────────────────┤
│ Optional status / command / attention surface                            │
└───────────────────────────────────────────────────────────────────────────┘

The exact layout may change by workspace, but all major tools must be composed from the same primitives.

3.2 Canonical pane model

Every primary tool surface should derive from the following conceptual structure:

Pane
├── PaneHeader
│   ├── PaneIdentity
│   ├── PaneTabs
│   ├── PaneStatus
│   └── PaneActions
├── PaneContextBar (optional)
├── PaneBody
├── PaneOverlayLayer
└── PaneStatusBar (optional)

Tools should not independently invent their own chrome.

This architecture applies to:

Terminal

Browser

Editor

Git

Memory

Database Designer

Mission Control

Swarm

File Explorer

Review Center

Agent Inspector

Logs

Diagnostics

Future tools

3.3 Pane boundaries

Major panes use:

border: 1px solid var(--border-faint);

or shared separators:

border-right: 1px solid var(--border-subtle);

Avoid rounded outer cards around workbench panes.

Pane layout should feel architectural, not boxed.

4. Surface and Color System

4.1 Core neutral palette

The following values are the baseline visual target and may be tuned slightly after real-device validation.

:root {
  --canvas-deep: #090d13;
  --canvas-base: #0b0f15;

  --surface-1: #0e1217;
  --surface-2: #13181e;
  --surface-3: #181d24;
  --surface-4: #1d232b;

  --border-faint: rgba(255,255,255,0.045);
  --border-subtle: rgba(255,255,255,0.065);
  --border-default: rgba(255,255,255,0.085);
  --border-hover: rgba(255,255,255,0.12);
  --border-strong: rgba(255,255,255,0.16);

  --text-primary: #e8ebef;
  --text-secondary: #a0a7b0;
  --text-muted: #69717c;
  --text-faint: #4c535d;

  --accent-primary: #4f86ea;
  --accent-hover: #5b91f4;
  --accent-pressed: #4478d5;
  --accent-soft: rgba(79,134,234,0.12);
  --accent-border: rgba(79,134,234,0.28);
}

Do not hardcode these colors throughout components.Use semantic tokens.

4.2 Semantic colors

Color communicates state.

:root {
  --state-info: #4f86ea;
  --state-success: #4fac82;
  --state-warning: #d3a84f;
  --state-danger: #d35f6f;
  --state-agent: #8a72d8;
  --state-ready: #4ca9a5;
  --state-neutral: #707986;
}

Associated soft backgrounds:

--state-info-soft: rgba(79,134,234,0.11);
--state-success-soft: rgba(79,172,130,0.10);
--state-warning-soft: rgba(211,168,79,0.10);
--state-danger-soft: rgba(211,95,111,0.11);
--state-agent-soft: rgba(138,114,216,0.11);
--state-ready-soft: rgba(76,169,165,0.10);

Meaning contract

Blue: active / selected / informational

Green: verified / succeeded / healthy

Amber: attention / waiting / degraded

Red: failure / blocked / destructive

Purple: agent / automation / swarm

Teal: ready / connected / live

Gray: idle / disabled / secondary

Do not assign colors arbitrarily by feature.

5. Typography System

5.1 Font strategy

Use a modern, native-feeling sans-serif stack.

Recommended order:

font-family:
  Inter,
  Geist,
  "SF Pro Text",
  "Segoe UI",
  system-ui,
  sans-serif;

Code / terminal:

font-family:
  "JetBrains Mono",
  "SFMono-Regular",
  Consolas,
  "Liberation Mono",
  monospace;

Do not bundle or introduce multiple display fonts without a specific product reason.

5.2 Type scale

--font-2xs: 9px;
--font-xs: 10px;
--font-sm: 11px;
--font-ui: 12px;
--font-md: 13px;
--font-lg: 15px;
--font-xl: 18px;
--font-2xl: 22px;

Recommended usage:

Role

Size

Weight

Major wizard title

18–22px

650–700

Page / tool heading

15–18px

600–650

Section heading

13–15px

600–650

Standard UI

12–13px

450–550

Sidebar text

11–12px

500–600

Metadata

10–11px

450–500

Micro label

9–10px

550–650

Terminal

12–13px

400–500

5.3 Contrast hierarchy

There are four primary text contrast levels.

Level 1 — Critical

var(--text-primary)

Use for:

current title

selected item

primary content

high-priority values

Level 2 — Normal

var(--text-secondary)

Use for:

labels

descriptions

standard actions

table content

Level 3 — Supporting

var(--text-muted)

Use for:

metadata

paths

timestamps

helper text

keyboard hints

Level 4 — Atmospheric

var(--text-faint)

Use for:

inactive navigation

decorative separators

ultra-low-priority metadata

Do not make important controls Level 4.

6. Geometry

6.1 Radius scale

Paralith intentionally avoids excessive roundness.

--radius-xs: 3px;
--radius-sm: 5px;
--radius-md: 7px;
--radius-lg: 10px;
--radius-pill: 999px;

Recommended usage:

pane boundaries: 0–3px

sidebar row: 5px

inputs: 5px

buttons: 5–7px

selector tile: 6px

popover: 7–10px

badge: 3–999px, depending on type

Large content areas should usually not be rounded cards.

6.2 Spacing system

Use a 4px base rhythm.

--space-1: 4px;
--space-2: 8px;
--space-3: 12px;
--space-4: 16px;
--space-5: 20px;
--space-6: 24px;
--space-8: 32px;
--space-10: 40px;
--space-12: 48px;

Avoid arbitrary values unless they solve a real geometry problem.

6.3 Control heights

Recommended desktop control heights:

micro button: 24px

compact button: 28px

standard button: 32px

primary wizard action: 34–36px

compact input: 28px

standard input: 32px

sidebar row: 28–32px

pane tab row: 30–34px

Visible UI may be compact, but hit targets should remain usable.

7. Buttons

7.1 Hierarchy

Paralith has three normal action tiers.

Primary

Use for the single dominant next action.

Create Workspace
Run Mission
Apply Changes
Add Agents
Update Now

Appearance:

accent fill

high contrast label

restrained border

subtle hover

no large glow

Secondary

Use for normal alternatives.

Appearance:

neutral surface

subtle border

normal text

Tertiary

Use for low-priority navigation.

Appearance:

text-only or minimal surface

no visual dominance

7.2 Destructive actions

Never represent destructive actions as ordinary neutral controls when consequence is meaningful.

Examples:

delete workspace

discard uncommitted changes

terminate agent run

remove database object

clear memory index

uninstall update

Use explicit red semantic state and confirmation proportional to impact.

8. Inputs

Inputs should feel integrated into the workbench.

Default:

background: var(--surface-1);
border: 1px solid var(--border-default);
border-radius: var(--radius-sm);
color: var(--text-primary);

Focus:

border-color: var(--accent-border);
box-shadow: 0 0 0 1px rgba(79,134,234,0.12);

Do not use glowing input focus.

Paths, shell commands, IDs, hashes, branches, and code-related values should use monospace where appropriate.

9. Sidebar Architecture

The sidebar is compact, flat, and semantic.

9.1 Section structure

Existing Paralith information architecture should remain intact.

Canonical sections may include:

PROJECT
CURRENT PROJECTS
WORKSPACES — THIS WINDOW
WORKSPACES — OTHER MONITORS
SWARMS
MISSIONS

Do not redesign navigation simply to imitate another product.

9.2 Sidebar row anatomy

●  Workspace Name                   3

Components:

semantic state indicator

icon only if useful

title

compact status/badge

contextual action on hover/focus

Selection should be indicated using:

subtle tinted background

subtle semantic border

stronger text

active indicator

Not a bright full-width block.

9.3 Selected state

Conceptual style:

background:
  linear-gradient(
    90deg,
    rgba(79,134,234,0.10),
    rgba(79,134,234,0.035)
  );
border: 1px solid rgba(79,134,234,0.22);

Semantic variants may use warning, danger, agent, or ready state.

10. Pane Tabs and Mode Rails

Tools such as Browser, Editor, Database, Memory, and Git may share a contextual pane.

Example:

Browser         Editor         Database         Memory
──────────────────────────────────────────────────────
contextual toolbar
──────────────────────────────────────────────────────
content

Rules:

labels are compact

active tab is clear but restrained

inactive tabs are low contrast

no oversized pills

tabs must support keyboard focus

overflow behavior must be intentional

switching should preserve tool state where possible

11. Terminal System

Terminal is a first-class Paralith primitive.

11.1 Grid philosophy

For multiple terminals, use grid structure instead of independent floating cards.

Preferred:

terminal │ terminal
─────────┼─────────
terminal │ terminal

Not:

[ rounded terminal card ] [ rounded terminal card ]
[ rounded terminal card ] [ rounded terminal card ]

11.2 Terminal pane anatomy

project / branch                     actions
agent / model / session state
working directory

terminal content

status                               effort/mode

prompt line
automation / continuation state

Chrome must remain minimal.

11.3 Density

The terminal body should consume >85% of available pane area whenever practical.

Agent metadata belongs in compact headers/status regions.

11.4 Attention states

Terminal/agent states may include:

working

needs input

needs permission

idle

finished

failed

These states must be visible through:

semantic indicator

compact label/badge

sidebar propagation

keyboard-accessible attention routing

Do not rely on color alone.

12. Workspace Creation

Use progressive setup.

Suggested flow:

1. Start
2. Layout
3. Agents
4. Review

12.1 Layout step

Show terminal count as visual topology options:

[1] [2] [4] [6] [8] [10] [12]

Each option should preview its split pattern.

Do not use a standard dropdown for topology.

12.2 Agent setup

Use dense rows rather than provider cards.

Example:

0 / 4 agents

Quick fill:
One of each   Split evenly   Clear

☑ Claude                         2
   Model       Opus
   Role        Architect
   Instances   − 2 +

☑ Codex                          2
   Model       GPT 5.6
   Role        Builder
   Instances   − 2 +

Expanded configuration stays inline.

13. Swarm UI

Swarm is not a colorful orchestration diagram by default.

The default representation should optimize for operational clarity.

13.1 Primary swarm view

Show:

swarm identity

project

objective

agent list

role

model

status

task assignment

dependency state

current branch/worktree

attention requirements

evidence / output state

Graph visualization is optional and secondary.

13.2 Swarm colors

Use semantic state, not arbitrary role color.

Roles may use icons or labels, but role color must not compete with execution status.

Execution state always wins.

14. Mission Control

Mission Control is an execution environment, not a form page.

The hierarchy should be:

Mission
├── objective
├── current execution state
├── task graph / sequence
├── agent assignments
├── evidence
├── review
└── controls

Configuration is secondary once execution begins.

The running mission should visually transform from setup UI into operational UI.

15. Database Designer

The Database Designer must feel like an engineering canvas.

15.1 Canvas

The schema graph should dominate.

Controls should be distributed into:

compact top/context toolbar

optional inspector

canvas overlays

command/search palette

Avoid a dashboard layout around the graph.

15.2 Table nodes

Database nodes must be denser than generic flowchart nodes.

Each node may show:

users
────────────────
id            uuid      PK
email         text      UQ
name          text
created_at    time
────────────────
3 relations

Use strong typography hierarchy and thin borders.

Do not apply large decorative shadows.

15.3 Relations

Relations must communicate:

direction

cardinality

optionality

constraint type

relation health

Selection should use semantic accent, not neon glow.

16. Memory UI

Memory should prioritize automated understanding rather than forms.

Preferred views:

timeline

entity/claim graph

ranked search

source/citation inspector

revision history

conflicts

context pack preview

Manual memory creation should be secondary.

16.1 Memory result card policy

Search results may use compact rows, not large content cards.

Display:

entity/claim title

confidence

source

timestamp/revision

relevance

citation link

Expanded detail may open in an adjacent pane.

17. Git and Review UI

Git surfaces must be optimized for review.

Preferred layout:

Files / Changes | Diff / Review | Optional agent/evidence context

The diff remains the dominant artifact.

Actions such as:

stage

unstage

discard

commit

open PR

must not overwhelm the diff.

18. Browser

The embedded browser should look native to Paralith.

Structure:

Browser tab row
URL / navigation bar
content

Do not recreate a full consumer browser.

Show only what engineering workflows need:

back

forward

reload

URL

open external

split / attach

optional dev action

19. Editor

The editor shares the same pane grammar as Browser and Terminal.

The editor must not be visually redesigned as a separate mini-application.

Required consistency:

same tab scale

same border system

same active state

same toolbar density

same focus semantics

same context menu language

20. Empty States

Empty states should be calm and useful.

Good:

No terminal is open

Create a terminal or restore a previous agent session.

[ New terminal ]

Bad:

giant illustration

excessive marketing text

gradient mascot

three promotional cards

unnecessary confetti

Workspace landing states may have more visual character than active work surfaces.

21. Motion System

Motion communicates structural change.

21.1 Duration

--motion-fast: 100ms;
--motion-normal: 160ms;
--motion-slow: 220ms;

Use:

hover/focus: 80–120ms

tab/pane change: 140–180ms

popover/dialog: 160–220ms

major layout transition: 180–240ms

Avoid spring animation for ordinary controls.

21.2 Reduced motion

Respect prefers-reduced-motion.

Functional state transitions must remain understandable with motion disabled.

22. Accessibility

Accessibility is part of design correctness.

Minimum requirements:

keyboard operation for all core workflows

visible focus state

no information encoded only through color

sufficient text contrast

minimum usable hit targets

screen-reader labels for icon-only controls

logical tab order

Escape closes transient UI

Enter/Space activate appropriate controls

high-DPI scaling

Windows display scaling validation

color-blind-safe state differentiation

23. Focus System

Focus is critical in a multi-pane application.

There are separate concepts:

selected workspace

active pane

keyboard focus

selected item

agent requiring attention

Do not collapse these into one color state.

23.1 Active pane

The active pane should have a subtle but unmistakable indicator.

Possible techniques:

stronger header text

slightly stronger pane border

1px accent edge

active tab contrast

Never use a large glowing outline.

24. Keyboard-First Interaction

Core operations should have keyboard equivalents.

Examples:

focus next attention item

cycle panes

cycle workspaces

new terminal

split pane

close pane

open command palette

open Git review

open Database Designer

focus Browser URL

resume agent

accept/reject review

Keyboard hints should use compact monospace labels.

25. Command Palette

The command palette is a cross-product navigation and action layer.

It should search:

commands

workspaces

panes

agents

files

Git actions

database entities

memory entities

missions

settings

Appearance:

centered or upper-centered transient surface

restrained shadow

strong search focus

dense result rows

keyboard-first selection

26. Feedback and Status

26.1 Toasts

Toasts are for transient confirmation, not critical workflow state.

Examples:

copied

saved

workspace restored

update downloaded

Do not use toasts for:

unresolved permission

failed mission

merge conflict

agent blocked

destructive failure

Those belong in persistent state surfaces.

26.2 Progress

Long-running operations should expose:

current stage

progress when measurable

elapsed state where useful

cancel/stop if safe

failure reason

retry path

Avoid indeterminate spinners for operations that can expose better state.

27. Loading and Skeletons

Use skeletons only when layout is predictable.

Do not skeletonize terminals, editors, or complex canvases unnecessarily.

For quick native operations, preserve prior state and update incrementally.

Avoid full-screen loading surfaces after the workspace has opened.

28. Error Design

Errors must be actionable.

Bad:

Something went wrong.

Good:

Agent could not start

Claude CLI was not found in the configured environment.

[ Re-check ] [ Open Settings ]

Errors should provide:

what failed

likely scope

useful cause

safe next action

diagnostic access when appropriate

29. Design System Component Contracts

The following primitives should be centrally implemented and reused.

Foundations

Text

Icon

Badge

StatusDot

Divider

Kbd

Tooltip

Progress

Spinner

Controls

Button

IconButton

Input

Textarea

Select

Checkbox

Radio

SegmentedControl

Toggle

Stepper

SearchInput

Navigation

SidebarSection

SidebarRow

Tabs

Breadcrumb

CommandPalette

ContextMenu

Workbench

Pane

PaneHeader

PaneTabs

PaneToolbar

PaneBody

PaneStatusBar

SplitView

ResizablePane

WorkspaceGrid

Feedback

Toast

InlineAlert

Banner

Dialog

ConfirmationDialog

EmptyState

Data

DataTable

Tree

PropertyRow

InspectorSection

VirtualList

Teams should not create parallel versions of these primitives inside feature folders.

30. React / Tauri Engineering Rules

30.1 UI state

Separate:

backend persisted state

backend live state

frontend application state

ephemeral interaction state

Do not make pane focus, hover, or menu state round-trip through Tauri commands.

Do not duplicate authoritative backend domain state in multiple React stores.

30.2 Rendering

High-frequency data such as:

terminal output

logs

agent streaming events

file trees

large diffs

memory results

database nodes

must be optimized for incremental rendering.

Use:

memoization only where measured

virtualization for long lists

batching

event coalescing

stable IDs

selective state subscriptions

Avoid whole-workspace rerenders.

30.3 Resize behavior

Every resizable pane must define:

minimum size

collapse behavior

restore behavior

persistence

nested split constraints

Resize must remain responsive during drag.

Do not persist every mousemove synchronously to SQLite.

Persist after bounded debounce or drag completion.

30.4 Multi-window

Detached windows must retain the same design system.

Do not create a visually separate "secondary window theme."

Requirements:

same tokens

same pane primitives

same focus semantics

same status indicators

synchronized authoritative state

independent ephemeral focus state

31. Performance Budgets

UI quality includes latency.

Targets:

hover response: effectively immediate

pane focus: <50ms perceived

tab switch: <100ms perceived when state already loaded

sidebar selection: <100ms perceived

command palette opening: <100ms perceived

split resize: 60fps target

terminal input echo: immediate

large lists: virtualized where needed

Do not add motion that hides slow state updates.

Fix the state update.

32. High-DPI and Large Monitor Rules

Paralith is frequently used on high-resolution development setups.

The UI must remain usable at:

100%

125%

150%

175%

200%

Windows display scaling must be tested explicitly.

Do not solve large-screen readability by globally enlarging everything.

Instead provide:

coherent type scale

sensible density

user-selectable density if needed

scalable terminal/editor font sizes

bounded content widths for forms

expansive artifact canvases

33. Responsive Desktop Behavior

Paralith is a desktop app, but panes still need responsive behavior.

When horizontal space decreases:

reduce optional metadata

collapse low-priority toolbar labels

move actions into overflow

collapse inspectors

preserve artifact

preserve primary action

never shrink controls below usable dimensions

Do not simply scale the UI down.

34. Design Review Checklist

A feature is not complete until its UI passes these questions.

Structure

Does the artifact dominate?

Are there unnecessary cards?

Are panes using shared primitives?

Is hierarchy obvious without color?

Visual

Are neutral surfaces doing most of the work?

Is accent usage restrained?

Are borders subtle and consistent?

Are radii within the system?

Are shadows justified?

Typography

Is important text readable?

Is metadata visually subordinate?

Are labels consistent?

Are technical values using monospace where useful?

Interaction

Is keyboard navigation possible?

Is focus visible?

Are destructive actions explicit?

Is loading understandable?

Are errors actionable?

State

Is active pane clear?

Is selected item clear?

Is attention state clear?

Are status colors semantically correct?

Performance

Does the surface rerender excessively?

Are large lists virtualized?

Is resize smooth?

Are terminal streams efficient?

If the answer to any critical question is no, the feature is not design-complete.

35. Anti-Patterns — Reject in Review

The following patterns should normally be rejected:

glassmorphism

neon borders

glowing cards

giant gradients

excessive rounded rectangles

large dashboard statistic cards inside work surfaces

oversized icon containers

random feature-specific color palettes

inconsistent button families

multiple primary actions competing in one region

modal-heavy workflows

nested scrolling where avoidable

tiny low-contrast text for important content

hover-only discoverability for critical actions

full-screen loading during ordinary workspace activity

agent status represented only through decorative animation

unbounded animation

arbitrary spacing values

feature-local duplicate design primitives

bright colored role badges everywhere

marketing-style illustrations inside operational views

visual changes that alter established information architecture without product justification

36. Implementation Strategy

The design system should be introduced incrementally without destabilizing the product.

Phase 1 — Foundations

Create / standardize:

tokens

typography

spacing

borders

radius

semantic state

focus treatment

motion

base controls

No feature redesign yet.

Phase 2 — Workbench primitives

Standardize:

pane

pane header

tabs

toolbar

split views

resizable layouts

sidebar rows

status states

command surfaces

Phase 3 — Highest-leverage surfaces

Refactor in this order:

workspace shell

sidebar

terminal grid

Browser / Editor pane chrome

Swarm

Mission Control

Git / Review

Database Designer

Memory

remaining settings/secondary surfaces

Phase 4 — Quality pass

Validate:

keyboard

focus

high-DPI

contrast

Windows scaling

multi-monitor

resize

motion

performance

empty/error/loading states

37. Visual Regression Policy

UI refactors must be reviewed visually.

For important surfaces, maintain deterministic screenshots for:

default state

selected state

hover/focus state where practical

loading

error

empty state

dense content state

narrow width

high-DPI equivalent

When possible, automated visual regression should detect accidental drift.

38. Design Ownership

This file is the canonical design contract.

When a new design pattern is needed:

verify an existing primitive cannot solve it

define the new pattern semantically

ensure it fits the genome

implement centrally if reusable

update this file

then use it in the feature

Do not allow design language to fork silently between teams or agents.

39. Agent Implementation Rules

AI coding agents working inside Paralith must treat this file as a required implementation constraint.

Before modifying UI, an agent must:

inspect this file

inspect existing design primitives

reuse primitives before creating new ones

preserve existing information architecture unless explicitly asked to change it

avoid visual redesign outside task scope

validate the result in the running desktop app

check keyboard/focus/error/empty states

run relevant tests/builds

provide evidence of what changed

Agents must not:

introduce a new color palette

introduce a new radius system

create feature-local button families

add glass/glow/neon styling

redesign navigation without explicit instruction

push or publish changes unless explicitly commanded by the user/repository policy

40. Product Identity Summary

The final Paralith experience should feel like a single, coherent engineering workstation.

The visual language is:

dark neutral canvas

flat pane architecture

hairline separators

compact controls

micro typography

semantic state

restrained accent

strong negative space

dense operational information

artifact-first composition

precise interaction

native desktop behavior

The product should never need visual noise to communicate power.

Paralith should look powerful because the system is powerful.

41. Final Decision Rule

When choosing between two UI directions, prefer the one that:

shows more useful engineering information,

introduces less visual noise,

preserves clearer hierarchy,

uses fewer decorative surfaces,

improves operational understanding,

remains fast under real workloads,

stays consistent with the rest of Paralith.

If a design looks impressive in a screenshot but becomes slower, noisier, harder to navigate, or less predictable during real software engineering work, reject it.

End of canonical design specification.