# RoutesA inventory (scout output, persisted 2026-08-30)

Architecture: Next.js 16 App Router pages — server components by default; dynamic [slug] routes (work/[slug], capabilities/[slug]) use Promise-based params, generateStaticParams from content arrays, per-slug generateMetadata. Client interactivity isolated in named leaf components under src/components (ProductFilm, CapabilitySystem, ProcessSystem, three.js CorelithField/CapabilityCore with dynamic ssr:false imports + SVG fallbacks). Content = typed modules in src/content. Layout grammar: Band(ground/recessed)+shell; home uses SectionIntro, interior pages PageHead+Rail+SectionHead; reveals are class-staggered via --d inline custom properties; borders use inline borderColor token styles.

## home (src/app/page.tsx)
No metadata export; 10 sections: Hero (CorelithField parallax + bloom), Statement, Capabilities (CapabilitySystem), SelectedWork (paralith-poster.png plate + caseStudies[0] editorial grid), Services (6-capability link list), HowWeBuild (ProcessSystem), Products (ProductFilm 4k promo), Research (ResearchTraces SVG + 3 items), Principles grid, ClosingCta. Primitives: Band/Em/EmLight/GoLink/SectionIntro/Arrow. Content: site, capabilities, caseStudies, clientWorkNote, paralith, philosophy, principles, research. Inline --d delays + 3 hand-rolled --bloom-* divs; delay() module helper.

## work index (src/app/work/page.tsx)
Static metadata w/ canonical /work. PageHead (index='—', datum='Work', measure=count). caseStudies map: full-card Link articles (header row index/name/tag-accent kindLabel/mono year; 12-col: descriptor+brief+tags+inlined link-go / Image paralith-showcase-poster.jpg aspect-16/10). Recessed tight clientWorkNote band. Primitives: Arrow/Band/GoLink. No client components, no three.js.

## work/[slug] (src/app/work/[slug]/page.tsx)
generateStaticParams from caseStudies; async generateMetadata + await params; notFound(). Title block (on-ground border-b, h1 --step-hero, dl kindLabel/year/disciplines), numbered Rail sequence 01-06: Context, Problem (md:2col), Decisions (ol 12-col rows), Architecture (dl md:2col), conditional ProductFilm when slug==='paralith' (paralith-showcase.mp4), Outcome (dl md:3col big values), Lessons (ul); closing band w/ paralith.wordmark + GoLink + btn pair. Inline --d staggers with React.CSSProperties casts. Primitives: Arrow/Band/GoLink/Rail/SectionHead.

## products index (src/app/products/page.tsx)
Static metadata w/ canonical /products. PageHead (index='—', datum='Products', measure=count). products map: col-5 wordmark (--step-page font-display) + tag-accent status + mono category + brief + GoLink; col-7 dl facts grid-cols-2 rows + Platforms row (border-t border-b, name + state.toLowerCase()). Recessed tight 'More is in development' band w/ btn-secondary to /research. No client components, no images.

## products/paralith (src/app/products/paralith/page.tsx)
Literal route, no generateStaticParams. metadata description=paralith.brief. Bloom-lit hero (h1 wordmark --step-hero tracking-tight, tag status, mailto?subject=Paralith btn-primary + /work/paralith btn-secondary), ProductFilm (showcase.mp4, default object-cover), facts strip (grid-cols-2 md:grid-cols-5), Rail 01-03: What it does (pillars md:2col, SectionHead lead=paralith.full), Availability (platforms sm:3col w/ conditional inline state color + signed-updates sub-section), Built with (stack tags + case-study GoLink + mailto btn).

## capabilities index (src/app/capabilities/page.tsx)
Static metadata w/ canonical /capabilities. PageHead (index='—', measure='6 capabilities / 1 practice'). capabilities map: articles (border-t --hair-strong, first:border-t-0) col-5 index + h2 --step-head name-as-Link(hover accent) + proposition + GoLink; col-7 mono 'What we build' + builds sm:2col rows. Closing Rail index='—' datum='Next' engagement CTA w/ two buttons. No client components, no images.

## capabilities/[slug] (src/app/capabilities/[slug]/page.tsx)
generateStaticParams from capabilities; async generateMetadata + await params; notFound(). Hero (index-lg + h1 --step-page name, proposition, bloom), viz-panel plate w/ CapabilityCore state={capability.core} + viz-caption, Rail 01-04: Approach (application md:2col), Stack (stack.items sm:2col), Process (process ol rows), Position (position claim + body); closing band: prev/next sibling links + start-a-project btn.
