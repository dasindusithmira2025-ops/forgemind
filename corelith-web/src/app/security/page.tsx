import { Metadata } from 'next';
import Link from 'next/link';
import { securityData } from '@/data/security';
import { siteConfig } from '@/config/site';
import { Band, PageMasthead, SectionMark } from '@/components/Editorial';

export const metadata: Metadata = {
  title: 'Security & Trust Center',
  description:
    'How Corelith Technologies handles your data: your code stays on your machine, telemetry is off by default, releases are signed, and vulnerabilities are disclosed responsibly.',
};

const DATA_MATRIX = [
  {
    subject: 'Your code',
    posture: 'Stays on your machine',
    detail:
      'Your files and everything Paralith learns about your project stay on your device. None of it is uploaded, and none of it is used to train anything.',
  },
  {
    subject: 'Crash reports',
    posture: 'Off unless you allow it',
    detail:
      'Nothing is sent without your say-so, and what does go strips out file paths, secrets, and anything else tied to your machine.',
  },
  {
    subject: 'Downloads',
    posture: 'Signed and checksummed',
    detail:
      'Every release is signed and published with its checksum, so you can confirm the file is genuine before you install it.',
  },
];

export default function SecurityPage() {
  return (
    <>
      <PageMasthead
        kicker="Security & trust center"
        title={
          <>
            Security by design. <span className="flare">Privacy</span> by default.
          </>
        }
        deck={securityData.description}
        meta={[
          { key: 'Your code', value: 'Never leaves', accent: true },
          { key: 'Telemetry', value: 'Off by default' },
          { key: 'Downloads', value: 'Signed' },
          { key: 'Disclosure', value: 'Coordinated' },
        ]}
      />

      {/* ── Principles ───────────────────────────────────────────────────── */}
      <Band tone="paper-2" divider>
        <SectionMark
          index="01"
          kicker="Posture"
          title="Four commitments we hold to."
          deck="Each one is enforced in the product rather than asserted in a policy document."
        />

        <div className="mt-14 grid grid-cols-1 overflow-hidden rounded-lg border border-[var(--hair-strong)] md:grid-cols-2">
          {securityData.principles.map((p) => (
            <article
              key={p.title}
              className="flex flex-col gap-4 border-r border-b border-[var(--hair)] p-7 transition-colors hover:bg-[rgba(245,237,224,0.03)]"
            >
              <h3 className="max-w-[20ch] text-lg text-[var(--fg)]">{p.title}</h3>
              <p className="border-t border-[var(--hair)] pt-4 text-base text-[var(--fg-soft)]">
                {p.description}
              </p>
            </article>
          ))}
        </div>
      </Band>

      {/* ── Data handling ────────────────────────────────────────────────── */}
      <Band tone="paper">
        <SectionMark
          index="02"
          kicker="Data handling"
          title="Where everything actually goes."
          deck="Three things people ask about, answered plainly."
        />

        <div className="mt-14 border-t border-[var(--hair-strong)]">
          {DATA_MATRIX.map((row) => (
            <div
              key={row.subject}
              className="grid grid-cols-12 gap-x-8 gap-y-3 border-b border-[var(--hair)] py-8"
            >
              <h3 className="col-span-12 text-lg text-[var(--fg)] lg:col-span-3">{row.subject}</h3>
              <p className="stamp col-span-12 self-center text-[var(--kicker)] lg:col-span-3">
                {row.posture}
              </p>
              <p className="col-span-12 text-base text-[var(--fg-soft)] lg:col-span-5 lg:col-start-8">
                {row.detail}
              </p>
            </div>
          ))}
        </div>
      </Band>

      {/* ── Disclosure ───────────────────────────────────────────────────── */}
      <Band tone="paper-2" id="disclosure" className="scroll-mt-24" divider>
        <SectionMark
          index="03"
          kicker="Coordinated disclosure"
          title="Found something? Tell us."
          deck="We acknowledge every report within 24 hours and coordinate the advisory with you before it goes public."
        />

        <div className="mt-14 grid grid-cols-12 gap-x-8 gap-y-12">
          <ol className="col-span-12 lg:col-span-7">
            {securityData.reportingProcess.map((step, i) => (
              <li
                key={step}
                className="flex gap-6 border-b border-[var(--hair)] py-5 first:border-t"
              >
                <span aria-hidden="true" className="numeral text-ink shrink-0 text-xl">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <span className="text-base">{step}</span>
              </li>
            ))}
          </ol>

          <div className="col-span-12 lg:col-span-4 lg:col-start-9">
            <div className="panel p-7">
              <p className="stamp text-ember-ink">Security contact</p>
              <a
                href={`mailto:${siteConfig.securityEmail}`}
                className="text-ink hover:text-ember-ink mt-4 block font-mono text-sm break-all underline decoration-1 underline-offset-4 transition-colors"
              >
                {siteConfig.securityEmail}
              </a>
              <p className="text-ink-soft mt-6 border-t border-[var(--hair)] pt-4 text-sm">
                Include reproduction steps, affected versions, and proof-of-concept logs. Encrypted
                mail is welcome.
              </p>
              <Link href="/contact" className="btn btn-secondary mt-6 w-full">
                General inquiry form
              </Link>
            </div>
          </div>
        </div>
      </Band>
    </>
  );
}
