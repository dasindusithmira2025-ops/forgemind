import type { Metadata } from "next";
import Link from "next/link";
import { site } from "@/content/site";
import { PageHead } from "@/components/PageHead";
import { Arrow, Band, Rail, SectionHead } from "@/components/primitives";

export const metadata: Metadata = {
  title: "Contact",
  description:
    "How to reach Corelith Technologies: project enquiries, security disclosure, careers and press.",
  alternates: { canonical: "/contact" },
};

const channels = [
  {
    id: "projects",
    index: "01",
    heading: "New projects",
    body: "Work you want built. The intake form gets you a more useful first reply, but a plain email is equally welcome.",
    email: site.email.general,
    action: { label: "Start a project", href: "/start-a-project" },
  },
  {
    id: "security",
    index: "02",
    heading: "Security disclosure",
    body: "Report a vulnerability in Paralith or in anything Corelith operates. Include steps to reproduce, the affected version, and how you found it. We acknowledge within one working day and agree the public timing with you before anything is published.",
    email: site.email.security,
  },
  {
    id: "careers",
    index: "03",
    heading: "Careers",
    body: "Send something you built and what you were responsible for in it. We read every one, including when nothing is open.",
    email: site.email.careers,
    action: { label: "How we work", href: "/careers" },
  },
  {
    id: "press",
    index: "04",
    heading: "Press",
    body: "Questions about Corelith or Paralith. We will not confirm anything we cannot show you.",
    email: site.email.press,
  },
];

export default function ContactPage() {
  return (
    <>
      <PageHead
        index="—"
        datum="Contact"
        title="Four ways in."
        lead="Pick the one that matches what you need. They all reach people who can answer rather than a shared inbox that routes."
        measure={site.presence}
      />

      <Band tone="ground">
        <Rail index="01" datum="Channels">
          {channels.map((channel) => (
            <div
              key={channel.id}
              id={channel.id}
              className="reveal grid grid-cols-1 gap-x-12 gap-y-4 border-t py-9 md:grid-cols-12"
              style={{ borderColor: "var(--hair-strong)" }}
            >
              <div className="md:col-span-4">
                <span className="index">{channel.index}</span>
                <h2 className="mt-3 text-[length:var(--step-sub)] leading-[1.15]">
                  {channel.heading}
                </h2>
              </div>
              <div className="md:col-span-8">
                <p className="max-w-[62ch] text-[var(--ink-2)]">{channel.body}</p>
                <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-3">
                  <a
                    href={`mailto:${channel.email}`}
                    className="mono-plain text-[15px] text-[var(--ink)] underline underline-offset-4"
                  >
                    {channel.email}
                  </a>
                  {channel.action ? (
                    <Link href={channel.action.href} className="link-go">
                      <span>{channel.action.label}</span>
                      <span className="go-well" aria-hidden="true">
                        <Arrow />
                      </span>
                    </Link>
                  ) : null}
                </div>
              </div>
            </div>
          ))}
          <div className="border-t" style={{ borderColor: "var(--hair-strong)" }} />
        </Rail>
      </Band>

      <Band tone="recessed" tight>
        <Rail index="02" datum="Location">
          <SectionHead
            eyebrow="Where we are"
            heading="Distributed, and honest about it."
            lead="Corelith does not have a public office, so there is no address on this page. Work happens across timezones with written specs and long asynchronous stretches, which is also how we run client engagements."
          />
        </Rail>
      </Band>
    </>
  );
}
