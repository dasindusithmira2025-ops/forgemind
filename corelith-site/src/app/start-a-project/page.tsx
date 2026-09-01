import type { Metadata } from "next";
import { site } from "@/content/site";
import { Band, Rail } from "@/components/primitives";
import { ProjectForm } from "@/components/ProjectForm";

export const metadata: Metadata = {
  title: "Start a project",
  description:
    "Tell Corelith Technologies what you are trying to build. We will tell you what it takes, what it costs to own, and whether we are the right people for it.",
  alternates: { canonical: "/start-a-project" },
};

export default function StartAProjectPage() {
  return (
    <>
      <section className="on-ground border-b" style={{ borderColor: "var(--hair)" }}>
        <div className="shell pt-[clamp(40px,6vw,80px)] pb-[clamp(40px,5vw,72px)]">
          <div className="flex items-baseline gap-4">
            <span className="index">—</span>
            <span className="mono text-[var(--ink-3)]">Start a project</span>
          </div>

          <h1 className="reveal-wipe mt-8 max-w-[16ch] text-[length:var(--step-page)]">
            What are you trying to build?
          </h1>

          <div className="mt-8 grid grid-cols-1 gap-x-16 gap-y-6 lg:grid-cols-12">
            <p className="reveal text-[length:var(--step-lead)] leading-[1.5] text-[var(--ink-2)] lg:col-span-6">
              Eight questions. They exist so the first reply is useful rather than a list of
              questions back — not so a form can score you before a person reads it.
            </p>
            <p className="reveal text-[var(--ink-2)] lg:col-span-6">
              If you would rather just write, that works too:{" "}
              <a href={`mailto:${site.email.general}`} className="link text-[var(--ink)]">
                {site.email.general}
              </a>
              . It reaches the same people.
            </p>
          </div>
        </div>
      </section>

      <Band tone="ground">
        <Rail index="01" datum="Intake">
          <ProjectForm />
        </Rail>
      </Band>

      {/* What happens to the intake once it is sent. Three claims about the
          reply, each on its own machined plate — the promises sit together on
          the instrument the form belongs to. */}
      <Band tone="recessed" tight>
        <div className="shell grid grid-cols-1 gap-4 gap-y-8 md:grid-cols-3">
          {[
            {
              heading: "A person reads it",
              body: "Someone who could actually build the thing, not a qualification step. If your problem is interesting and small, we will say that rather than inflating it.",
            },
            {
              heading: "You get a real answer",
              body: "What we think it takes, roughly what it costs to own afterwards, and the parts we are unsure about. Including when the answer is that you should not build it.",
            },
            {
              heading: "No sequence follows",
              body: "One reply. If you do not write back, nothing else arrives. Your address is used to answer you and for nothing else.",
            },
          ].map((item, i) => (
            <div
              key={item.heading}
              className="panel panel-hover reveal p-7"
              style={{ "--d": `${i * 60}ms` } as React.CSSProperties}
            >
              <span className="panel-rim" aria-hidden="true" />
              <span className="index">{String(i + 1).padStart(2, "0")}</span>
              <h2 className="mt-3 text-[length:var(--step-sub)] leading-[1.15]">{item.heading}</h2>
              <p className="mt-4 text-[15px] leading-[1.6] text-[var(--ink-2)]">{item.body}</p>
            </div>
          ))}
        </div>
      </Band>
    </>
  );
}
