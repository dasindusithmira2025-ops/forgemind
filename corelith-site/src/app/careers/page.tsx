import type { Metadata } from "next";
import Link from "next/link";
import { careers } from "@/content/company";
import { site } from "@/content/site";
import { PageHead } from "@/components/PageHead";
import { Arrow, Band, Rail, SectionHead } from "@/components/primitives";

export const metadata: Metadata = {
  title: "Careers",
  description:
    "How engineering works at Corelith Technologies, and what to send if you want to work here.",
  alternates: { canonical: "/careers" },
};

export default function CareersPage() {
  const open = careers.roles.filter((role) => role);

  return (
    <>
      <PageHead
        index="—"
        datum="Careers"
        title={careers.heading}
        lead={careers.body}
        measure={`${open.length} open roles / applications always read`}
      />

      <Band tone="ground">
        <Rail index="01" datum="How we operate">
          <SectionHead
            eyebrow="Working here"
            heading="Four things that are true of every week."
            className="mb-12"
          />
          <div className="grid grid-cols-1 gap-x-12 gap-y-9 md:grid-cols-2">
            {careers.operating.map((item, i) => (
              <div
                key={item.title}
                className="reveal border-t pt-6"
                style={{ borderColor: "var(--hair-strong)", "--d": `${i * 60}ms` } as React.CSSProperties}
              >
                <span className="index">{String(i + 1).padStart(2, "0")}</span>
                <h3 className="mt-3 text-[length:var(--step-sub)] leading-[1.15]">{item.title}</h3>
                <p className="mt-4 max-w-[46ch] text-[15px] leading-[1.6] text-[var(--ink-2)]">
                  {item.body}
                </p>
              </div>
            ))}
          </div>
        </Rail>
      </Band>

      {/* The honest state. Listing a role that is not open, or a generic
          "we're always hiring", would both be lies with different shapes. */}
      <Band tone="recessed">
        <Rail index="02" datum="Open roles">
          {open.length === 0 ? (
            <div className="grid grid-cols-1 gap-x-16 gap-y-8 lg:grid-cols-12">
              <div className="lg:col-span-5">
                <h2 className="reveal-wipe text-[length:var(--step-head)]">
                  {careers.openApplication.heading}
                </h2>
              </div>
              <div className="lg:col-span-7">
                <p className="text-[length:var(--step-lead)] leading-[1.5] text-[var(--ink-2)]">
                  {careers.openApplication.body}
                </p>

                <div
                  className="mt-10 border-t pt-6"
                  style={{ borderColor: "var(--hair-strong)" }}
                >
                  <p className="mono text-[var(--ink-3)]">What to send</p>
                  <ul className="mt-4 flex flex-col gap-2.5">
                    {[
                      "Something you built, with a link to the code or the running thing.",
                      "What you were responsible for in it, specifically.",
                      "One decision in it you would make differently now, and why.",
                    ].map((item, i) => (
                      <li key={item} className="flex items-baseline gap-4">
                        <span className="mono shrink-0 text-[var(--ink-3)]">
                          {String(i + 1).padStart(2, "0")}
                        </span>
                        <span className="text-[16px] leading-[1.55] text-[var(--ink-2)]">{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <a
                  href={`mailto:${site.email.careers}?subject=Application`}
                  className="btn btn-primary mt-9"
                >
                  {site.email.careers}
                  <Arrow />
                </a>
              </div>
            </div>
          ) : (
            <ul>
              {open.map((role) => (
                <li key={role.slug}>
                  <Link
                    href={`/careers/${role.slug}`}
                    className="group grid grid-cols-1 items-baseline gap-x-8 gap-y-2 border-t py-7 md:grid-cols-12"
                    style={{ borderColor: "var(--hair-strong)" }}
                  >
                    <span className="font-display text-[length:var(--step-sub)] font-semibold tracking-[-0.028em] md:col-span-5">
                      {role.title}
                    </span>
                    <span className="mono text-[var(--ink-3)] md:col-span-3">{role.discipline}</span>
                    <span className="mono text-[var(--ink-3)] md:col-span-3">{role.location}</span>
                    <span className="text-[var(--ink-3)] transition-transform duration-[260ms] group-hover:translate-x-1.5 md:col-span-1 md:justify-self-end">
                      <Arrow />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Rail>
      </Band>

      <Band tone="ground" tight>
        <div className="shell grid grid-cols-1 gap-x-16 gap-y-6 lg:grid-cols-12">
          <h2 className="text-[length:var(--step-head)] lg:col-span-5">
            Not looking for a job, but interested?
          </h2>
          <div className="lg:col-span-7">
            <p className="text-[var(--ink-2)]">
              We also work with people on defined pieces of engineering rather than employment. If
              that is closer to what you want, say so in the same email — it is the same inbox and
              the same question: what have you built, and what were you responsible for.
            </p>
            <Link href="/capabilities" className="btn btn-secondary mt-8">
              See what we work on
            </Link>
          </div>
        </div>
      </Band>
    </>
  );
}
