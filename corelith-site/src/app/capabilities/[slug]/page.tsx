import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { capabilities, capabilityBySlug } from "@/content/capabilities";
import { caseStudies } from "@/content/work";
import { PageHead } from "@/components/PageHead";
import { Arrow, Band, GoLink, Rail, SectionHead } from "@/components/primitives";
import { CapabilityCore } from "@/components/visuals/CapabilityCore";

export function generateStaticParams() {
  return capabilities.map((capability) => ({ slug: capability.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const capability = capabilityBySlug(slug);
  if (!capability) return {};
  return {
    title: capability.name,
    description: capability.proposition,
    alternates: { canonical: `/capabilities/${capability.slug}` },
  };
}

export default async function CapabilityPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const capability = capabilityBySlug(slug);
  if (!capability) notFound();

  const index = capabilities.findIndex((item) => item.slug === capability.slug);
  const next = capabilities[(index + 1) % capabilities.length];
  const study = caseStudies[0];

  return (
    <>
      <PageHead
        index={capability.index}
        datum="Capability"
        title={capability.name}
        lead={capability.proposition}
        measure={`Core state / ${capability.core}`}
        aside={
          /* The which-capability readout: one tick ruler across the six, the
             current ordinal lit. The page has already named itself in words;
             this is the instrument saying the same thing. */
          <ul className="ticks mt-7" aria-hidden="true">
            {capabilities.map((item) => (
              <li key={item.slug} data-on={item.slug === capability.slug ? true : undefined} />
            ))}
          </ul>
        }
      />

      {/* The object in the state this capability actually names, beside the
          deliverables it produces. The two halves are the same argument: this
          is what the transformation means in practice. */}
      <Band tone="ground">
        <Rail index="01" datum="Deliverables">
          <div className="grid grid-cols-1 items-start gap-12 lg:grid-cols-12 lg:gap-16">
            <div className="lg:col-span-7">
              <h2 className="reveal-wipe text-[length:var(--step-head)]">What we build.</h2>
              <ul className="mt-9">
                {capability.builds.map((item, i) => (
                  <li
                    key={item}
                    className="reveal flex items-baseline gap-5 border-t py-4"
                    style={{ borderColor: "var(--hair)", "--d": `${i * 45}ms` } as React.CSSProperties}
                  >
                    <span className="mono shrink-0 text-[var(--ink-3)]">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span className="text-[16px] leading-[1.55] text-[var(--ink-2)]">{item}</span>
                  </li>
                ))}
                <li className="border-t" style={{ borderColor: "var(--hair)" }} />
              </ul>
            </div>

            {/* The core in the arrangement this capability describes. No
                caption: printing the internal state name under the object is a
                debug readout, and the words two columns left already say what
                it means. */}
            <div className="lg:sticky lg:top-28 lg:col-span-5">
              <div className="viz-panel aspect-square w-full max-w-[440px]">
                <CapabilityCore state={capability.core} className="h-full w-full" />
              </div>
            </div>
          </div>
        </Rail>
      </Band>

      {/* Technical surface, grouped. Not a logo wall: the point is which layers
          of a system Corelith works at, not which brands it can name. Each
          group is a machined plate — the one surface in this system that can
          sit in a channel band and still read as raised, so the stack reads
          as the machine's interior rather than a list. */}
      <Band tone="recessed">
        <Rail index="02" datum="Technical surface">
          <SectionHead eyebrow="Stack" heading="Technology follows the problem." className="mb-12" />
          <div className="grid grid-cols-1 gap-x-6 gap-y-6 sm:grid-cols-2 lg:grid-cols-3">
            {capability.stack.map((group, i) => (
              <div
                key={group.heading}
                className="panel reveal p-6"
                style={{ "--d": `${i * 70}ms` } as React.CSSProperties}
              >
                <span className="panel-rim" aria-hidden="true" />
                <h3 className="mono text-[var(--ink-3)]">{group.heading}</h3>
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

      <Band tone="ground">
        <Rail index="03" datum="Application">
          <SectionHead
            eyebrow="Where this shows up"
            heading="Three situations we get called into."
            className="mb-12"
          />
          <div className="grid grid-cols-1 gap-x-12 gap-y-10 md:grid-cols-2">
            {capability.application.map((item, i) => (
              <div
                key={item.heading}
                className="reveal border-t pt-6"
                style={{ borderColor: "var(--hair-strong)", "--d": `${i * 70}ms` } as React.CSSProperties}
              >
                <h3 className="text-[length:var(--step-sub)] leading-[1.15]">{item.heading}</h3>
                <p className="mt-4 text-[15px] leading-[1.6] text-[var(--ink-2)]">{item.body}</p>
              </div>
            ))}
          </div>
        </Rail>
      </Band>

      <Band tone="ground" tight>
        <Rail index="04" datum="Process">
          <SectionHead eyebrow="How the work runs" heading="In this order." className="mb-12" />
          <ol>
            {capability.process.map((step, i) => (
              <li
                key={step.step}
                className="reveal grid grid-cols-1 gap-x-12 gap-y-3 border-t py-7 md:grid-cols-12"
                style={{ borderColor: "var(--hair)", "--d": `${i * 60}ms` } as React.CSSProperties}
              >
                <span className="index md:col-span-1">{String(i + 1).padStart(2, "0")}</span>
                <h3 className="text-[length:var(--step-sub)] leading-[1.15] md:col-span-4">
                  {step.step}
                </h3>
                <p className="text-[15px] leading-[1.6] text-[var(--ink-2)] md:col-span-7">
                  {step.body}
                </p>
              </li>
            ))}
            <li className="border-t" style={{ borderColor: "var(--hair)" }} />
          </ol>
        </Rail>
      </Band>

      {/* The position. One claim per capability, argued rather than asserted —
          this is the section that has to prove there is a point of view here. */}
      <Band tone="ground">
        <div className="shell">
          <div className="grid grid-cols-1 gap-x-16 gap-y-8 lg:grid-cols-12">
            <p className="mono text-[var(--ink-3)] lg:col-span-12">Our position</p>
            <h2 className="reveal-wipe text-[length:var(--step-page)] lg:col-span-6">
              {capability.position.claim}
            </h2>
            <p className="reveal self-end text-[length:var(--step-lead)] leading-[1.5] text-[var(--ink-2)] lg:col-span-6">
              {capability.position.body}
            </p>
          </div>
        </div>
      </Band>

      <Band tone="ground" tight>
        <div className="shell grid grid-cols-1 gap-10 md:grid-cols-12">
          <div className="md:col-span-6">
            <p className="mono text-[var(--ink-3)]">Related work</p>
            <h2 className="mt-4 text-[length:var(--step-sub)]">{study.name}</h2>
            <p className="mt-3 max-w-[42ch] text-[15px] leading-[1.6] text-[var(--ink-2)]">
              {study.brief}
            </p>
            <GoLink href={`/work/${study.slug}`} className="mt-6">
              Read the case study
            </GoLink>
          </div>

          <div className="md:col-span-6 md:text-right">
            <p className="mono text-[var(--ink-3)]">Next capability</p>
            <h2 className="mt-4 text-[length:var(--step-sub)]">
              <Link
                href={`/capabilities/${next.slug}`}
                className="transition-colors duration-[320ms] hover:text-[var(--accent)]"
              >
                {next.name}
              </Link>
            </h2>
            <p className="mt-3 text-[15px] leading-[1.6] text-[var(--ink-2)] md:ml-auto md:max-w-[42ch]">
              {next.brief}
            </p>
          </div>
        </div>

        <div className="shell mt-14 flex flex-wrap gap-3">
          <Link href="/start-a-project" className="btn btn-primary">
            Start a project
            <Arrow />
          </Link>
          <Link href="/capabilities" className="btn btn-secondary">
            All capabilities
          </Link>
        </div>
      </Band>
    </>
  );
}
