import { Metadata } from 'next';
import { ContactForm } from '@/components/ContactForm';
import { siteConfig } from '@/config/site';
import { Band, PageMasthead, SectionMark } from '@/components/Editorial';

export const metadata: Metadata = {
  title: 'Contact & Inquiries',
  description:
    'Contact Corelith Technologies for business inquiries, product support, security reports, partnerships, or general information.',
};

const ROUTES = [
  {
    label: 'Enterprise & business',
    email: siteConfig.contactEmail,
    detail: 'Licensing, agency accounts, and enterprise contracts.',
  },
  {
    label: 'Security & trust',
    email: siteConfig.securityEmail,
    detail: 'Coordinated disclosure and vulnerability reports.',
  },
  {
    label: 'Press & media',
    email: siteConfig.pressEmail,
    detail: 'Product announcements and media inquiries.',
  },
];

export default function ContactPage() {
  return (
    <>
      <PageMasthead
        kicker="Contact Corelith Technologies"
        title={
          <>
            Direct <span className="flare">pathways</span>, no switchboard.
          </>
        }
        deck="Reach engineering, product, security, or business directly. Every submission is read by a person."
        meta={[
          { key: 'Response', value: 'Within 24 hours', accent: true },
          { key: 'Routing', value: 'By category' },
          { key: 'Hours', value: 'Async, global' },
          { key: 'Location', value: siteConfig.location },
        ]}
      />

      {/* ── Direct routes ────────────────────────────────────────────────── */}
      <Band tone="paper-2" divider>
        <SectionMark
          index="01"
          kicker="Direct routes"
          title="Skip the form if you know where you are going."
          deck="Three inboxes, each monitored by the team that owns it."
        />

        <div className="mt-14 grid grid-cols-1 gap-5 lg:grid-cols-3">
          {ROUTES.map((route, i) => (
            <article key={route.email} className="panel panel-hover flex flex-col gap-4 p-7">
              <div className="flex items-start justify-between gap-4">
                <p className="stamp max-w-[16ch] text-[var(--kicker)]">{route.label}</p>
                <span aria-hidden="true" className="numeral text-[var(--fg)] text-xl">
                  {String(i + 1).padStart(2, '0')}
                </span>
              </div>

              <a
                href={`mailto:${route.email}`}
                className="text-ink hover:text-ember-ink font-mono text-sm break-all underline decoration-1 underline-offset-4 transition-colors"
              >
                {route.email}
              </a>

              <p className="mt-auto border-t border-[var(--hair)] pt-4 text-sm text-[var(--fg-soft)]">
                {route.detail}
              </p>
            </article>
          ))}
        </div>
      </Band>

      {/* ── Form ─────────────────────────────────────────────────────────── */}
      <Band tone="paper">
        <SectionMark
          index="02"
          kicker="General inquiry"
          title="Tell us what you need."
          deck="Pick a category and we route it to the right desk on arrival."
        />

        <div className="mt-14 grid grid-cols-12">
          <div className="col-span-12 lg:col-span-8 lg:col-start-3">
            <ContactForm />
          </div>
        </div>
      </Band>
    </>
  );
}
