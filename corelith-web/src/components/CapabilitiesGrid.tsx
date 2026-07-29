import { companyData } from '@/data/company';

/**
 * The engineering scope, set as a ruled index: title on the left, description
 * on the right, hairline between rows. No icon chips — a generic glyph above
 * every heading is decoration standing in for hierarchy.
 *
 * Deliberately unnumbered. These four domains are a set, not a sequence, and an
 * index number would imply an order the reader is meant to follow. Numerals in
 * this system are reserved for content where the order is real information.
 */
export function CapabilitiesGrid() {
  return (
    <ul className="border-t border-[var(--hair-strong)]">
      {companyData.capabilities.map((cap) => (
        <li
          key={cap.category}
          className="group grid grid-cols-12 items-baseline gap-x-8 gap-y-3 border-b border-[var(--hair)] py-8 transition-colors hover:bg-[rgba(245,237,224,0.03)]"
        >
          <h3 className="col-span-12 text-lg text-[var(--fg)] transition-colors group-hover:text-[var(--kicker)] lg:col-span-4 lg:text-xl">
            {cap.category}
          </h3>

          <p className="col-span-12 text-base text-[var(--fg-soft)] lg:col-span-7 lg:col-start-6">
            {cap.description}
          </p>
        </li>
      ))}
    </ul>
  );
}
