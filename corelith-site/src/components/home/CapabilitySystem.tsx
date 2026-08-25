"use client";

import Link from "next/link";
import { useState } from "react";
import { primaryCapabilities } from "@/content/capabilities";
import { CapabilityCore } from "@/components/visuals/CapabilityCore";

/**
 * THE CAPABILITY FIELD.
 *
 * Four domains placed around a common core, two on each side of a framed
 * plate, with a hairline running out from the plate to separate the rows. The
 * composition is the argument: these are one practice approached from four
 * sides, and a stacked list of four cards cannot say that.
 *
 * The plate is not decoration. Pointing at a domain reorganises the network
 * inside it into the structure that domain actually describes — ordered shells,
 * routed paths, a closed surface, a bare frame — so the object in the middle is
 * always saying what the words around it say.
 *
 * Every domain shows its name and its line of copy at all times, and each one
 * is a link to its own page. Nothing here is available only by hovering.
 */
export function CapabilitySystem() {
  const [active, setActive] = useState(0);
  const capability = primaryCapabilities[active];

  return (
    <div className="grid grid-cols-1 items-stretch gap-x-0 gap-y-10 lg:grid-cols-[1fr_auto_1fr]">
      {/* Left column: the first two domains, ranged right toward the plate. */}
      <div className="order-2 flex flex-col lg:order-1">
        <Item index={0} align="right" active={active === 0} onEnter={setActive} />
        <Rule />
        <Item index={1} align="right" active={active === 1} onEnter={setActive} />
      </div>

      {/* The plate. Framed rather than floated: a rendered object with no edge
          on a white sheet reads as something that failed to load. */}
      <div className="order-1 flex justify-center px-0 lg:order-2 lg:px-[clamp(24px,3vw,56px)]">
        <div className="viz-panel h-[clamp(280px,54vw,360px)] w-full max-w-[340px] lg:h-[340px] lg:w-[290px]">
          <CapabilityCore state={capability.core} className="h-full w-full" />
          <p className="viz-caption">
            Corelith <strong>Core</strong>
          </p>
        </div>
      </div>

      <div className="order-3 flex flex-col">
        <Item index={2} align="left" active={active === 2} onEnter={setActive} />
        <Rule />
        <Item index={3} align="left" active={active === 3} onEnter={setActive} />
      </div>
    </div>
  );
}

/** The hairline between the rows. It stops at the plate rather than crossing it. */
function Rule() {
  return <div className="hidden h-px shrink-0 bg-[var(--hair)] lg:block" aria-hidden="true" />;
}

function Item({
  index,
  align,
  active,
  onEnter,
}: {
  index: number;
  align: "left" | "right";
  active: boolean;
  onEnter: (index: number) => void;
}) {
  const capability = primaryCapabilities[index];
  const right = align === "right";

  return (
    <Link
      href={`/capabilities/${capability.slug}`}
      onMouseEnter={() => onEnter(index)}
      onFocus={() => onEnter(index)}
      className={`group flex flex-1 flex-col justify-center py-8 lg:py-10 ${
        right ? "lg:items-end lg:text-right" : "lg:items-start lg:text-left"
      }`}
    >
      <span className="index-lg text-[var(--ink-3)]">{capability.index}</span>

      <span
        className="font-display mt-2.5 block text-[clamp(1.5rem,2.1vw,1.875rem)] leading-[1.12] font-semibold tracking-[-0.025em] transition-colors duration-[320ms]"
        style={{ color: active ? "var(--accent)" : "var(--accent-light)" }}
      >
        {capability.name}
      </span>

      <span
        className={`mt-3.5 block max-w-[34ch] text-[15px] leading-[1.6] text-[var(--ink-2)] ${
          right ? "lg:ml-auto" : ""
        }`}
      >
        {capability.brief}
      </span>

      {/* The active mark: a rule that grows. This composition has no boxes in
          it and an active state drawn as a border would introduce the first. */}
      <span
        aria-hidden="true"
        className="mt-5 block h-px w-[60px] origin-left bg-[var(--accent)] transition-transform duration-[520ms] ease-[var(--ease)]"
        style={{
          transform: `scaleX(${active ? 1 : 0})`,
          transformOrigin: right ? "right" : "left",
        }}
      />
    </Link>
  );
}
