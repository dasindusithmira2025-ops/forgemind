# The Paralith UI genome

This is the set of rules that make every route, window, popover and pane read as one product. It
is deliberately short. If a rule here conflicts with something a component wants to do, the rule
wins — the point of a genome is that it is not negotiable per feature.

The genome was derived from a study of [stablyai/orca](https://github.com/stablyai/orca), an
Electron ADE built on shadcn/ui `new-york-v4` with the `neutral` base colour. Orca is the closest
public reference for the product category Paralith competes in, and its visual language solves the
same problem: an agent workbench is mostly *someone else's* colour — terminal output, syntax
highlighting, diff hunks, CI status. Chrome that also wants to be colourful turns the window into
noise.

Paralith does not use Tailwind or shadcn. The genome was re-expressed in our own semantic token
layer (`src/theme/tokens.ts` → `src/index.css`), which is why there is no `tailwind.config` here
and no `components/ui` directory.

---

## Where the genome lives

| Layer | File | What it owns |
| --- | --- | --- |
| Token *shape* | `src/theme/tokens.ts` | The semantic groups a theme must fill in, and the single mapping from those groups to `--*` custom properties |
| Token *values* | `src/theme/themes.ts` | The five concrete palettes |
| Metrics + rules | `src/index.css` | Type scale, control ladder, radius ladder, spacing, motion, and every component rule |
| Runtime | `src/theme/applyTheme.ts` | Writes the resolved palette as inline custom properties on `<html>` |
| First paint | `index.html` | Replays the cached palette before React mounts, so a cold start never flashes |

Component rules consume tokens. They never introduce a hex value, an `rgba()`, or a `px` font size
— there are currently zero such literals outside the `:root` fallback block, and the theme test
suite is what keeps it that way.

---

## The eight rules

### 1. Surfaces are achromatic

Canvas → card → raised → overlay is a pure neutral luminance ladder. Nothing in the chrome is
tinted toward the accent.

```
canvas    #0a0a0a   the application root, the terminal canvas
card      #171717   panels, the sidebar, dialogs
raised    #1f1f1f   one step up: nested panels, popovers, menus
overlay   #262626   the top neutral: chips, badges, segmented tracks, active headers
```

Only four steps. A fifth surface always turns out to be one of these four plus a border.

**Interaction fills sit above the ladder, not inside it** — hover `#2e2e2e`, pressed `#383838`,
selected `#454545`. A hover can land on *any* of the four surfaces, so it has to clear all of them.
Reusing an overlay value as the hover fill is the specific mistake that makes hover look fine on a
row and vanish on a chip, a count badge, or the active pane header; the
`keeps every interaction fill visible on every surface it can be painted on` test exists purely to
stop that recurring.

### 2. Dividers are an alpha wash, never an opaque grey

```css
--border:        rgb(255 255 255 / 0.07);
--border-subtle: rgb(255 255 255 / 0.045);
--border-strong: rgb(255 255 255 / 0.15);
```

An opaque grey divider can only be correct on one surface. Tuned to look right on the canvas it
disappears on a popover; tuned for the popover it reads as a heavy line on the canvas. A
translucent wash of the foreground is correct on all four steps at once, which is why one value
can serve the whole app. On light themes the same rule inverts to an alpha *black* wash.

The `draws dividers as an alpha wash` test enforces this.

### 3. Solid controls are achromatic

The highest-emphasis button in the app is a near-white fill (`--primary: #e5e5e5`) with near-black
text — not the brand accent.

This is the rule most likely to feel wrong on first read, and it is the one that matters most. A
purple Save button is fine on a screen with one Save button. On a swarm screen with a primary
action per role, per phase and per pane, an accented primary means the accent is everywhere, and
an accent that is everywhere has stopped being a signal. Neutral primaries keep the strongest
colour on the screen pointing at *state* — a failing check, a blocked agent, a conflicted file.

`--primary` is capped at a channel spread of 14/255 by the `keeps solid controls achromatic` test,
which leaves room for the deliberately cool (zinc) and warm (stone) neutral ramps without letting
a real hue in.

### 4. Selection is neutral; the accent is an edge

Hover, selected and pressed are steps on the same neutral ladder (`#262626` → `#363636` →
`#2e2e2e`). The accent appears as the 2px **state edge** on the active entity and essentially
nowhere else in the chrome.

### 5. Focus is neutral too

```css
--focus-shadow: 0 0 0 3px color-mix(in srgb, var(--ring) 50%, transparent);
```

A soft 3px ring in a mid-grey (`--ring`), not a hard accent outline. An accent focus ring makes an
accented control look permanently focused; a neutral one always reads as "the keyboard is here".
The `keeps the focus ring neutral` test pins both the hue and the fact that `effects.focusRing`
and `control.ring` cannot drift apart.

### 6. Chroma is spent only on meaning

Every colour left in the app answers a question the user actually asked:

| Family | Question it answers |
| --- | --- |
| `--status-*` | Is this agent working, waiting, blocked? |
| `--git-*` | What happened to this file? |
| `--agent-*` | Which provider is this? |
| `--proof-*` | Is this evidence verified? |
| `--role-*` | Which role is this swarm node? |
| `--risk-*` | How dangerous is this capability? |
| `--diff-*` | Added or removed? |

Identity colours (`agent`, `role`) are used at icon and dot scale only. A provider colour must
never fill a region large enough to read as the app's own accent.

Role hues come from the IBM colourblind-safe set — blue `#648fff`, indigo `#785ef0`, magenta
`#dc267f`, orange `#fe6100`, amber `#ffb000`, teal `#40b0a6`. Roles are *identity*, not status, so
they are also deliberately not green/amber/red: a green Scout must never read as a healthy Scout.

### 7. Four control heights, five radii, one type scale

```
control   24 / 32 / 36 / 40 px      (xs / sm / default / lg)
radius     6 /  8 / 10 / 14 px      (sm / house / popover / dialog)
type      11 / 12 / 13 / 14 / 16 / 18 / 24 px
```

Every control in the app resolves to one of the four heights. There is no 34px button. The three
`data-density` modes shift the whole ladder together, and `--ui-scale` multiplies it — neither one
introduces a new step.

`--radius: 8px` is the house radius: buttons, inputs, selected rows. Popovers and menus step up to
10, dialogs and cards to 14.

### 8. The typeface is Geist, bundled

`src/assets/fonts/Geist-Variable.woff2` (SIL OFL 1.1, Vercel), loaded via `@font-face` rather than
a CDN so a desktop app renders identically offline and on first paint.

Geist is drawn tighter than Segoe UI, so the genome carries three tracking tokens:
`--tracking-ui: .01em` on body text, `--tracking-label: .05em` on uppercase micro-labels, and
`--tracking-display: -.02em` on headings. Monospace stays a system stack so terminal and editor
glyph metrics match what the OS ships.

---

## The sidebar IA, cloned from Orca

The genome above governs *colour*. The sidebar additionally clones Orca's **information
architecture** (`src/renderer/src/components/sidebar/index.tsx`): four fixed bands around exactly
one scroll region.

| Band | Ours | Orca's |
| --- | --- | --- |
| Nav | `SidebarNav` — Search, Repository | `SidebarNav` — Tasks, Automations, Agents, Mobile, Search |
| List header | `SidebarListHeader` — title + groupBy/sort + Project + New | `SidebarHeader` — title + options + Add Project + New |
| List | `WorkspaceListSection` — Workspaces across every open Project | `WorktreeList` — worktrees across every repo |
| Toolbar | `SidebarToolbar` — brand, scroll-to-active, Diagnostics, Settings, Collapse | `SidebarToolbar` — profile, settings/help, scroll-to-current, board |

Three ideas carry it, and all three are worth preserving:

1. **Destinations are separated from entities.** Everything above the list header is a route;
   everything below it is a thing you work in. A nav row without a real destination teaches the
   user that the whole band is decorative, so rows are only added when the route already exists.
2. **The title names the grouping.** "Projects" vs "Workspaces" is the one-word answer to why the
   list is shaped the way it is — it is state, not a caption.
3. **One row grammar.** Nav rows, list rows and group headers resolve to the same shape: icon at
   `--faint`, label at `--muted`, active gaining a neutral surface and `--text-strong`. Per rule 4
   the accent appears only as the 2px state edge on the focused Project.

Where we diverge: Orca's list holds one entity type, so its scroll region is a single list. Ours
also carries Swarms and detached Workspaces, which stay as sibling `SidebarGroup`s below the
Workspace list rather than being flattened into it or demoted to nav rows that would lose their
per-row actions.

---

## Where Paralith deliberately differs from Orca

| | Orca | Paralith | Why |
| --- | --- | --- | --- |
| Secondary hover | `bg-secondary/80` — darkens on dark themes | `--secondary-hover`, one step lighter | A hover that moves *away* from the pointer reads as a disable, not a hover |
| Scrollbar thumb | Square, 12px gutter | Same | — |
| Accent | `--accent` is the neutral hover fill; violet lives in `--ai-action-accent` | `--accent` is the violet state hue; the neutral fill is `--surface-hover` | Paralith already had a state-edge system built on `--accent`; renaming it would have touched every feature for no visual gain |
| Type | Tailwind's 12/14/16 | 11/12/13/14/16/18/24 | Paralith's sidebar and status bar are denser than Orca's and need the 11 and 13 steps |
| Popover surface | Same as `card` and `sidebar` | One step above `card` on dark themes | Our single Project popover opens directly over the sidebar; sharing the surface leaves the menu carried entirely by a 7%-alpha border |
| Light canvas | Pure white behind white cards | `#f7f7f7` behind white cards | A dense tool with a dozen panels needs its panel edges to read without relying on borders alone |
| Editor surface | `#1e1e1e` on a `#0a0a0a` app | Same | Code is read for minutes at a time; near-black behind syntax colour crushes the low-luminance tokens |

---

## Changing the genome

1. Add or change values in `src/theme/themes.ts`.
2. If the *shape* changed, update `SemanticColors` and `toCssVars` in `src/theme/tokens.ts`, add
   the new names to `REQUIRED_CSS_VARS`, and add matching fallbacks to the `:root` block in
   `src/index.css`. A test fails if those two lists drift.
3. Bump `TOKEN_REVISION` in `src/theme/applyTheme.ts` **and** the matching literal in
   `index.html`. Without it, an upgraded install replays the previous palette from its localStorage
   cache for one frame before React corrects it. A test fails if the two literals drift.
4. Run `npm test` — the `design genome` suite enforces rules 1, 2, 3, 5 and 6 directly, including
   the interaction-fill separation described under rule 1.
