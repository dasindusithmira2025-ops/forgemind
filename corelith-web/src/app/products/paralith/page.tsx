import { Metadata } from 'next';
import Link from 'next/link';
import { products } from '@/data/products';
import { DownloadSelector } from '@/components/DownloadSelector';
import { FAQAccordion } from '@/components/FAQAccordion';
import { ProductStatusBadge } from '@/components/ProductStatusBadge';
import { Band, ClosingBand, PageMasthead, SectionMark, Ticker } from '@/components/Editorial';

const product = products.find((p) => p.id === 'paralith')!;

export const metadata: Metadata = {
  title: `${product.name} — ${product.tagline}`,
  description: product.fullDescription,
};

const PLATFORMS = [
  { os: 'Windows', detail: '11 / 10 (22H2+)', artifact: 'x64 · .msi' },
  { os: 'macOS', detail: 'Ventura 13.0+', artifact: 'Universal · .dmg' },
  { os: 'Linux', detail: 'Ubuntu 22.04 / Fedora 38+', artifact: 'x86_64 · AppImage, .deb' },
];

const RELEASE_NOTES = [
  {
    heading: 'New',
    items: [
      'Parallel agent execution with live terminal stream output.',
      'Local AST index covering Rust, TypeScript, Python, and Go.',
      'Multi-window workspace detachment with persistent window state.',
    ],
  },
  {
    heading: 'Verification & security',
    items: [
      'Strict PTY sandbox with explicit approval for destructive shell calls.',
      'Signed installers for Windows (.msi) and macOS (.dmg).',
    ],
  },
];

export default function ParalithPage() {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'Paralith',
    operatingSystem: 'Windows, macOS, Linux',
    applicationCategory: 'DeveloperApplication',
    description: product.fullDescription,
    softwareVersion: 'v0.9.4-preview',
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <PageMasthead
        kicker="Flagship — agentic development environment"
        marker={<ProductStatusBadge status={product.status} />}
        title={
          <>
            Development, <span className="flare">coordinated</span>.
          </>
        }
        deck={product.fullDescription}
        meta={[
          { key: 'Release', value: 'v0.9.4 preview', accent: true },
          { key: 'Targets', value: 'Windows · macOS · Linux' },
          { key: 'Distribution', value: 'Signed · SHA-256' },
          { key: 'Telemetry', value: 'Off by default' },
        ]}
      />

      {/* ── Download ─────────────────────────────────────────────────────── */}
      <Band tone="panel" id="download" className="scroll-mt-24" divider>
        <SectionMark
          index="01"
          kicker="Distribution"
          title="Pull the preview build."
          deck="Every installer is signed and published with its checksum so you can verify the artifact before it runs."
        />

        <div className="mt-14">
          {product.downloads && (
            <DownloadSelector productName={product.name} downloads={product.downloads} />
          )}
        </div>
      </Band>

      <Ticker items={product.capabilities.map((c) => c.highlight ?? c.title)} />

      {/* ── Capabilities ─────────────────────────────────────────────────── */}
      <Band tone="void">
        <SectionMark
          index="02"
          kicker="System architecture"
          title="Built for serious software delivery."
          deck="High-level agentic execution sitting directly on strict low-level system controls, with nothing hand-waved in between."
        />

        <div className="mt-14 grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
          {product.capabilities.map((cap, i) => (
            <article key={cap.title} className="panel panel-hover flex flex-col gap-4 p-7">
              <div className="flex items-start justify-between gap-4">
                <p className="stamp text-iris-lift max-w-[16ch]">{cap.highlight ?? 'Core system'}</p>
                <span aria-hidden="true" className="numeral text-lume text-xl">
                  {String(i + 1).padStart(2, '0')}
                </span>
              </div>
              <h3 className="text-lg text-lume">{cap.title}</h3>
              <p className="text-mute mt-auto border-t border-[var(--hair)] pt-4 text-sm">
                {cap.description}
              </p>
            </article>
          ))}
        </div>
      </Band>

      {/* ── Platforms & audience ─────────────────────────────────────────── */}
      <Band tone="panel" divider>
        <SectionMark
          index="03"
          kicker="Fit"
          title="Who it is for, and where it runs."
          deck="Paralith targets engineers who are already coordinating several moving parts at once — and every desktop they do it on."
        />

        <div className="mt-14 grid grid-cols-12 gap-x-8 gap-y-12">
          <div className="col-span-12 lg:col-span-5">
            <h3 className="stamp text-iris-lift border-b border-[var(--hair-strong)] pb-3">
              Built for
            </h3>
            <ul>
              {product.targetAudience.map((audience, i) => (
                <li
                  key={audience}
                  className="flex items-baseline gap-4 border-b border-[var(--hair)] py-4"
                >
                  <span aria-hidden="true" className="stamp text-faint w-6 shrink-0">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <span className="text-base">{audience}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="col-span-12 lg:col-span-6 lg:col-start-7">
            <h3 className="stamp text-iris-lift border-b border-[var(--hair-strong)] pb-3">
              Supported targets
            </h3>
            <ul>
              {PLATFORMS.map((p) => (
                <li key={p.os} className="border-b border-[var(--hair)] py-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
                    <span className="text-base">{p.os}</span>
                    <span className="stamp text-faint">{p.artifact}</span>
                  </div>
                  <p className="text-mute mt-1.5 font-mono text-xs">{p.detail}</p>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Band>

      {/* ── Release notes ────────────────────────────────────────────────── */}
      <Band tone="void" id="release-notes" className="scroll-mt-24">
        <SectionMark
          index="04"
          kicker="Changelog"
          title="v0.9.4 preview."
          deck="Released 15 July 2026. Published with SHA-256 checksums for every artifact."
        />

        <div className="mt-14 grid grid-cols-12 gap-x-8 gap-y-10">
          {RELEASE_NOTES.map((group, i) => (
            <section
              key={group.heading}
              className={`col-span-12 lg:col-span-5 ${i === 1 ? 'lg:col-start-8' : ''}`}
            >
              <h3 className="stamp text-iris-lift border-b border-[var(--hair-strong)] pb-3">
                {group.heading}
              </h3>
              <ul>
                {group.items.map((item) => (
                  <li key={item} className="flex gap-4 border-b border-[var(--hair)] py-4">
                    <span aria-hidden="true" className="text-signal font-mono text-sm">
                      +
                    </span>
                    <span className="text-base">{item}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </Band>

      {/* ── FAQ ──────────────────────────────────────────────────────────── */}
      <Band tone="panel" divider>
        <SectionMark
          index="05"
          kicker="Questions"
          title="What people ask first."
          deck="Architecture, privacy, model choice, and platform support — answered without hedging."
        />

        <div className="mt-14">
          <FAQAccordion faqs={product.faqs} />
        </div>
      </Band>

      <ClosingBand
        title={
          <>
            Still <span className="flare">early access</span>.
          </>
        }
        body="Preview builds change quickly. Tell us what you are running and we will keep you on the right channel."
      >
        <Link href="#download" className="btn btn-primary btn-lg">
          Get the build
          <span aria-hidden="true">↓</span>
        </Link>
        <Link href="/security" className="btn btn-secondary btn-lg">
          Read security posture
        </Link>
      </ClosingBand>
    </>
  );
}
