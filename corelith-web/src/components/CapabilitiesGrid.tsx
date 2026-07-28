import { companyData } from '@/data/company';

/**
 * The engineering scope, set as a printed index rather than a row of icon
 * cards: outlined numeral, title, hairline, description. No icon chips — a
 * generic glyph above every heading is decoration standing in for hierarchy.
 */
export function CapabilitiesGrid() {
  return (
    <ul className="border-t border-[var(--hair-strong)]">
      {companyData.capabilities.map((cap, idx) => (
        <li
          key={cap.category}
          className="group grid grid-cols-12 items-baseline gap-x-8 gap-y-3 border-b border-[var(--hair)] py-8 transition-colors hover:bg-white/[0.02]"
        >
          <div className="col-span-2 lg:col-span-1">
            <span
              aria-hidden="true"
              className="numeral text-[var(--fg)] text-xl transition-colors group-hover:text-iris-lift lg:text-2xl"
            >
              {String(idx + 1).padStart(2, '0')}
            </span>
          </div>

          <h3 className="col-span-10 text-lg text-[var(--fg)] lg:col-span-4 lg:text-xl">
            {cap.category}
          </h3>

          <p className="col-span-12 text-base text-[var(--fg-soft)] lg:col-span-6 lg:col-start-7">
            {cap.description}
          </p>
        </li>
      ))}
    </ul>
  );
}
