import type { Metadata } from "next";
import Link from "next/link";
import { paralith } from "@/content/products";
import { site } from "@/content/site";
import { Arrow, Band, GoLink, Rail, SectionHead } from "@/components/primitives";
import { ProductFilm } from "@/components/ProductFilm";
import paralithPoster from "../../../../public/media/paralith-showcase-poster.jpg";

export const metadata: Metadata = {
  title: "Paralith — agentic development environment",
  description: paralith.brief,
  alternates: { canonical: "/products/paralith" },
};

export default function ParalithPage() {
  return (
    <>
      {/* The product, shown. This is the one page on the site where Corelith
          is not the subject, so it opens with the software running rather than
          with an abstract object standing in for it. */}
      <section className="on-ground relative overflow-hidden">
        <div
          className="bloom"
          aria-hidden="true"
          style={{ "--bloom-x": "52%", "--bloom-y": "-30%", "--bloom-x2": "-12%", "--bloom-y2": "48%" } as React.CSSProperties}
        />
        <div className="shell lit pt-[clamp(40px,6vw,84px)] pb-[clamp(56px,7vw,104px)]">
          <div className="grid grid-cols-1 items-end gap-x-16 gap-y-10 lg:grid-cols-12">
            <div className="lg:col-span-7">
              <div className="flex items-center gap-3">
                <span className="mono text-[var(--ink-3)]">Corelith product</span>
                <span className="tag tag-accent">{paralith.status}</span>
              </div>

              <h1 className="reveal-wipe font-display mt-7 text-[length:var(--step-hero)] leading-[0.92] font-semibold tracking-[-0.045em]">
                {paralith.wordmark}
              </h1>

              <p className="reveal mt-5 text-[length:var(--step-lead)] text-[var(--accent)]">
                {paralith.category}
              </p>
            </div>

            <div className="lg:col-span-5">
              <p className="reveal max-w-[52ch] text-[length:var(--step-lead)] leading-[1.55] text-[var(--ink-2)]">
                {paralith.brief}
              </p>

              <div className="reveal mt-9 flex flex-wrap gap-3">
                <a href={`mailto:${site.email.general}?subject=Paralith`} className="btn btn-primary">
                  Ask about access
                  <Arrow />
                </a>
                <Link href="/work/paralith" className="btn btn-secondary">
                  How it was built
                </Link>
              </div>
            </div>
          </div>

          <div className="reveal mt-[clamp(40px,5vw,72px)]">
            <ProductFilm
              poster={paralithPoster}
              src="/media/paralith-showcase.mp4"
              captions="/media/paralith-showcase-captions.vtt"
              label="Paralith — product film"
            />
          </div>

          <dl
            className="mt-12 grid grid-cols-2 gap-x-8 gap-y-6 border-t pt-9 md:grid-cols-5"
            style={{ borderColor: "var(--hair)" }}
          >
            {paralith.facts.map((fact) => (
              <div key={fact.label}>
                <dt className="mono text-[var(--ink-3)]">{fact.label}</dt>
                <dd className="mono-plain mt-2 text-[15px] text-[var(--ink)]">{fact.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <Band tone="ground">
        <Rail index="01" datum="What it does">
          <SectionHead
            eyebrow="Capabilities"
            heading="Six things it does that a chat window cannot."
            lead={paralith.full}
            className="mb-14"
          />

          <div className="grid grid-cols-1 gap-x-12 md:grid-cols-2">
            {paralith.pillars.map((pillar, i) => (
              <div
                key={pillar.title}
                className="reveal border-t py-8"
                style={{ borderColor: "var(--hair)", "--d": `${i * 55}ms` } as React.CSSProperties}
              >
                <span className="index">{String(i + 1).padStart(2, "0")}</span>
                <h3 className="mt-4 text-[length:var(--step-sub)] leading-[1.15]">{pillar.title}</h3>
                <p className="mt-4 max-w-[46ch] text-[15px] leading-[1.6] text-[var(--ink-2)]">
                  {pillar.body}
                </p>
              </div>
            ))}
          </div>
        </Rail>
      </Band>

      <Band tone="recessed">
        <Rail index="02" datum="Availability">
          <SectionHead
            eyebrow="Platforms"
            heading="Windows today."
            lead="Paralith builds, signs and publishes one Stable channel, and that channel is Windows. The other platforms are not released, so they are not offered."
            className="mb-12"
          />

          <ul className="grid grid-cols-1 gap-x-12 sm:grid-cols-3">
            {paralith.platforms.map((platform) => (
              <li
                key={platform.name}
                className="reveal flex items-baseline justify-between gap-4 border-t py-6"
                style={{ borderColor: "var(--hair-strong)" }}
              >
                <span className="font-display text-[length:var(--step-sub)] leading-none font-semibold tracking-[-0.028em]">
                  {platform.name}
                </span>
                <span
                  className="mono"
                  style={{
                    color: platform.state === "Available" ? "var(--ink)" : "var(--ink-3)",
                  }}
                >
                  {platform.state}
                </span>
              </li>
            ))}
          </ul>

          <div className="mt-12 grid grid-cols-1 gap-x-16 gap-y-6 lg:grid-cols-12">
            <h3 className="text-[length:var(--step-sub)] lg:col-span-5">
              Updates are signed and verified.
            </h3>
            <p className="text-[15px] leading-[1.6] text-[var(--ink-2)] lg:col-span-7">
              A release is only reported successful once its artifacts are signed, the Stable
              manifest is activated atomically, and the published checksums have been verified
              against the live endpoint. Internal builds cannot overwrite what Stable installations
              receive — the two channels are structurally separate rather than separated by
              convention.
            </p>
          </div>
        </Rail>
      </Band>

      <Band tone="ground" tight>
        <Rail index="03" datum="Built with">
          <SectionHead eyebrow="Stack" heading="What it runs on." className="mb-10" />
          <ul className="flex flex-wrap gap-2">
            {paralith.stack.map((item) => (
              <li key={item} className="tag">
                {item}
              </li>
            ))}
          </ul>

          <div className="mt-14 flex flex-col gap-8 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="mono text-[var(--ink-3)]">The engineering behind it</p>
              <h3 className="mt-4 text-[length:var(--step-head)]">Read the case study</h3>
              <GoLink href="/work/paralith" className="mt-5">
                Paralith — case study
              </GoLink>
            </div>
            <a href={`mailto:${site.email.general}?subject=Paralith`} className="btn btn-primary">
              Ask about access
              <Arrow />
            </a>
          </div>
        </Rail>
      </Band>
    </>
  );
}
