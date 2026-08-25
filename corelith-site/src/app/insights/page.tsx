import type { Metadata } from "next";
import Link from "next/link";
import { insights, research } from "@/content/company";
import { site } from "@/content/site";
import { PageHead } from "@/components/PageHead";
import { Arrow, Band, GoLink } from "@/components/primitives";

export const metadata: Metadata = {
  title: "Insights",
  description:
    "Writing from Corelith Technologies on engineering, research, product and design.",
  alternates: { canonical: "/insights" },
};

const categories = ["Engineering", "Research", "Product", "Design", "Company"];

export default function InsightsPage() {
  return (
    <>
      <PageHead
        index="—"
        datum="Insights"
        title="Writing from the work."
        lead="Notes on engineering decisions, research findings and the things we got wrong. Published when there is something specific to say."
        measure={`${insights.length} published`}
      />

      <Band tone="ground">
        <div className="shell">
          {insights.length === 0 ? (
            // An empty state is an invitation, not an apology. It says what the
            // section is for and where the equivalent material already lives.
            <div className="grid grid-cols-1 gap-x-16 gap-y-10 lg:grid-cols-12">
              <div className="lg:col-span-6">
                <h2 className="text-[length:var(--step-head)]">Nothing published yet.</h2>
                <p className="mt-6 max-w-[46ch] text-[length:var(--step-lead)] leading-[1.5] text-[var(--ink-2)]">
                  We would rather publish nothing than publish something generic. The first pieces
                  will come out of work that is already running: what the agent runtime taught us
                  about bounded loops, and why project memory had to stop being a transcript.
                </p>
                <p className="mt-6 max-w-[46ch] text-[var(--ink-2)]">
                  Until then, the research page carries the same thinking in shorter form, and the
                  Paralith case study carries the decisions in full.
                </p>
                <div className="mt-9 flex flex-wrap gap-3">
                  <Link href="/research" className="btn btn-primary">
                    Read the research
                    <Arrow />
                  </Link>
                  <Link href="/work/paralith" className="btn btn-secondary">
                    Read the case study
                  </Link>
                </div>
              </div>

              <div className="lg:col-span-6">
                <p className="mono text-[var(--ink-3)]">Planned categories</p>
                <ul className="mt-5">
                  {categories.map((category) => (
                    <li
                      key={category}
                      className="flex items-baseline justify-between gap-4 border-t py-4"
                      style={{ borderColor: "var(--hair)" }}
                    >
                      <span className="text-[16px] text-[var(--ink-2)]">{category}</span>
                      <span className="mono text-[var(--ink-3)]">0</span>
                    </li>
                  ))}
                  <li className="border-t" style={{ borderColor: "var(--hair)" }} />
                </ul>

                <p className="mono text-[var(--ink-3)] mt-10">In progress</p>
                <ul className="mt-5">
                  {research.slice(0, 2).map((item) => (
                    <li key={item.slug} className="border-t py-4" style={{ borderColor: "var(--hair)" }}>
                      <GoLink href={`/research#${item.slug}`}>{item.title}</GoLink>
                    </li>
                  ))}
                  <li className="border-t" style={{ borderColor: "var(--hair)" }} />
                </ul>
              </div>
            </div>
          ) : null}
        </div>
      </Band>

      <Band tone="recessed" tight>
        <div className="shell grid grid-cols-1 gap-x-16 gap-y-6 lg:grid-cols-12">
          <h2 className="text-[length:var(--step-head)] lg:col-span-5">
            Want to hear when something lands?
          </h2>
          <p className="text-[var(--ink-2)] lg:col-span-7">
            There is no mailing list yet — we would rather not collect addresses for a newsletter
            that does not exist. Write to{" "}
            <a href={`mailto:${site.email.general}`} className="link text-[var(--ink)]">
              {site.email.general}
            </a>{" "}
            and we will tell you when the first piece is out.
          </p>
        </div>
      </Band>
    </>
  );
}
