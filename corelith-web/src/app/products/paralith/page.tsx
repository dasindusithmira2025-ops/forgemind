import { Metadata } from 'next';
import Link from 'next/link';
import { products } from '@/data/products';
import { DownloadSelector } from '@/components/DownloadSelector';
import { FAQAccordion } from '@/components/FAQAccordion';
import { ParalithHeroLoop } from '@/components/ParalithHeroLoop';
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

/**
 * The surfaces the workspace is actually made of. Each one is a real part of
 * the application and appears in the loop above, which is the constraint this
 * list is written under — it names what ships, not what is planned.
 */
const SURFACES = [
  {
    name: 'Projects',
    body: 'Open a project and the workspace comes back the way you left it — the same panes, the same terminals, the same agents mid-task.',
  },
  {
    name: 'Code surface',
    body: 'An editor, a file tree, and a browser preview in one pane, so you can read what an agent changed and see the result without leaving the window.',
  },
  {
    name: 'Terminals',
    body: 'Real shells, several at a time. Agents use the same terminals you do, and anything destructive stops to ask before it runs.',
  },
  {
    name: 'Swarms',
    body: 'Give a larger piece of work to a group of agents instead of one, and watch them split it between themselves.',
  },
  {
    name: 'Repository',
    body: 'Branches and pending changes in one view. Every diff an agent produced is here to read before you let any of it through.',
  },
  {
    name: 'Detached windows',
    body: 'Pull any panel out into a window of its own and lay the workspace out across as many monitors as you have.',
  },
];

/**
 * The verification gate, stated as the three states a change actually passes
 * through. This is the product's central claim, so it gets a band of its own
 * rather than a bullet in a card.
 */
const GATE = [
  {
    state: 'Proposed',
    title: 'The agent writes, but not into your project.',
    body: 'Work happens against your project without landing in it. Nothing an agent produces is in your working tree while it is still being made.',
  },
  {
    state: 'Checked',
    title: 'The change has to pass before it can move.',
    body: 'Every change is checked before it is allowed any further. A failure stops it where it is — the change waits for you to look at it rather than going in anyway.',
  },
  {
    state: 'Approved',
    title: 'You are the one who lets it through.',
    body: 'What changed, and what was deliberately left alone, comes back as something you can read in a minute. It lands when you say so, and there is no override switch.',
  },
];

const RELEASE_NOTES = [
  {
    heading: 'New',
    items: [
      'Agents now take on several tasks at once, with progress you can watch as it happens.',
      'Paralith holds on to more of what it knows about your project between sessions.',
      'Pull any panel into its own window and spread the workspace across your monitors.',
    ],
  },
  {
    heading: 'Trust & safety',
    items: [
      'Anything that could destroy work now stops and waits for your approval.',
      'Signed installers for Windows and macOS.',
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
          { key: 'Runs on', value: 'Windows · macOS · Linux' },
          { key: 'Downloads', value: 'Signed · SHA-256' },
          { key: 'Telemetry', value: 'Off by default' },
        ]}
      >
        <ParalithHeroLoop />
      </PageMasthead>

      <Ticker items={product.capabilities.map((c) => c.highlight ?? c.title)} />

      {/* ── The workspace ────────────────────────────────────────────────── */}
      <Band tone="paper-2" id="workspace" className="scroll-mt-24" divider>
        <SectionMark
          index="01"
          kicker="The workspace"
          title="What you are looking at."
          deck="Six surfaces in one window. The loop above moves between them; this is what each one is for."
        />

        <div className="mt-14 grid grid-cols-12 gap-x-8">
          <div className="col-span-12 border-t border-[var(--hair-strong)]">
            {SURFACES.map((surface, i) => (
              <article
                key={surface.name}
                data-reveal="up"
                className="lit-row grid grid-cols-12 items-baseline gap-x-8 gap-y-3 border-b border-[var(--hair)] py-6"
              >
                <div className="col-span-12 flex items-baseline gap-4 lg:col-span-4">
                  <span aria-hidden="true" className="stamp text-ink-faint w-6 shrink-0">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <h3 className="text-base lg:text-lg">{surface.name}</h3>
                </div>

                <p className="text-ink-soft col-span-12 text-base lg:col-span-7 lg:col-start-6">
                  {surface.body}
                </p>
              </article>
            ))}
          </div>
        </div>
      </Band>

      {/* ── Capabilities ─────────────────────────────────────────────────── */}
      <Band tone="paper" id="capabilities" className="scroll-mt-24">
        <SectionMark
          index="02"
          kicker="What it does"
          title="Built for serious software delivery."
          deck="Six things Paralith takes off your hands, and one thing it never takes: the final say."
        />

        <div className="mt-14 grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
          {product.capabilities.map((cap) => (
            <article
              key={cap.title}
              data-reveal="up"
              className="panel panel-hover lit flex flex-col gap-4 p-7"
            >
              <p className="stamp text-[var(--kicker)]">{cap.highlight ?? 'Core system'}</p>
              <h3 className="text-lg text-ink">{cap.title}</h3>
              <p className="text-ink-soft mt-auto border-t border-[var(--hair)] pt-4 text-sm">
                {cap.description}
              </p>
            </article>
          ))}
        </div>
      </Band>

      {/* ── The gate ─────────────────────────────────────────────────────── */}
      <Band tone="core" id="verification" className="scroll-mt-24" divider>
        <SectionMark
          index="03"
          kicker="Verification"
          title="Three states, and only one way through."
          deck="The part of Paralith worth arguing about. Agents can write anything they like; what they cannot do is decide that it ships."
        />

        <div className="mt-14 grid grid-cols-1 gap-5 lg:grid-cols-3">
          {GATE.map((step, i) => (
            <article
              key={step.state}
              data-reveal="up"
              className="panel lit flex flex-col gap-4 p-7"
              // The three read as a sequence, so the connective is an arrow between
              // plates rather than three unrelated cards.
            >
              <div className="flex items-center gap-3">
                <span aria-hidden="true" className="numeral text-ink text-xl">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <p className="stamp text-ink">{step.state}</p>
              </div>
              <h3 className="text-base lg:text-lg">{step.title}</h3>
              <p className="text-ink-soft mt-auto border-t border-[var(--hair)] pt-4 text-sm">
                {step.body}
              </p>
            </article>
          ))}
        </div>

        <p data-reveal="up" className="stamp text-ink-soft mt-10 border-t border-[var(--hair)] pt-6">
          Signed installers ◆ SHA-256 published ◆ No telemetry by default
        </p>
      </Band>

      {/* ── Download ─────────────────────────────────────────────────────── */}
      <Band tone="paper" id="download" className="scroll-mt-24">
        <SectionMark
          index="04"
          kicker="Distribution"
          title="Pull the preview build."
          deck="Every installer is signed and published with its checksum so you can verify the artifact before it runs."
        />

        <div data-reveal="up" className="mt-14">
          {product.downloads && (
            <DownloadSelector productName={product.name} downloads={product.downloads} />
          )}
        </div>
      </Band>

      {/* ── Platforms & audience ─────────────────────────────────────────── */}
      <Band tone="paper-2" divider>
        <SectionMark
          index="05"
          kicker="Fit"
          title="Who it is for, and where it runs."
          deck="Paralith targets engineers who are already coordinating several moving parts at once — and every desktop they do it on."
        />

        <div className="mt-14 grid grid-cols-12 gap-x-8 gap-y-12">
          <div data-reveal="up" className="col-span-12 lg:col-span-5">
            <h3 className="stamp text-core-ink border-b border-[var(--hair-strong)] pb-3">
              Built for
            </h3>
            <ul>
              {product.targetAudience.map((audience, i) => (
                <li
                  key={audience}
                  className="flex items-baseline gap-4 border-b border-[var(--hair)] py-4"
                >
                  <span aria-hidden="true" className="stamp text-ink-faint w-6 shrink-0">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <span className="text-base">{audience}</span>
                </li>
              ))}
            </ul>
          </div>

          <div data-reveal="up" className="col-span-12 lg:col-span-6 lg:col-start-7">
            <h3 className="stamp text-core-ink border-b border-[var(--hair-strong)] pb-3">
              Supported targets
            </h3>
            <ul>
              {PLATFORMS.map((p) => (
                <li key={p.os} className="border-b border-[var(--hair)] py-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
                    <span className="text-base">{p.os}</span>
                    <span className="stamp text-ink-faint">{p.artifact}</span>
                  </div>
                  <p className="text-ink-soft mt-1.5 font-mono text-xs">{p.detail}</p>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Band>

      {/* ── Release notes ────────────────────────────────────────────────── */}
      <Band tone="paper" id="release-notes" className="scroll-mt-24">
        <SectionMark
          index="06"
          kicker="Changelog"
          title="v0.9.4 preview."
          deck="Released 15 July 2026. Published with SHA-256 checksums for every artifact."
        />

        <div className="mt-14 grid grid-cols-12 gap-x-8 gap-y-10">
          {RELEASE_NOTES.map((group, i) => (
            <section
              key={group.heading}
              data-reveal="up"
              className={`col-span-12 lg:col-span-5 ${i === 1 ? 'lg:col-start-8' : ''}`}
            >
              <h3 className="stamp text-core-ink border-b border-[var(--hair-strong)] pb-3">
                {group.heading}
              </h3>
              <ul>
                {group.items.map((item) => (
                  <li key={item} className="flex gap-4 border-b border-[var(--hair)] py-4">
                    <span aria-hidden="true" className="text-success font-mono text-sm">
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
      <Band tone="paper-2" id="faq" className="scroll-mt-24" divider>
        <SectionMark
          index="07"
          kicker="Questions"
          title="What people ask first."
          deck="Architecture, privacy, model choice, and platform support — answered without hedging."
        />

        <div data-reveal="up" className="mt-14">
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
