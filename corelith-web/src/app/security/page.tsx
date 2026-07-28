import { Metadata } from 'next';
import Link from 'next/link';
import { securityData } from '@/data/security';
import { siteConfig } from '@/config/site';
import { Band, PageMasthead, SectionMark } from '@/components/Editorial';

export const metadata: Metadata = {
  title: 'Security & Trust Center',
  description:
    'Corelith Technologies security architecture, secure-by-default design, least privilege, data handling transparency, and responsible vulnerability disclosure policy.',
};

const DATA_MATRIX = [
  {
    subject: 'Source code & AST',
    posture: 'Local only',
    detail:
      'Source files and AST indices stay on your machine. They are never uploaded to a public training corpus.',
  },
  {
    subject: 'Telemetry & crash logs',
    posture: 'Opt-in, anonymised',
    detail:
      'Crash reports require explicit consent and strip local paths, secrets, and environment tokens before leaving the device.',
  },
  {
    subject: 'Release artifacts',
    posture: 'Signed & checksummed',
    detail:
      'Binaries are signed and published with SHA-256 hashes so the artifact can be verified offline before it runs.',
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
          { key: 'Code', value: 'Local only', accent: true },
          { key: 'Transport', value: 'TLS 1.3' },
          { key: 'Storage', value: 'AES-256-GCM' },
          { key: 'Disclosure', value: 'Coordinated' },
        ]}
      />

      {/* ── Principles ───────────────────────────────────────────────────── */}
      <Band tone="panel" divider>
        <SectionMark
          index="01"
          kicker="Posture"
          title="Four commitments we hold to."
          deck="Each one is enforced in the product rather than asserted in a policy document."
        />

        <div className="mt-14 grid grid-cols-1 overflow-hidden rounded-lg border border-[var(--hair-strong)] md:grid-cols-2">
          {securityData.principles.map((p, i) => (
            <article
              key={p.title}
              className="flex flex-col gap-4 border-r border-b border-[var(--hair)] p-7 transition-colors hover:bg-white/[0.025]"
            >
              <div className="flex items-start justify-between gap-4">
                <h3 className="max-w-[20ch] text-lg text-[var(--fg)]">{p.title}</h3>
                <span aria-hidden="true" className="numeral text-[var(--fg)] text-xl">
                  {String(i + 1).padStart(2, '0')}
                </span>
              </div>
              <p className="border-t border-[var(--hair)] pt-4 text-base text-[var(--fg-soft)]">
                {p.description}
              </p>
            </article>
          ))}
        </div>
      </Band>

      {/* ── Data handling ────────────────────────────────────────────────── */}
      <Band tone="void">
        <SectionMark
          index="02"
          kicker="Data handling"
          title="Where everything actually goes."
          deck="Three categories of data, stated plainly, with the posture that applies to each."
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
      <Band tone="panel" id="disclosure" className="scroll-mt-24" divider>
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
                <span aria-hidden="true" className="numeral text-lume shrink-0 text-xl">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <span className="text-base">{step}</span>
              </li>
            ))}
          </ol>

          <div className="col-span-12 lg:col-span-4 lg:col-start-9">
            <div className="panel p-7">
              <p className="stamp text-iris-lift">Security contact</p>
              <a
                href={`mailto:${siteConfig.securityEmail}`}
                className="text-lume hover:text-iris-lift mt-4 block font-mono text-sm break-all underline decoration-1 underline-offset-4 transition-colors"
              >
                {siteConfig.securityEmail}
              </a>
              <p className="text-mute mt-6 border-t border-[var(--hair)] pt-4 text-sm">
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
