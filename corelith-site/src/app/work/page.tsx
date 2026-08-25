import type { Metadata } from "next";
import Link from "next/link";
import { caseStudies, clientWorkNote } from "@/content/work";
import { PageHead } from "@/components/PageHead";
import { Arrow, Band, GoLink } from "@/components/primitives";
import Image from "next/image";
import paralithPoster from "@/../public/media/paralith-showcase-poster.jpg";

export const metadata: Metadata = {
  title: "Work",
  description:
    "Systems Corelith Technologies has designed, built and shipped. Every entry states plainly whether it is a client engagement or Corelith's own product.",
  alternates: { canonical: "/work" },
};

export default function WorkPage() {
  return (
    <>
      <PageHead
        index="—"
        datum="Work"
        title="What we have built."
        lead="Each entry states whose project it is. Corelith's own products are labelled as products; nothing internal is presented as a client engagement."
        measure={`${caseStudies.length} published / client work under agreement`}
      />

      <Band tone="ground">
        <div className="shell">
          {caseStudies.map((study) => (
            <article key={study.slug} className="reveal">
              <Link href={`/work/${study.slug}`} className="group block">
                <div
                  className="flex flex-wrap items-baseline gap-x-5 gap-y-3 border-b pb-6"
                  style={{ borderColor: "var(--hair-strong)" }}
                >
                  <span className="index">{study.index}</span>
                  <h2 className="text-[length:var(--step-page)] leading-[0.95]">{study.name}</h2>
                  <span className="tag tag-accent">{study.kindLabel}</span>
                  <span className="mono ml-auto text-[var(--ink-3)]">{study.year}</span>
                </div>

                <div className="mt-10 grid grid-cols-1 gap-x-16 gap-y-10 lg:grid-cols-12">
                  <div className="lg:col-span-5">
                    <p className="text-[length:var(--step-lead)] leading-[1.45] text-[var(--ink)]">
                      {study.descriptor}
                    </p>
                    <p className="mt-5 text-[var(--ink-2)]">{study.brief}</p>
                    <ul className="mt-8 flex flex-wrap gap-2">
                      {study.disciplines.map((discipline) => (
                        <li key={discipline} className="tag">
                          {discipline}
                        </li>
                      ))}
                    </ul>
                    <span className="link-go mt-9">
                      <span>Read the case study</span>
                      <span className="go-well" aria-hidden="true">
                        <Arrow />
                      </span>
                    </span>
                  </div>

                  {/* The project itself. A work index that introduces a piece
                      of software with an abstract graphic is hiding the one
                      thing the reader came for. */}
                  <div
                    className="overflow-hidden border lg:col-span-7"
                    style={{ borderColor: "var(--hair)", borderRadius: "var(--r-md)" }}
                  >
                    <Image
                      src={paralithPoster}
                      alt={`${study.name}: ${study.descriptor}`}
                      className="block aspect-[16/10] w-full object-cover"
                      sizes="(min-width: 1100px) 56vw, 92vw"
                      placeholder="blur"
                    />
                  </div>
                </div>
              </Link>
            </article>
          ))}
        </div>
      </Band>

      <Band tone="recessed" tight>
        <div className="shell grid grid-cols-1 gap-x-16 gap-y-6 lg:grid-cols-12">
          <h2 className="text-[length:var(--step-head)] lg:col-span-5">{clientWorkNote.heading}</h2>
          <div className="lg:col-span-7">
            <p className="text-[length:var(--step-lead)] leading-[1.5] text-[var(--ink-2)]">
              {clientWorkNote.body}
            </p>
            <GoLink href="/start-a-project" className="mt-8">
              Talk to us about your project
            </GoLink>
          </div>
        </div>
      </Band>
    </>
  );
}
