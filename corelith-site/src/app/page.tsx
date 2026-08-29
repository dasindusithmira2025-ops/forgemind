import Image from "next/image";
import Link from "next/link";
import type { CSSProperties } from "react";
import { site } from "@/content/site";
import { capabilities } from "@/content/capabilities";
import { caseStudies, clientWorkNote } from "@/content/work";
import { paralith } from "@/content/products";
import { philosophy, principles, research } from "@/content/company";
import { Band, Em, EmLight, GoLink, SectionIntro, Arrow } from "@/components/primitives";
import { CorelithField } from "@/components/visuals/CorelithField";
import { CapabilitySystem } from "@/components/home/CapabilitySystem";
import { ProcessSystem } from "@/components/visuals/ProcessSystem";
import { ResearchTraces } from "@/components/visuals/ResearchTraces";
import { ProductFilm } from "@/components/ProductFilm";
import paralithPoster from "../../public/media/paralith-poster.png";

const delay = (ms: number) => ({ "--d": `${ms}ms` }) as CSSProperties;

/**
 * The homepage.
 *
 * Graphite throughout, with the light in the room coming from two amber blooms
 * rather than from a coloured band. Sections open centred and then compose
 * freely underneath — a split hero with the field set into a machined housing,
 * a thesis cut into the floor, a large product plate, an editorial list, a
 * diagram that transforms, a film. The page never flips to a light band for
 * contrast: the rooms alternate between the panel room and the channel cut
 * into it, and the one solid amber plate is reserved for the footer's full
 * stop.
 */
export default function HomePage() {
  return (
    <>
      <Hero />
      <Statement />
      <Capabilities />
      <SelectedWork />
      <Services />
      <HowWeBuild />
      <Products />
      <Research />
      <Principles />
      <ClosingCta />
    </>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * The hero: a statement on the left, the Corelith Field in a machined housing
 * on the right. Two grid tracks, so the headline can never end up reading across
 * a piece of geometry — that is a layout boundary, not a z-index arrangement.
 *
 * The housing is the one fastened plate on the page: a raised panel, the field
 * set into a recessed bay the way a screen sits in a chassis, and a tick ruler
 * along its foot — ten sections on this page, and the first one is lit.
 */
function Hero() {
  return (
    <section className="on-ground relative overflow-hidden">
      <div
        className="bloom"
        aria-hidden="true"
        style={
          {
            "--bloom-x": "58%",
            "--bloom-y": "-34%",
            "--bloom-x2": "-18%",
            "--bloom-y2": "52%",
          } as CSSProperties
        }
      />

      <div className="shell lit">
        <div className="grid items-center gap-x-10 gap-y-[clamp(44px,5vw,72px)] pt-[clamp(44px,5vw,72px)] pb-[clamp(64px,8vw,120px)] lg:min-h-[calc(100svh-96px)] lg:grid-cols-12 lg:py-0">
          <div className="lg:col-span-7 lg:py-[clamp(48px,5vw,88px)]">
            {/* Authored line breaks: three lines of near-equal length make a
                block, and a block is what carries at this size. Written with
                block elements rather than nowrap, so a narrow viewport wraps
                instead of overflowing. */}
            <h1 className="reveal-wipe text-[length:var(--step-hero)]" style={delay(40)}>
              <span className="block">We engineer</span>
              <span className="block">
                <EmLight>what comes</EmLight> <Em>next.</Em>
              </span>
            </h1>

            <p
              className="reveal mt-[clamp(24px,2.6vw,34px)] max-w-[58ch] text-[17px] leading-[1.65] text-[var(--ink-2)]"
              style={delay(160)}
            >
              Corelith Technologies designs and builds advanced software, AI systems, automation
              and infrastructure for the organisations that hire us — and develops technology
              products of its own.
            </p>

            <p className="reveal mt-7" style={delay(220)}>
              <span className="note">{site.presence}. Operating worldwide.</span>
            </p>

            <div className="reveal mt-9 flex flex-wrap items-center gap-3" style={delay(280)}>
              <Link href="/start-a-project" className="btn btn-primary">
                Start a project
                <Arrow />
              </Link>
              <Link href="/work" className="btn btn-secondary">
                Explore our work
              </Link>
            </div>
          </div>

          {/* Its own track, its own box. On a phone it follows the words: an
              object above the headline pushes the sentence the page exists to
              make below the fold.

              The plate adds 52px of chassis — bezel, ruler, gap — on top of the
              height the composition was tuned around, so the field itself keeps
              exactly the canvas it had. */}
          <div className="order-last lg:col-span-5">
            <div className="reveal panel flex h-[calc(clamp(300px,72vw,400px)+52px)] w-full flex-col p-4 lg:h-[calc(min(54svh,470px)+52px)]">
              <span className="panel-rim" aria-hidden="true" />
              <span className="fastener left-2 top-2" aria-hidden="true" />
              <span className="fastener right-2 top-2" aria-hidden="true" />
              <span className="fastener bottom-2 left-2" aria-hidden="true" />
              <span className="fastener bottom-2 right-2" aria-hidden="true" />

              <div className="bay relative flex-1 overflow-hidden">
                <CorelithField parallax className="h-full w-full" />
              </div>

              {/* The page's own ruler: ten sections, this is the first. */}
              <ul className="ticks mt-3" aria-hidden="true">
                {Array.from({ length: 10 }, (_, i) => (
                  <li key={i} data-on={i === 0 ? "" : undefined} />
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * The thesis, given a quiet screen of its own — and because a thesis is a
 * position rather than a feature, it is cut into the floor: a recessed channel
 * holding the two halves of the argument side by side.
 */
function Statement() {
  return (
    <Band tone="ground">
      <div className="shell">
        <SectionIntro
          heading={
            <>
              Technology should expand <Em>what is possible.</Em>
            </>
          }
        />
        <div className="mx-auto mt-14 max-w-[var(--measure)]">
          <div className="bay">
            <div className="grid grid-cols-1 gap-10 px-[clamp(24px,4vw,56px)] py-[clamp(30px,4vw,52px)] md:grid-cols-2 md:gap-16">
              {philosophy.body.map((paragraph, i) => (
                <p
                  key={i}
                  className="reveal text-[17px] leading-[1.68] text-[var(--ink-2)]"
                  style={delay(180 + i * 90)}
                >
                  {paragraph}
                </p>
              ))}
            </div>
          </div>
        </div>
      </div>
    </Band>
  );
}

/* -------------------------------------------------------------------------- */

function Capabilities() {
  return (
    <section className="on-recessed band relative overflow-hidden" id="capabilities">
      <div
        className="bloom"
        aria-hidden="true"
        style={
          {
            "--bloom-x": "30%",
            "--bloom-y": "-10%",
            "--bloom-x2": "68%",
            "--bloom-y2": "56%",
          } as CSSProperties
        }
      />
      <div className="shell lit">
        <SectionIntro
          heading={
            <>
              One practice, <EmLight>four</EmLight> <Em>ways in.</Em>
            </>
          }
          lead="Corelith is hired for a domain and delivers across all of them, because a product is not an interface problem or a data problem — it is both, and the seam between them is where systems fail."
          className="mb-[clamp(48px,6vw,88px)]"
        />

        <div className="mx-auto max-w-[1120px]">
          <CapabilitySystem />
        </div>

        <p className="mt-14 text-center text-[15px] text-[var(--ink-2)]">
          Also automation, and technology strategy.{" "}
          <Link href="/capabilities" className="link">
            All six capabilities
          </Link>
        </p>

        {/* Four ways in, of six capabilities. The lit ticks are the four on
            the screen above; the ruler says what the sentence does not have to. */}
        <ul className="ticks mt-7 justify-center" aria-hidden="true">
          {Array.from({ length: 6 }, (_, i) => (
            <li key={i} data-on={i < 4 ? "" : undefined} />
          ))}
        </ul>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * Selected work, presented as a project rather than as a card.
 *
 * One large plate, the name under it at display size, and the engineering
 * decisions in an editorial row beneath. A case study about systems work that
 * leads with a grid of thumbnails is describing the last five percent of it.
 *
 * The screenshot sits in a machined bezel and keeps its own white ground inside
 * it: that plate is the asset's, not the page's — the product is the lit thing
 * in the dark room.
 */
function SelectedWork() {
  const study = caseStudies[0];

  return (
    <Band tone="ground" id="work">
      <div className="shell">
        <SectionIntro
          heading={
            <>
              Systems we have <Em>built and shipped.</Em>
            </>
          }
          lead="Corelith's commercial engagements are under agreement. What is published here is technology Corelith designed, built and ships itself — the same engineering, without a client's name on it."
          className="mb-[clamp(44px,5vw,72px)]"
        />

        <figure className="reveal">
          <div className="panel p-2.5">
            <span className="panel-rim" aria-hidden="true" />
            <div className="overflow-hidden" style={{ borderRadius: "var(--r-sm)" }}>
              <Image
                src={paralithPoster}
                alt="The Paralith workspace: several agent sessions running against one repository."
                className="block aspect-[3/2] w-full bg-white object-contain"
                sizes="(min-width: 1400px) 1256px, 92vw"
                placeholder="blur"
              />
            </div>
          </div>
        </figure>

        <div className="mt-12 grid grid-cols-1 gap-x-16 gap-y-10 lg:grid-cols-12">
          <div className="lg:col-span-5">
            <h3 className="reveal text-[length:var(--step-page)] leading-[1]">{study.name}</h3>
            <p
              className="reveal mt-6 text-[17px] leading-[1.6] text-[var(--ink-2)]"
              style={delay(80)}
            >
              {study.descriptor}
            </p>
            <ul className="reveal mt-8 flex flex-wrap gap-2" style={delay(120)}>
              {study.disciplines.map((discipline) => (
                <li key={discipline} className="tag">
                  {discipline}
                </li>
              ))}
            </ul>
            <GoLink href={`/work/${study.slug}`} className="reveal mt-9">
              Read the case study
            </GoLink>
          </div>

          <div className="lg:col-span-7">
            <p className="reveal text-[17px] leading-[1.65] text-[var(--ink)]">{study.brief}</p>
            <dl className="mt-10 grid grid-cols-1 gap-x-14 sm:grid-cols-2">
              {study.architecture.map((layer, i) => (
                <div
                  key={layer.layer}
                  className="reveal border-t py-7"
                  style={{ borderColor: "var(--hair)", ...delay(i * 60) }}
                >
                  <dt className="flex items-baseline gap-3">
                    <span className="index-lg">{String(i + 1).padStart(2, "0")}</span>
                    <span className="text-[16px] font-semibold text-[var(--ink)]">
                      {layer.layer}
                    </span>
                  </dt>
                  <dd className="mt-3 text-[15px] leading-[1.65] text-[var(--ink-2)]">
                    {layer.body}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </div>

        {/* An aside is cut into the floor rather than ruled off, the same as
            the thesis above it: the channel is where the notes live. */}
        <div className="reveal mt-16">
          <div className="bay grid grid-cols-1 gap-6 px-[clamp(24px,3vw,44px)] py-[clamp(24px,3vw,40px)] md:grid-cols-12 md:gap-12">
            <h3 className="text-[length:var(--step-sub)] md:col-span-5">
              {clientWorkNote.heading}
            </h3>
            <p className="text-[var(--ink-2)] md:col-span-7">{clientWorkNote.body}</p>
          </div>
        </div>
      </div>
    </Band>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * The six capabilities as a reading list.
 *
 * The one place on the homepage where a list is the right composition: six
 * comparable things, read in order, with a hairline between them. The row tints
 * on hover rather than drawing a border, so nothing here is a box at rest. The
 * list opens on a datum rather than a bare rule — six measured entries, and the
 * amber end of the seam is where the counting starts.
 */
function Services() {
  return (
    <Band tone="recessed" id="engineering">
      <div className="shell">
        <SectionIntro
          heading={
            <>
              What we are <Em>hired for.</Em>
            </>
          }
          lead="Six capabilities, sold separately and delivered together. Each has a page that argues its case with the engineering rather than with adjectives."
          className="mb-[clamp(44px,5vw,72px)]"
        />

        <div className="mx-auto max-w-[var(--measure)]">
          <hr className="datum-rule" />
          <ul>
            {capabilities.map((capability, i) => (
              <li
                key={capability.slug}
                className={`reveal ${i === 0 ? "" : "border-t"}`}
                style={{ borderColor: "var(--hair)", ...delay(i * 60) }}
              >
                <Link
                  href={`/capabilities/${capability.slug}`}
                  className="group -mx-[clamp(12px,1.6vw,24px)] grid grid-cols-1 items-baseline gap-x-8 gap-y-2.5 rounded-[var(--r-lg)] px-[clamp(12px,1.6vw,24px)] py-9 transition-colors duration-[320ms] hover:bg-[var(--surface-2)] md:grid-cols-12"
                >
                  <span className="index-lg md:col-span-1">{capability.index}</span>
                  <span className="font-display text-[length:var(--step-sub)] leading-[1.1] font-semibold tracking-[-0.025em] text-[var(--ink)] transition-colors duration-[320ms] group-hover:text-[var(--accent)] md:col-span-4">
                    {capability.name}
                  </span>
                  <span className="text-[15px] leading-[1.65] text-[var(--ink-2)] md:col-span-6">
                    {capability.brief}
                  </span>
                  <span className="text-[var(--ink-3)] transition-[transform,color] duration-[320ms] group-hover:translate-x-1.5 group-hover:text-[var(--accent)] md:col-span-1 md:justify-self-end">
                    <Arrow />
                  </span>
                </Link>
              </li>
            ))}
            <li className="border-t" style={{ borderColor: "var(--hair)" }} />
          </ul>
        </div>
      </div>
    </Band>
  );
}

/* -------------------------------------------------------------------------- */

/** One system, six states, and the transformation between them is the section. */
function HowWeBuild() {
  return (
    <Band tone="ground" id="how">
      <div className="shell">
        <SectionIntro
          heading={
            <>
              Six states, <Em>in order.</Em>
            </>
          }
          lead="Every engagement moves through the same sequence. It is written down because a method you cannot name is a preference, and because the gate at the end of it is the one that decides whether something ships."
          className="mb-[clamp(40px,5vw,72px)]"
        />

        <div className="reveal mx-auto max-w-[var(--measure)]">
          <ProcessSystem />
        </div>
      </div>
    </Band>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * Paralith, shown with real product material. There is no abstract object in
 * this section on purpose — a company that builds software should be able to
 * show the software.
 *
 * The film is already a machined plate in its own right — rim, caption bar —
 * so it is mounted directly rather than set into a second bezel: a plate
 * inside a plate reads as a shadow box, not as a chassis.
 */
function Products() {
  return (
    <Band tone="recessed" id="products">
      <div className="shell">
        <SectionIntro
          heading={
            <>
              Technology we build <Em>for ourselves.</Em>
            </>
          }
          lead="Building and operating our own products is how we learn what survives contact with production — and it is why the engineering we bring to a client engagement has already been tested somewhere we could not blame anyone else."
          className="mb-[clamp(44px,5vw,72px)]"
        />

        <div className="grid grid-cols-1 items-start gap-x-16 gap-y-12 lg:grid-cols-12">
          <div className="lg:col-span-4">
            <h3 className="reveal-wipe text-[length:var(--step-head)] leading-[1]">
              {paralith.wordmark}
            </h3>
            <p
              className="reveal mt-5 text-[17px] font-medium text-[var(--accent)]"
              style={delay(80)}
            >
              {paralith.category}
            </p>
            <p
              className="reveal mt-7 text-[16px] leading-[1.68] text-[var(--ink-2)]"
              style={delay(160)}
            >
              {paralith.brief}
            </p>

            <dl className="reveal mt-11 grid grid-cols-2 gap-x-8 gap-y-7" style={delay(240)}>
              {paralith.facts.slice(0, 4).map((fact) => (
                <div key={fact.label}>
                  <dt className="mono text-[var(--ink-3)]">{fact.label}</dt>
                  <dd className="mono-plain mt-2 text-[var(--ink)]">{fact.value}</dd>
                </div>
              ))}
            </dl>

            <GoLink href="/products/paralith" className="mt-11">
              Explore Paralith
            </GoLink>
          </div>

          <div className="reveal lg:col-span-8" style={delay(120)}>
            <ProductFilm
              poster={paralithPoster}
              posterClassName="bg-white object-contain"
              src="/media/paralith-promo-4k.mp4"
              captions="/media/paralith-showcase-captions.vtt"
              label="Paralith — product film"
            />
          </div>
        </div>
      </div>
    </Band>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * Research. The only generative graphic on the site that carries no
 * interaction: many lines of enquiry, most of which thin out, a few of which
 * carry through to a result. Drawn once on the server, and it does not move.
 *
 * The plot sits in a recessed bay — the same cut as the thesis — so the fan
 * reads as something plotted on an instrument rather than drawn on the page.
 */
function Research() {
  return (
    <Band tone="ground" id="research">
      <div className="shell">
        <SectionIntro
          heading={
            <>
              The problems we are working on <Em>next.</Em>
            </>
          }
          lead="Corelith research is grounded in systems we run. Every line below is a question we hit while building something, not a field we would like to be associated with."
          className="mb-[clamp(32px,4vw,56px)]"
        />

        <div className="reveal mx-auto max-w-[var(--measure)]">
          <div className="bay px-[clamp(20px,4vw,64px)] py-[clamp(24px,4vw,44px)]">
            <ResearchTraces className="h-[clamp(110px,14vw,170px)] w-full" />
          </div>
        </div>

        <ul className="mx-auto mt-12 max-w-[var(--measure)]">
          {research.slice(0, 3).map((item, i) => (
            <li
              key={item.slug}
              className="reveal grid grid-cols-1 gap-x-14 gap-y-5 border-t py-11 md:grid-cols-12"
              style={{ borderColor: "var(--hair)", ...delay(i * 70) }}
            >
              <div className="md:col-span-5">
                <span className="index-lg">{item.index}</span>
                <h3 className="mt-4 text-[length:var(--step-sub)]">{item.title}</h3>
              </div>
              <div className="md:col-span-7">
                <p className="text-[17px] leading-[1.6] text-[var(--ink)]">{item.question}</p>
                <p className="mt-5 text-[15px] leading-[1.65] text-[var(--ink-3)]">
                  {item.grounding}
                </p>
              </div>
            </li>
          ))}
          <li className="border-t" style={{ borderColor: "var(--hair)" }} />
        </ul>

        <div className="mt-12 flex justify-center">
          <GoLink href="/research">All research</GoLink>
        </div>
      </div>
    </Band>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * Six positions, one bank of plates. Each principle is a machined panel because
 * each one is something a change can be held against — a fixed reference, not a
 * floating aspiration.
 */
function Principles() {
  return (
    <Band tone="recessed" id="principles">
      <div className="shell">
        <SectionIntro
          heading={
            <>
              What we <Em>hold to.</Em>
            </>
          }
          lead="Six positions that decide how the work is done. They are not aspirations — each one is something a reviewer can hold a change against."
          className="mb-[clamp(44px,5vw,72px)]"
        />

        <dl className="mx-auto grid max-w-[var(--measure)] grid-cols-1 gap-x-16 gap-y-5 md:grid-cols-2">
          {principles.map((principle, i) => (
            <div
              key={principle.index}
              className="reveal panel p-6"
              style={delay(i * 55)}
            >
              <span className="panel-rim" aria-hidden="true" />
              <dt className="flex items-baseline gap-4">
                <span className="index-lg">{principle.index}</span>
                <span className="font-display text-[length:var(--step-sub)] leading-[1.18] font-semibold tracking-[-0.025em] text-[var(--ink)]">
                  {principle.claim}
                </span>
              </dt>
              <dd className="mt-4 pl-11 text-[15px] leading-[1.68] text-[var(--ink-2)]">
                {principle.body}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </Band>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * The closing statement gets the second-largest type on the site and its own
 * light. The amber stays in the lamp and the footer's plate below it — this
 * room stays graphite, and the ruler under the sentence closes the measurement
 * the hero opened: ten sections, the last one lit.
 */
function ClosingCta() {
  return (
    <section className="on-ground relative flex min-h-[64vh] items-center overflow-hidden">
      <div
        className="bloom"
        aria-hidden="true"
        style={
          {
            "--bloom-x": "22%",
            "--bloom-y": "22%",
            "--bloom-x2": "62%",
            "--bloom-y2": "-24%",
          } as CSSProperties
        }
      />
      <div className="shell lit py-[clamp(80px,11vw,164px)] text-center">
        <p className="reveal">
          <span className="note">Start a project</span>
        </p>
        <h2
          className="reveal-wipe mx-auto mt-9 max-w-[16ch] text-[length:var(--step-hero)]"
          style={delay(100)}
        >
          Have something <EmLight>ambitious</EmLight> <Em>in mind?</Em>
        </h2>
        <p
          className="reveal mx-auto mt-8 max-w-[58ch] text-[17px] leading-[1.65] text-[var(--ink-2)]"
          style={delay(220)}
        >
          Tell us what you are trying to build. We will tell you what it takes, what it costs to
          own, and whether we are the right people for it.
        </p>

        <ul className="reveal ticks mt-10 justify-center" style={delay(260)} aria-hidden="true">
          {Array.from({ length: 10 }, (_, i) => (
            <li key={i} data-on={i === 9 ? "" : undefined} />
          ))}
        </ul>

        <div
          className="reveal mt-9 flex flex-wrap items-center justify-center gap-3"
          style={delay(300)}
        >
          <Link href="/start-a-project" className="btn btn-accent">
            Start a project
            <Arrow />
          </Link>
          <a href={`mailto:${site.email.general}`} className="btn btn-secondary">
            {site.email.general}
          </a>
        </div>
      </div>
    </section>
  );
}
