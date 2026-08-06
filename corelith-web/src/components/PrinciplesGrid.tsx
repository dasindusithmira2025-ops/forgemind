import { companyData } from '@/data/company';

/**
 * Principles as a ruled matrix. Cells share hairlines instead of floating on
 * gaps, so the grid reads as one printed sheet — the gapped-card layout is what
 * makes most of these sections interchangeable between companies.
 *
 * Unnumbered by design: these are six standards held at once, not six steps
 * taken in order.
 */
export function PrinciplesGrid() {
  return (
    <div className="grid grid-cols-1 overflow-hidden rounded-lg border border-[var(--hair-strong)] sm:grid-cols-2 lg:grid-cols-3">
      {companyData.principles.map((item) => (
        <article
          key={item.title}
          data-reveal="up"
          className="lit flex flex-col gap-4 border-r border-b border-[var(--hair)] p-7 transition-colors hover:bg-[rgba(245,237,224,0.03)]"
        >
          <p className="stamp text-[var(--kicker)]">{item.subtitle}</p>

          <h3 className="text-lg text-[var(--fg)]">{item.title}</h3>

          <p className="mt-auto border-t border-[var(--hair)] pt-4 text-sm text-[var(--fg-soft)]">
            {item.description}
          </p>
        </article>
      ))}
    </div>
  );
}
