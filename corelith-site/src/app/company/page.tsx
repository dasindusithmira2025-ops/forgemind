import type { Metadata } from "next";
import Link from "next/link";
import { philosophy, principles, technology, timeline } from "@/content/company";
import { site } from "@/content/site";
import { paralith } from "@/content/products";
import { PageHead } from "@/components/PageHead";
import { Arrow, Band, GoLink, Rail, SectionHead } from "@/components/primitives";

export const metadata: Metadata = {
  title: "Company",
  description:
    "Corelith Technologies is an engineering company that builds advanced software for clients and develops technology products of its own.",
  alternates: { canonical: "/company" },
};

export default function CompanyPage() {
  return (
    <>
      <PageHead
        index="—"
        datum="Company"
        title="An engineering company with two halves."
        lead={philosophy.body[0]}
        measure={`${site.presence} / ${site.legal.entity}`}
      />

      <Band tone="ground">
        <Rail index="01" datum="Position">
          <h2 className="reveal-wipe max-w-[16ch] text-[length:var(--step-page)]">
            {philosophy.heading}
          </h2>
          <p className="reveal mt-10 max-w-[62ch] text-[length:var(--step-lead)] leading-[1.55] text-[var(--ink-2)]">
            {philosophy.body[1]}
          </p>
        </Rail>
      </Band>

      <Band tone="recessed">
        <Rail index="02" datum="Standards">
          <SectionHead
            eyebrow="Engineering principles"
            heading="What we hold to."
            lead="These are the sentences we actually argue from in a review. They are short because they have to be usable in the moment a decision is being made."
            className="mb-14"
          />

          <dl>
            {principles.map((principle, i) => (
              <div
                key={principle.index}
                className="reveal grid grid-cols-1 gap-x-12 gap-y-3 border-t py-7 md:grid-cols-12"
                style={{ borderColor: "var(--hair)", "--d": `${i * 50}ms` } as React.CSSProperties}
              >
                <dt className="flex items-baseline gap-4 md:col-span-5">
                  <span className="index">{principle.index}</span>
                  <span className="font-display text-[length:var(--step-sub)] leading-[1.15] font-semibold tracking-[-0.028em] text-[var(--ink)]">
                    {principle.claim}
                  </span>
                </dt>
                <dd className="text-[15px] leading-[1.6] text-[var(--ink-2)] md:col-span-7">
                  {principle.body}
                </dd>
              </div>
            ))}
            <div className="border-t" style={{ borderColor: "var(--hair)" }} />
          </dl>
        </Rail>
      </Band>

      {/* A real record, and only that. No funding, no headcount, no awards —
          none of those are established, so none of them are here. */}
      <Band tone="ground">
        <Rail index="03" datum="Record">
          <SectionHead
            eyebrow="Timeline"
            heading="What has actually happened."
            lead="Restricted to events with a record behind them: releases, schema versions, shipped systems."
            className="mb-14"
          />

          <ol className="relative">
            {timeline.map((entry, i) => (
              <li
                key={entry.title}
                className="reveal grid grid-cols-1 gap-x-12 gap-y-3 border-t py-8 md:grid-cols-12"
                style={{ borderColor: "var(--hair-strong)", "--d": `${i * 60}ms` } as React.CSSProperties}
              >
                <div className="flex items-baseline gap-4 md:col-span-3">
                  <span className="mono text-[var(--ink-3)]">{entry.period}</span>
                  <span className="index">{String(i + 1).padStart(2, "0")}</span>
                </div>
                <h3 className="text-[length:var(--step-sub)] leading-[1.15] md:col-span-4">
                  {entry.title}
                </h3>
                <p className="text-[15px] leading-[1.6] text-[var(--ink-2)] md:col-span-5">
                  {entry.body}
                </p>
              </li>
            ))}
            <li className="border-t" style={{ borderColor: "var(--hair-strong)" }} />
          </ol>
        </Rail>
      </Band>

      <Band tone="recessed">
        <Rail index="04" datum="Technology">
          <SectionHead
            eyebrow="What we work with"
            heading="Technology follows the problem."
            lead="Grouped by the layer of a system it belongs to rather than displayed as a wall of logos, because the useful question is which layers we can take responsibility for."
            className="mb-14"
          />

          <div className="grid grid-cols-1 gap-x-12 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
            {technology.map((group) => (
              <div key={group.heading} className="reveal">
                <h3
                  className="mono border-b pb-3 text-[var(--ink-3)]"
                  style={{ borderColor: "var(--hair-strong)" }}
                >
                  {group.heading}
                </h3>
                <ul className="mt-4 flex flex-col gap-2">
                  {group.items.map((item) => (
                    <li key={item} className="text-[16px] text-[var(--ink)]">
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Rail>
      </Band>

      <Band tone="ground" tight>
        <div className="shell grid grid-cols-1 gap-x-12 gap-y-10 md:grid-cols-3">
          <div>
            <p className="mono text-[var(--ink-3)]">Products</p>
            <h2 className="mt-4 text-[length:var(--step-sub)]">{paralith.wordmark}</h2>
            <p className="mt-3 text-[15px] leading-[1.6] text-[var(--ink-2)]">
              {paralith.category}, shipping at {paralith.facts[0].value}.
            </p>
            <GoLink href="/products/paralith" className="mt-5">
              Explore Paralith
            </GoLink>
          </div>
          <div>
            <p className="mono text-[var(--ink-3)]">Research</p>
            <h2 className="mt-4 text-[length:var(--step-sub)]">Open questions</h2>
            <p className="mt-3 text-[15px] leading-[1.6] text-[var(--ink-2)]">
              Agentic engineering, persistent project intelligence, local inference.
            </p>
            <GoLink href="/research" className="mt-5">
              Read the research
            </GoLink>
          </div>
          <div>
            <p className="mono text-[var(--ink-3)]">Careers</p>
            <h2 className="mt-4 text-[length:var(--step-sub)]">Working here</h2>
            <p className="mt-3 text-[15px] leading-[1.6] text-[var(--ink-2)]">
              Small team, whole-distance ownership, evidence over seniority.
            </p>
            <GoLink href="/careers" className="mt-5">
              See careers
            </GoLink>
          </div>
        </div>

        <div className="shell mt-16 flex flex-wrap gap-3">
          <Link href="/start-a-project" className="btn btn-primary">
            Start a project
            <Arrow />
          </Link>
          <a href={`mailto:${site.email.press}`} className="btn btn-secondary">
            Press enquiries
          </a>
        </div>
      </Band>
    </>
  );
}
