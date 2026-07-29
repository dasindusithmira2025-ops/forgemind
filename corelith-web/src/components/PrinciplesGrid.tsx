import { companyData } from '@/data/company';

/**
 * Principles as a ruled matrix. Cells share hairlines instead of floating on
 * gaps, so the grid reads as one instrument panel — the gapped-card layout is
 * what makes most of these sections interchangeable between companies.
 */
export function PrinciplesGrid() {
  return (
    <div className="grid grid-cols-1 overflow-hidden rounded-lg border border-[var(--hair-strong)] sm:grid-cols-2 lg:grid-cols-3">
      {companyData.principles.map((item, idx) => (
        <article
          key={item.title}
          className="flex flex-col gap-4 border-r border-b border-[var(--hair)] p-7 transition-colors hover:bg-[rgba(17,24,39,0.04)]"
        >
          <div className="flex items-start justify-between gap-4">
            <p className="stamp max-w-[14ch] text-[var(--kicker)]">{item.subtitle}</p>
            <span aria-hidden="true" className="numeral text-[var(--fg)] text-xl">
              {String(idx + 1).padStart(2, '0')}
            </span>
          </div>

          <h3 className="text-lg text-[var(--fg)]">{item.title}</h3>

          <p className="mt-auto border-t border-[var(--hair)] pt-4 text-sm text-[var(--fg-soft)]">
            {item.description}
          </p>
        </article>
      ))}
    </div>
  );
}
