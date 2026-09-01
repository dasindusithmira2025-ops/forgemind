# SharedMap inventory (scout output, persisted 2026-08-30)

Full source: agent://SharedMap (live artifact). Key facts for builders:

## Palette chain (MUST keep these 5 vars defined in :root)
palette.ts reads --viz-point / --viz-line / --viz-surface / --accent / --ground via getComputedStyle(canvas); FALLBACK (#586274 / rgba(12,20,35,.28) / rgba(255,255,255,.55) / #246bfd) silently applies inside 3D scenes if missing. New globals.css defines all five (amber accent #ffb224). Static SVGs consume var(--accent) + currentColor directly.

Hard-coded colors NOT behind variables (JS edits needed when restyling): FieldScene rim #5b7ba8/#ffffff + body #10161f/#eef1f6; GraphScene hull #93a8c8/#ffffff; ProductFilm overlay rgba(12,14,16,0.28); dot.ts white sprite gradient.

## Content shapes (see agent://SharedMap for full detail)
- site.ts: site{...email{general,security,careers,press}, presence, legal{entity:'Corelith Technologies',updated:'August 2026'}}, nav 5 items (Capabilities w/ 6 children), footerNav 4 columns.
- capabilities.ts: Capability{slug,index,name,brief,proposition,core:CoreState,builds[],stack[],application[],process[],position}; capabilities 6; primaryCapabilities 4 (homepage).
- work.ts: CaseStudy{slug,index,name,kind,kindLabel,year,descriptor,disciplines[],brief,context,problem[],decisions[],architecture[],outcome[],lessons[]}; caseStudies=[paralith]; clientWorkNote.
- products.ts: Product{slug,name,wordmark,category,status,brief,full,facts[],pillars[],platforms[],stack[]}; products=[paralith].
- company.ts: philosophy, principles 6, lifecycle 6 (.state drives ProcessSystem), technology 4, timeline 4, research 5, careers (roles: [] empty), insights (empty).
- lib/intake.ts: projectTypes/projectStages/timelines/budgetBands, zod intakeSchema, honeypot 'website'.

## Shared components
- ProjectForm: client, no props, zod + mailto (site.email.general), 8 Row fields className='field', honeypot off-canvas, sent-state panel. Vars: --hair-strong/--hair/--surface/--ink*/--accent/--step-head/--step-lead.
- ProductFilm: client; props {poster: StaticImageData, posterClassName?, src, captions?, label}; click-to-mount video; btn-primary overlay w/ inline --ink/--ground; figure w/ --hair-strong/--r-md. Consumers: page.tsx, products/paralith, work/[slug].
- LegalBody: server; {sections:{heading,body[]}}; sticky TOC col 3 + numbered sections col 9, scrollMarginTop 112px.
- home/CapabilitySystem: client, no props; 4 capability Items around viz-panel plate w/ CapabilityCore; active: accent name + scaleX rule; vars --hair/--ink-3/--ink-2/--accent/--accent-light/--ease.
- ProcessSystem: client; flat animated SVG viz-panel 160×72, proc-node/proc-edge w/ --i stagger, role=tablist roving keyboard; vars --ink-3/--accent/--hair/--ink/--ink-2/--measure-text/--step-lead.
- ResearchTraces: server-safe static SVG, 38 trajectories, ~3 carry (--accent); vars --accent/--ink-3.
- FieldStatic/CapabilityCoreStatic: server-safe SVG elevations, currentColor + var(--accent).
- Stage/palette/points/dot/rand/field/graph/process: three.js pipeline; geometry unchanged by restyle.
