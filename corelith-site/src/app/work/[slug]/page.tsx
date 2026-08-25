import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { caseStudies, caseStudyBySlug } from "@/content/work";
import { paralith } from "@/content/products";
import { Arrow, Band, GoLink, Rail, SectionHead } from "@/components/primitives";
import { ProductFilm } from "@/components/ProductFilm";
import paralithPoster from "../../../../public/media/paralith-showcase-poster.jpg";

export function generateStaticParams() {
  return caseStudies.map((study) => ({ slug: study.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const study = caseStudyBySlug(slug);
  if (!study) return {};
  return {
    title: `${study.name} — case study`,
    description: study.brief,
    alternates: { canonical: `/work/${study.slug}` },
  };
}

export default async function CaseStudyPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const study = caseStudyBySlug(slug);
  if (!study) notFound();

  return (
    <>
      {/* A case study opens with its title block, the way a drawing set does:
          what it is, whose it is, when, and what disciplines it covers. */}
      <section className="on-ground border-b" style={{ borderColor: "var(--hair)" }}>
        <div className="shell pt-[clamp(40px,6vw,80px)] pb-[clamp(48px,6vw,88px)]">
          <div className="flex items-baseline gap-4">
            <span className="index">{study.index}</span>
            <span className="mono text-[var(--ink-3)]">Case study</span>
          </div>

          <h1 className="reveal-wipe mt-8 text-[length:var(--step-hero)] leading-[0.94]">
            {study.name}
          </h1>

          <div className="mt-8 grid grid-cols-1 gap-x-16 gap-y-8 lg:grid-cols-12">
            <p className="reveal text-[length:var(--step-lead)] leading-[1.45] text-[var(--ink)] lg:col-span-7">
              {study.descriptor}
            </p>
            <dl className="reveal grid grid-cols-2 gap-x-8 gap-y-5 lg:col-span-5">
              <div>
                <dt className="mono text-[var(--ink-3)]">Project type</dt>
                <dd className="mt-1.5 text-[15px] text-[var(--ink)]">{study.kindLabel}</dd>
              </div>
              <div>
                <dt className="mono text-[var(--ink-3)]">Year</dt>
                <dd className="mono-plain mt-1.5 text-[15px] text-[var(--ink)]">{study.year}</dd>
              </div>
              <div className="col-span-2">
                <dt className="mono text-[var(--ink-3)]">Disciplines</dt>
                <dd className="mt-2 flex flex-wrap gap-2">
                  {study.disciplines.map((discipline) => (
                    <span key={discipline} className="tag">
                      {discipline}
                    </span>
                  ))}
                </dd>
              </div>
            </dl>
          </div>
        </div>
      </section>

      <Band tone="ground">
        <Rail index="01" datum="Context">
          <p className="reveal max-w-[62ch] text-[length:var(--step-sub)] leading-[1.4] tracking-[-0.01em] text-[var(--ink)]">
            {study.context}
          </p>
        </Rail>
      </Band>

      <Band tone="recessed">
        <Rail index="02" datum="Problem">
          <SectionHead eyebrow="What was wrong" heading="Four structural problems." className="mb-12" />
          <div className="grid grid-cols-1 gap-x-12 gap-y-9 md:grid-cols-2">
            {study.problem.map((item, i) => (
              <div
                key={item.heading}
                className="reveal border-t pt-6"
                style={{ borderColor: "var(--hair-strong)", "--d": `${i * 60}ms` } as React.CSSProperties}
              >
                <span className="index">{String(i + 1).padStart(2, "0")}</span>
                <h3 className="mt-3 text-[length:var(--step-sub)] leading-[1.15]">{item.heading}</h3>
                <p className="mt-4 text-[15px] leading-[1.6] text-[var(--ink-2)]">{item.body}</p>
              </div>
            ))}
          </div>
        </Rail>
      </Band>

      <Band tone="ground">
        <Rail index="03" datum="Decisions">
          <SectionHead
            eyebrow="What we decided"
            heading="The decisions everything else followed from."
            lead="Listed in the order they were made, because each one narrowed what the next could be."
            className="mb-12"
          />
          <ol>
            {study.decisions.map((decision, i) => (
              <li
                key={decision.title}
                className="reveal grid grid-cols-1 gap-x-12 gap-y-3 border-t py-8 md:grid-cols-12"
                style={{ borderColor: "var(--hair)", "--d": `${i * 55}ms` } as React.CSSProperties}
              >
                <span className="index md:col-span-1">{String(i + 1).padStart(2, "0")}</span>
                <h3 className="text-[length:var(--step-sub)] leading-[1.15] md:col-span-5">
                  {decision.title}
                </h3>
                <p className="text-[15px] leading-[1.6] text-[var(--ink-2)] md:col-span-6">
                  {decision.body}
                </p>
              </li>
            ))}
            <li className="border-t" style={{ borderColor: "var(--hair)" }} />
          </ol>
        </Rail>
      </Band>

      <Band tone="ground" tight>
        <Rail index="04" datum="Architecture">
          <SectionHead eyebrow="How it is built" heading="Four layers." className="mb-12" />
          <dl className="grid grid-cols-1 gap-x-12 md:grid-cols-2">
            {study.architecture.map((layer, i) => (
              <div
                key={layer.layer}
                className="reveal border-t py-7"
                style={{ borderColor: "var(--hair-strong)", "--d": `${i * 55}ms` } as React.CSSProperties}
              >
                <dt className="flex items-baseline gap-4">
                  <span className="index">{String(i + 1).padStart(2, "0")}</span>
                  <span className="font-display text-[length:var(--step-sub)] leading-[1.15] font-semibold tracking-[-0.028em]">
                    {layer.layer}
                  </span>
                </dt>
                <dd className="mt-4 text-[15px] leading-[1.6] text-[var(--ink-2)]">{layer.body}</dd>
              </div>
            ))}
          </dl>
        </Rail>
      </Band>

      {study.slug === "paralith" ? (
        <Band tone="recessed" tight>
          <div className="shell">
            <p className="mono mb-8 text-[var(--ink-3)]">The product it became</p>
            <ProductFilm
              poster={paralithPoster}
              src="/media/paralith-showcase.mp4"
              captions="/media/paralith-showcase-captions.vtt"
              label="Paralith — product film"
            />
          </div>
        </Band>
      ) : null}

      <Band tone="ground">
        <Rail index="05" datum="Outcome">
          <SectionHead
            eyebrow="Where it stands"
            heading="What can be checked."
            lead="Facts about the shipped system rather than a summary of how it went."
            className="mb-12"
          />
          <dl className="grid grid-cols-1 gap-x-12 gap-y-8 md:grid-cols-3">
            {study.outcome.map((item, i) => (
              <div
                key={item.label}
                className="reveal border-t pt-6"
                style={{ borderColor: "var(--hair-strong)", "--d": `${i * 70}ms` } as React.CSSProperties}
              >
                <dt className="mono text-[var(--ink-3)]">{item.label}</dt>
                <dd className="font-display mt-4 text-[length:var(--step-head)] leading-none font-semibold tracking-[-0.028em] text-[var(--ink)]">
                  {item.value}
                </dd>
                <dd className="mt-4 text-[15px] leading-[1.6] text-[var(--ink-2)]">{item.note}</dd>
              </div>
            ))}
          </dl>
        </Rail>
      </Band>

      <Band tone="recessed">
        <Rail index="06" datum="Lessons">
          <SectionHead eyebrow="What we took from it" heading="Four things worth keeping." className="mb-10" />
          <ul>
            {study.lessons.map((lesson, i) => (
              <li
                key={lesson}
                className="reveal flex items-baseline gap-6 border-t py-6"
                style={{ borderColor: "var(--hair)", "--d": `${i * 55}ms` } as React.CSSProperties}
              >
                <span className="index shrink-0">{String(i + 1).padStart(2, "0")}</span>
                <p className="max-w-[70ch] text-[length:var(--step-lead)] leading-[1.5] text-[var(--ink)]">
                  {lesson}
                </p>
              </li>
            ))}
            <li className="border-t" style={{ borderColor: "var(--hair)" }} />
          </ul>
        </Rail>
      </Band>

      <Band tone="ground" tight>
        <div className="shell flex flex-col gap-8 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="mono text-[var(--ink-3)]">The product</p>
            <h2 className="mt-4 text-[length:var(--step-head)]">{paralith.wordmark}</h2>
            <GoLink href="/products/paralith" className="mt-6">
              Explore Paralith
            </GoLink>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link href="/start-a-project" className="btn btn-primary">
              Start a project
              <Arrow />
            </Link>
            <Link href="/work" className="btn btn-secondary">
              All work
            </Link>
          </div>
        </div>
      </Band>
    </>
  );
}
