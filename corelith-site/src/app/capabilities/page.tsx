import type { Metadata } from "next";
import Link from "next/link";
import { capabilities } from "@/content/capabilities";
import { PageHead } from "@/components/PageHead";
import { Arrow, Band, GoLink, Rail, SectionHead } from "@/components/primitives";

export const metadata: Metadata = {
  title: "Capabilities",
  description:
    "The six things Corelith Technologies is hired to build: product engineering, AI systems, automation, experience engineering, infrastructure and technology strategy.",
  alternates: { canonical: "/capabilities" },
};

export default function CapabilitiesPage() {
  return (
    <>
      <PageHead
        index="—"
        datum="Capabilities"
        title="What Corelith is hired to build."
        lead="Six capabilities. They are sold separately because that is how work arrives, and delivered together because that is how systems actually behave."
        measure={`${capabilities.length} capabilities / 1 practice`}
      />

      <Band tone="ground">
        <div className="shell">
          {/* Each capability gets its whole argument here rather than a card:
              the proposition, what is delivered, and the position that
              distinguishes it. A reader deciding whether to make contact needs
              the argument, not a summary of it. The builds sit in one recessed
              bay per article — a readout well under the argument, the same cut
              on every one, so the six articles read as one instrument. */}
          {capabilities.map((capability) => (
            <article
              key={capability.slug}
              className="reveal border-t py-[clamp(40px,5vw,72px)] first:border-t-0 first:pt-0"
              style={{ borderColor: "var(--hair-strong)" }}
            >
              <div className="grid grid-cols-1 gap-x-16 gap-y-8 lg:grid-cols-12">
                <div className="lg:col-span-5">
                  <span className="index">{capability.index}</span>
                  <h2 className="mt-4 text-[length:var(--step-head)]">
                    <Link
                      href={`/capabilities/${capability.slug}`}
                      className="transition-colors duration-[320ms] hover:text-[var(--accent)]"
                    >
                      {capability.name}
                    </Link>
                  </h2>
                  <p className="mt-6 max-w-[42ch] text-[length:var(--step-lead)] leading-[1.5] text-[var(--ink-2)]">
                    {capability.proposition}
                  </p>
                  <GoLink href={`/capabilities/${capability.slug}`} className="mt-8">
                    {capability.name}
                  </GoLink>
                </div>

                <div className="lg:col-span-7">
                  <div className="bay p-6 sm:p-7">
                    <p className="mono text-[var(--ink-3)]">What we build</p>
                    <ul className="mt-5 grid grid-cols-1 gap-x-10 sm:grid-cols-2">
                      {capability.builds.map((item) => (
                        <li
                          key={item}
                          className="border-t py-3.5 text-[15px] leading-[1.5] text-[var(--ink-2)]"
                          style={{ borderColor: "var(--hair)" }}
                        >
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            </article>
          ))}
        </div>
      </Band>

      <Band tone="recessed">
        <Rail index="—" datum="Next">
          <SectionHead
            eyebrow="Engagements"
            heading="Not sure which one this is?"
            lead="Most projects are two or three of these at once, and working out which is part of the work. Describe the problem and we will tell you what it actually needs."
          />
          <div className="mt-10 flex flex-wrap gap-3">
            <Link href="/start-a-project" className="btn btn-primary">
              Start a project
              <Arrow />
            </Link>
            <Link href="/work" className="btn btn-secondary">
              See the work
            </Link>
          </div>
        </Rail>
      </Band>
    </>
  );
}
