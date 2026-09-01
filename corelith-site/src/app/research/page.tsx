import type { Metadata } from "next";
import Link from "next/link";
import { research } from "@/content/company";
import { site } from "@/content/site";
import { PageHead } from "@/components/PageHead";
import { Arrow, Band, Rail, SectionHead } from "@/components/primitives";

export const metadata: Metadata = {
  title: "Research",
  description:
    "Open questions Corelith Technologies is working on in agentic software engineering, persistent project intelligence, autonomous development systems, local AI and human–AI collaboration.",
  alternates: { canonical: "/research" },
};

export default function ResearchPage() {
  return (
    <>
      <PageHead
        index="—"
        datum="Research"
        title="Open questions, grounded in systems we run."
        lead="Everything here came out of building something. Each entry names the question, what we currently think, and which running system the work is grounded in."
        measure={`${research.length} active areas / no published papers yet`}
      />

      {/* Set as a publication rather than a card grid: the question is the
          headline, because the question is the contribution at this stage. */}
      <Band tone="ground">
        <div className="shell">
          {research.map((item) => (
            <article
              key={item.slug}
              id={item.slug}
              className="reveal grid grid-cols-1 gap-x-16 gap-y-6 border-t py-[clamp(36px,4vw,64px)] first:border-t-0 first:pt-0 lg:grid-cols-12"
              style={{ borderColor: "var(--hair-strong)" }}
            >
              {/* The grounding column, cut as a readout bay: the plate a
                  measured value sits on, not a card around the content. */}
              <div className="lg:col-span-4">
                <span className="index">{item.index}</span>
                <h2 className="mt-4 text-[length:var(--step-sub)] leading-[1.15]">{item.title}</h2>
                <div className="bay mt-6 max-w-[38ch] p-4">
                  <p className="mono-plain text-[var(--ink-2)]">{item.grounding}</p>
                </div>
              </div>

              <div className="lg:col-span-8">
                <p className="text-[length:var(--step-lead)] leading-[1.4] tracking-[-0.01em] text-[var(--ink)]">
                  {item.question}
                </p>
                <p className="mt-6 max-w-[62ch] text-[var(--ink-2)]">{item.body}</p>
              </div>
            </article>
          ))}
        </div>
      </Band>

      {/* Stated rather than implied. A research page with no output is only
          dishonest if it pretends otherwise. */}
      <Band tone="recessed">
        <Rail index="—" datum="Publication">
          <SectionHead
            eyebrow="What is not here"
            heading="No papers, benchmarks or datasets yet."
            lead="Corelith has not published research output. What exists is working code and the questions it raised. When there are results worth reading — a benchmark, a written finding, a released prototype — they will appear here with the method attached."
          />
          <div className="mt-10 flex flex-wrap gap-3">
            <Link href="/products/paralith" className="btn btn-secondary">
              See the system this comes from
            </Link>
            <a href={`mailto:${site.email.general}?subject=Research`} className="btn btn-secondary">
              Talk to us about it
              <Arrow />
            </a>
          </div>
        </Rail>
      </Band>
    </>
  );
}
