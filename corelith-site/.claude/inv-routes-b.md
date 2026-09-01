# RoutesB inventory (scout output, persisted 2026-08-30)

All 9 routes are server components; the ONLY client component is ProjectForm (embedded by start-a-project with no props). No route uses next/image, dynamic params, generateStaticParams, or generateMetadata — all use static `metadata` exports except not-found (none). PageHead used by 7 of 9 (start-a-project rolls its own hero; not-found is a bare section). Inline styles throughout: borderColor var(--hair)/var(--hair-strong) on every border-t/b element, --d stagger `i*50/60ms` cast React.CSSProperties, --bloom-x/y/x2/y2 in PageHead, scrollMarginTop 112px + var(--hair) in LegalBody, backgroundColor var(--surface) + left -9999px in ProjectForm.

## research
Metadata title 'Research', canonical /research. PageHead(index '—', datum Research, measure `${research.length} active areas / no published papers yet`). Band ground → raw .shell mapping `research` (company.ts, 5 items; slug/index/title/grounding/question/body) to article id={slug} rows lg:grid-cols-12 4/8: left span.index + h2 --step-sub + p.mono-plain grounding; right question (--step-lead) + body max-w-62ch. Band recessed → Rail —/Publication → SectionHead(eyebrow 'What is not here', heading 'No papers, benchmarks or datasets yet.', long lead) + flex CTA row: Link /products/paralith btn-secondary; mailto site.email.general?subject=Research btn-secondary + Arrow. Primitives: PageHead, Arrow, Band, Rail, SectionHead. Anchors #slug consumed by insights /research#slug links.

## company
PageHead(lead=philosophy.body[0], measure=`${site.presence} / ${site.legal.entity}`) + 4 Rail'd bands (01 Position philosophy.heading+body[1]; 02 Standards dl of principles 5/7; 03 Record ol of timeline 3/4/5 with --d stagger; 04 Technology sm:2 lg:4 grid of technology groups) + ground-tight 3-card closer (Products pulls paralith.wordmark/category/facts[0].value + GoLink /products/paralith; Research GoLink; Careers GoLink) + btn row (start-a-project primary, mailto press secondary). Longest route.

## careers
PageHead + Rail 01 operating md:grid-cols-2 cards + Rail 02 open roles — roles is [] today so the empty branch (openApplication heading/body + hardcoded 'What to send' 3-list + mailto btn) always renders; non-empty branch builds /careers/${slug} Link rows, dormant.

## insights
PageHead + Band ground with `insights.length === 0 ? emptyState : null` — empty state only branch (h2 'Nothing published yet.', CTAs to /research + /work/paralith, hardcoded categories list w/ 0 counts, research.slice(0,2) as GoLink /research#slug) + recessed-tight closer w/ mailto link; populated branch renders null (gap).

## contact
PageHead + Rail 01 Channels (4 hardcoded channel objects {id,index,heading,body,email,action?} mapped to 4/8 grid rows, ids double as anchors e.g. /contact#security; action link hand-rolls .link-go+.go-well markup instead of GoLink) + Rail 02 Location SectionHead only.

## start-a-project
Custom on-ground hero + Band ground>Rail 01 Intake><ProjectForm/> + Band recessed tight 3 hardcoded reassurance cards. ProjectForm is mailto-based (no fetch): zod intakeSchema client-side validate, builds mailto:${site.email.general}?subject&body, sent-state panel replaces form; 8 Row fields (name, email, company+Optional, 4 selects from lib/intake arrays, message textarea) all className='field', off-canvas honeypot 'website'.

## privacy / terms
Thin wrappers: PageHead + single Band ground + LegalBody sections={[hardcoded {heading, body[]}]} — 6 sections (privacy) / 7 sections (terms), all copy page-local, only email/domain/date interpolated from site. LegalBody: sticky TOC nav (col 3) + numbered sections (col 9) w/ scrollMarginTop 112px, reveal class, index spans, max-w-[68ch] body.

## not-found
No metadata/PageHead/Band: section.on-ground min-h-70vh, shell lg:12 grid — left(7): index 404 + mono label, h1 --step-page 'That page is not here.', lead, nav mapping top-level `nav` (5 items) as border-t Link rows with hover-translate Arrow; right(5): FieldStatic SVG (fieldElevation('reduced') circles, currentColor + accent-marked points, clamp-sized 200-380px).
