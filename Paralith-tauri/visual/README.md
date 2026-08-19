# Visual harness

A browser-hosted view of the **real** Paralith screens, for inspecting and screenshotting the
design system without launching the desktop app.

```
npm run visual          # http://localhost:1421/visual/index.html
```

Open the index for a list of surfaces, or go straight to one:

```
/visual/index.html?surface=primitives
/visual/index.html?surface=workspace&theme=arctic-light
/visual/index.html?surface=setup&scale=1.5&density=compact
```

| Param | Values |
| --- | --- |
| `surface` | `primitives`, `launcher`, `workspace`, `setup`, `settings`, `repository`, `database`, `memory`, `swarms` |
| `theme` | any theme id (`paralith-dark`, `graphite`, `obsidian`, `ember`, `arctic-light`) |
| `density` | `comfortable`, `standard`, `compact` |
| `scale` | `--ui-scale` multiplier, e.g. `1.25`, `1.5` — the Windows-scaling rehearsal |

## How it works

`vite.visual.config.ts` aliases every `@tauri-apps/*` module to a stub in this folder, so the real
screens mount in a browser and resolve their IPC calls from `fixtures.ts`. Nothing in `src/` is
modified or duplicated to support this, and `npm run build` never sees any of it — the production
entry is the root `index.html`, which does not reference `visual/`.

Fixtures are keyed by Rust command name. A command with no fixture logs
`[harness] no fixture: <command>` to the console and falls back to an empty shape, which is the
fastest way to find out what a newly-touched screen actually loads.

## `?surface=primitives`

The genome sheet: the surface ladder, the five hairline steps, the four contrast levels, the type
scale, every control tier, the radius ladder and the semantic state set, all on one page. This is
where drift shows up first — a token that has fallen off its ladder is obvious here and invisible
when spread across nine screens.

## Scope

The harness proves *rendering*: geometry, colour, density, contrast, truncation, overflow. It does
not exercise PTYs, agent runtimes, Git, or persistence — those are covered by the unit tests and by
running the real Tauri app. Treat a green harness as necessary, not sufficient.
