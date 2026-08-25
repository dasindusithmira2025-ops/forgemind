/**
 * Legal pages are read, not scanned, so they get the one place on this site
 * where a single measured column and generous leading beat the wide grid.
 * Sections stay numbered because the numbers make a clause referenceable.
 */
export function LegalBody({
  sections,
}: {
  sections: { heading: string; body: string[] }[];
}) {
  return (
    <div className="shell">
      <div className="grid grid-cols-1 gap-x-16 lg:grid-cols-12">
        <nav aria-label="On this page" className="lg:col-span-3">
          <p className="mono text-[var(--ink-3)]">Sections</p>
          <ol className="mt-4 flex flex-col gap-2 lg:sticky lg:top-28">
            {sections.map((section, i) => (
              <li key={section.heading}>
                <a
                  href={`#s${i + 1}`}
                  className="flex items-baseline gap-3 text-[15px] text-[var(--ink-2)] hover:text-[var(--ink)]"
                >
                  <span className="mono text-[var(--ink-3)]">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span>{section.heading}</span>
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <div className="mt-12 lg:col-span-9 lg:mt-0">
          {sections.map((section, i) => (
            <section
              key={section.heading}
              id={`s${i + 1}`}
              className="reveal border-t py-9 first:border-t-0 first:pt-0"
              style={{ borderColor: "var(--hair)", scrollMarginTop: "112px" }}
            >
              <div className="flex items-baseline gap-4">
                <span className="index">{String(i + 1).padStart(2, "0")}</span>
                <h2 className="text-[length:var(--step-sub)] leading-[1.15]">{section.heading}</h2>
              </div>
              <div className="mt-5 flex max-w-[68ch] flex-col gap-4 pl-0 sm:pl-11">
                {section.body.map((paragraph, index) => (
                  <p key={index} className="text-[var(--ink-2)]">
                    {paragraph}
                  </p>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
