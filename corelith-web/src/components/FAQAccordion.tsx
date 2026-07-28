'use client';

import { useId, useState } from 'react';

interface FAQItem {
  question: string;
  answer: string;
}

/**
 * Ruled accordion. Rows are separated by hairlines rather than boxed into
 * cards, and the open/closed affordance is a plus that becomes a minus — a
 * chevron rotating on a rounded card is the pattern this replaces.
 */
export function FAQAccordion({ faqs }: { faqs: FAQItem[] }) {
  const [openIndex, setOpenIndex] = useState<number | null>(0);
  const baseId = useId();

  return (
    <div className="border-t border-[var(--hair-strong)]">
      {faqs.map((faq, idx) => {
        const isOpen = openIndex === idx;
        const panelId = `${baseId}-panel-${idx}`;
        const triggerId = `${baseId}-trigger-${idx}`;

        return (
          <div key={faq.question} className="border-b border-[var(--hair)]">
            <h3>
              <button
                type="button"
                id={triggerId}
                aria-expanded={isOpen}
                aria-controls={panelId}
                onClick={() => setOpenIndex(isOpen ? null : idx)}
                className="group flex w-full items-start gap-4 py-6 text-left sm:gap-6"
              >
                <span aria-hidden="true" className="stamp text-[var(--kicker)] w-6 shrink-0 pt-1.5">
                  {String(idx + 1).padStart(2, '0')}
                </span>

                <span
                  className={`font-display flex-1 text-lg font-semibold tracking-tight transition-colors ${
                    isOpen ? 'text-[var(--kicker)]' : 'text-[var(--fg)] group-hover:text-[var(--kicker)]'
                  }`}
                >
                  {faq.question}
                </span>

                {/* Plus → minus, drawn from two rules. */}
                <span
                  aria-hidden="true"
                  className="relative mt-2 block h-3 w-3 shrink-0 text-[var(--fg)]"
                >
                  <span className="absolute top-1/2 left-0 h-0.5 w-full -translate-y-1/2 bg-current" />
                  <span
                    className={`absolute top-0 left-1/2 h-full w-0.5 -translate-x-1/2 bg-current transition-transform duration-150 ${
                      isOpen ? 'scale-y-0' : 'scale-y-100'
                    }`}
                  />
                </span>
              </button>
            </h3>

            <div
              id={panelId}
              role="region"
              aria-labelledby={triggerId}
              hidden={!isOpen}
              className="pb-8 sm:pl-12"
            >
              <p className="max-w-2xl text-base text-[var(--fg-soft)]">{faq.answer}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
