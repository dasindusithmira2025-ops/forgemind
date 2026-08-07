'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { siteConfig } from '@/config/site';

/**
 * The furniture in the trim.
 *
 * On a display wider than the measure, the page has always been a column of
 * content with two bare strips beside it. This puts the strips to work the way
 * a press sheet does: a knocked-back trim area, registration marks at the
 * corners, the plate label set vertically, a ruler carrying the reading
 * position, and a chapter readout that tracks the section under the fold.
 *
 * It is decoration in the strict sense — every fact it shows is stated
 * somewhere in the measure as well — so all of it bar the return control is
 * hidden from assistive technology, and none of it appears below 1440px, where
 * the measure already fills the window and there is no trim to print on.
 *
 * Chapters are discovered from the DOM rather than passed down: section headers
 * publish `data-chapter`, so a page gets a working readout by using the
 * standard section opener and nothing else.
 */

/** Where in the viewport a section is considered to have become the current one. */
const CHAPTER_LINE = 0.42;

export function PressRails() {
  const pathname = usePathname();

  /**
   * Labels in document order. The readout counts position in this list rather
   * than reprinting the index a section prints beside its own heading: those
   * indices are authored per band and skip the bands that carry no heading, so
   * a page can legitimately run 02, 03, 05 and "05 / 04" would be nonsense.
   * This is a reading position, and it is always position over total.
   */
  const [chapters, setChapters] = useState<string[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);

  const percentRef = useRef<HTMLSpanElement | null>(null);
  const topRef = useRef<HTMLButtonElement | null>(null);

  /* --- Chapter discovery ------------------------------------------------
     The rails read the page rather than being told about it, which is what
     keeps the trim working on a page that has never heard of it. */
  useEffect(() => {
    let frame = 0;

    const sync = () => {
      frame = 0;
      const next = Array.from(document.querySelectorAll<HTMLElement>('[data-chapter]')).map(
        (element) => element.dataset.chapter ?? '',
      );
      // Identity is preserved when nothing moved, so the observer below can
      // fire as often as the page mutates without ever causing a render.
      setChapters((current) =>
        current.length === next.length && current.every((label, i) => label === next[i])
          ? current
          : next,
      );
    };

    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(sync);
    };

    // Scheduled rather than run inline: the first read has to happen after the
    // route's tree has committed, and a route can commit in more than one pass.
    schedule();

    // Re-read whenever the document changes shape — an opened accordion, a
    // client-side navigation, a form swapping in its success state.
    const mutations = new MutationObserver(schedule);
    mutations.observe(document.body, { childList: true, subtree: true });

    return () => {
      if (frame) cancelAnimationFrame(frame);
      mutations.disconnect();
    };
  }, [pathname]);

  /* --- Frame loop --------------------------------------------------------
     The percentage and the return control are written straight to the DOM. They
     change on every scroll frame and on a threshold respectively, and neither
     is worth a render — the chapter is the only thing here that goes through
     React, because it is the only thing that changes rarely enough to be worth
     the reconciliation. */
  useEffect(() => {
    const root = document.documentElement;
    let frame = 0;

    const tick = () => {
      frame = 0;

      const scrollable = root.scrollHeight - root.clientHeight;
      const progress = scrollable > 0 ? root.scrollTop / scrollable : 0;

      if (percentRef.current) {
        percentRef.current.textContent = `${Math.round(progress * 100)}`.padStart(2, '0');
      }
      if (topRef.current) {
        topRef.current.dataset.visible = String(root.scrollTop > root.clientHeight * 0.75);
      }

      const line = root.clientHeight * CHAPTER_LINE;
      const marks = document.querySelectorAll<HTMLElement>('[data-chapter]');
      let current = 0;
      marks.forEach((mark, i) => {
        if (mark.getBoundingClientRect().top <= line) current = i;
      });
      setActiveIndex(current);
    };

    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(tick);
    };

    // Deferred to the next frame for the same reason as the discovery pass:
    // measuring section positions is only meaningful once the tree has laid out.
    schedule();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule, { passive: true });

    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
    };
  }, [chapters]);

  const toTop = useCallback(() => {
    window.scrollTo({
      top: 0,
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    });
  }, []);

  const active = chapters[activeIndex];
  const position = String(Math.min(activeIndex + 1, chapters.length)).padStart(2, '0');
  const total = String(chapters.length).padStart(2, '0');

  return (
    <div className="furniture">
      {/* ── Left trim: plate label, ruler, reading position ─────────────── */}
      <div className="trim trim-l" aria-hidden="true">
        <span className="trim-scan" />
        <span className="trim-mark trim-mark-tl" />
        <span className="trim-mark trim-mark-bl" />

        <div className="rail rail-l">
          <span className="rail-type stamp text-ink-faint">{siteConfig.name} — press proof</span>

          <div className="rail-ruler">
            <span className="rail-bead" />
          </div>

          <span className="stamp text-ink-faint tabular">
            <span ref={percentRef}>00</span>%
          </span>
        </div>
      </div>

      {/* The sheet. Nothing is printed here — this column exists only to hold
          the measure's width so the two trims land exactly on its edges. */}
      <div />

      {/* ── Right trim: chapter readout ─────────────────────────────────── */}
      <div className="trim trim-r">
        <span aria-hidden="true" className="trim-scan" />
        <span aria-hidden="true" className="trim-mark trim-mark-tr" />
        <span aria-hidden="true" className="trim-mark trim-mark-br" />

        {/* The readout duplicates the section index already printed beside every
            section mark, so it is announced nowhere. The return control is a
            genuine action and stays exposed — which is why `aria-hidden` is
            applied to the decorative pieces here rather than to the column. */}
        <div className="rail rail-r">
          {active ? (
            <span
              key={`${pathname}-${activeIndex}`}
              aria-hidden="true"
              className="rail-chapter flex flex-col items-center gap-2"
            >
              <span className="stamp text-core-ink tabular">{position}</span>
              <span className="h-4 w-px bg-[var(--hair-strong)]" />
              <span className="stamp text-ink-faint tabular">{total}</span>
            </span>
          ) : (
            <span aria-hidden="true" className="stamp text-ink-faint tabular">
              —
            </span>
          )}

          {active ? (
            <span
              key={`${pathname}-${activeIndex}-label`}
              aria-hidden="true"
              className="rail-chapter rail-type stamp text-ink-soft max-h-[46vh]"
            >
              {active}
            </span>
          ) : (
            <span aria-hidden="true" className="rail-ruler" />
          )}

          <button
            ref={topRef}
            type="button"
            onClick={toTop}
            data-visible="false"
            className="rail-top stamp"
            aria-label="Back to top"
          >
            <span aria-hidden="true">↑</span>
          </button>
        </div>
      </div>
    </div>
  );
}
