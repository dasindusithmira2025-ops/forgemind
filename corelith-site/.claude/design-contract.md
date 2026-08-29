# Corelith Site — "Graphite Instrument" Design Contract
Parent-owned. Read fully before touching any page. Version 1.

## What this revamp is
Full UI revamp of corelith-site. Same content, same routes, same components — a completely new visual system. The site was white-sheet + Corelith blue; it is now a dark precision-instrument control room with one amber signal. The parent has already rewritten the core (globals.css, system.css, layout.tsx, SiteHeader, SiteFooter, primitives.tsx). Do NOT re-edit those files unless your task says so.

## Palette (roles are locked — consume via CSS vars, never hex)
- --ground #101318 (room) / --ground-soft #0B0E12 (channel)
- --surface #161B22 / --surface-2 #1C222B / --surface-3 #222A35 (machined plate ramp)
- --ink #F3F5F8 (16.8:1) / --ink-2 #AAB4C0 / --ink-3 #818D9C
- --accent #FFB224 (instrument amber, 9.4:1) / --accent-strong #FFC75C / --accent-deep #C98A10
- --accent-soft rgba(255,178,36,.14) / --accent-softer .07 / --accent-knockout #191104
- --hair / --hair-strong (white-alpha hairlines) / --edge-light (white .07) / --edge-dark (black .44)
- --viz-point #8F9AA8 / --viz-line rgba(243,245,248,.26) / --viz-surface rgba(34,42,53,.6) — consumed by three.js via palette.ts

## Type (three voices)
- Display: Archivo (var(--font-display)), weight 800, font-stretch 125%, tracking -0.014em — h1..h4 get this via @layer base, so never re-declare family/weight on headings. Signage: wide, heavy, certain.
- Body/labels: Inter (var(--font-sans)).
- Machine values: JetBrains Mono (var(--font-mono)), rationed — versions/identifiers/measurements only. `.mono-plain` uses it. `.mono` (the eyebrow) is SANS, wide-tracked, uppercase.

## Signature devices (use these; do not invent new decoration)
- `.panel` + `<span class="panel-rim"/>`: machined plate with stepped bevel — THE container. Not "card". Ration `.fastener` (corner screw) to at most one panel per page, only where a plate genuinely anchors a composition.
- `.bay`: recessed cut, for form controls and readouts.
- `.tick` (22×2 amber stroke), `.ticks` (ruler rows of 1px strokes, every 5th tall): the graticule language. `.datum-rule`: seam starting amber then fading to hair.
- `.index` now JetBrains Mono amber; `.index-lg` Archivo 700 amber.
- `.on-plate` (footer only): amber plate, dark cut-ink. Never use elsewhere.
- `.em` = amber emphasis phrase; headline pattern is ink → `.em-light` (quiet amber #FFC75C via --accent-strong fallback... actually .em-light reads --accent-light with --accent-strong fallback; prefer plain `.em` for one phrase per headline, `.em-light` sparingly for the middle step).
- Radii: --r-xs 4px … --r-xl 18px. Square-ish. No pill buttons except .note/tag keep r-xs.
- Buttons: `.btn-primary` is now AMBER with knockout ink (the "go" lamp); `.btn-accent` is ink-on-ground inverse (use for closing CTA where the old design used btn-accent); `.btn-secondary` hairline outline.
- Fields: `.field` recessed bay, amber focus ring, error #FF6A4D.
- Reveal classes unchanged: `.reveal`, `.reveal-wipe`, `.reveal-rule` + inline `--d` ms staggers.

## Layout grammar (unchanged structure)
Band(ground|recessed) > shell > Rail(index, datum) > content. PageHead for interior pages. Home uses SectionIntro/SectionHead. Keep every route's existing information architecture and content — you are re-composing surfaces, not rewriting copy. Where the old page used inline `borderColor: var(--hair)` styles, KEEP that pattern (it's deliberate, avoids specificity fights).

## Rules
- NEVER hardcode a hex outside system.css/globals.css. Everything reads role vars. Existing hardcoded JS colors in scenes are handled by the parent's visuals task — do not touch scenes/*, palette.ts, Stage.tsx, field/graph/process/dot/points/rand.
- One `.em` phrase per headline max; display type elsewhere stays ink.
- Keep semantics/accessibility exactly: same headings, aria, focus, reduced-motion behavior, keyboard flows (ProcessSystem tablist, ProjectForm zod+mailto, honeypot, LegalBody sticky TOC).
- Client components stay client; server stay server. Do not add dependencies.
- Do not edit content/*.ts or lib/intake.ts. Do not change routes/metadata URLs (titles/descriptions may stay as-is).
- Images: keep next/image usage and static imports identical (paralith posters). On dark ground, posters keep their own white plates only where the old design used .viz-panel or a bordered figure — panels are fine.
- No new CSS files. Inline styles for borderColor/--d/--bloom-* continue. If you genuinely need a new reusable class, the parent owns system.css — instead use existing utilities/Tailwind arbitrary values reading the vars, e.g. `bg-[var(--surface-2)] border-[var(--hair)] rounded-[var(--r-md)]`.
- Dark ground changes contrast assumptions: old classes that assumed white ground (e.g. .viz-panel's white bloom ::before) are already restyled by the parent. If a page visually relies on an old light-only pattern (e.g. white poster plate with object-contain), keep the poster inside a `.panel` or `.viz-panel` with `bg-white` where the asset needs it (paralith posters are dark-app-friendly; check old usage and keep asset-visible).
- Archivo is WIDE. Long headlines will wrap earlier than Geist did — keep max-w values from the old design; they are sized for this.

## Verify before you yield
- `npx tsc --noEmit` (or rely on parent's typecheck) — must be clean for your files.
- Do NOT run builds, eslint, dev servers, or tests (parent runs them once at the end).
- Re-read your final files once for: leftover old classes (on-close bloom positioning, btn-accent misuse as amber, rounded-full wells), hardcoded hexes, broken imports.
