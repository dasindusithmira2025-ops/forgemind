'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

/**
 * Every piece of motion on the site that is driven by scroll or pointer, run
 * from one mount.
 *
 * The alternative — a `<Reveal>` wrapper component per animated element — was
 * rejected on two counts. It forces a client boundary around content that is
 * otherwise static server-rendered markup, and it puts one IntersectionObserver
 * and one pointer listener on the page per element. Here a section opts in with
 * `data-reveal` on plain markup, stays a server component, and costs nothing
 * but a node in an observer that already exists.
 *
 * Nothing in this file writes React state. Scroll position and pointer position
 * both change at frame rate, and routing either through the render cycle is how
 * a page ends up dropping frames while scrolling. Both are published as CSS
 * custom properties instead, which the compositor can act on directly.
 */

/** Gap between successive members of a revealed group. */
const STAGGER_MS = 60;

/**
 * Members past this index all share the last delay. A twelve-cell matrix
 * staggered linearly would still be arriving a second after the reader got
 * there, which reads as the page being slow rather than as the page being
 * composed. Capped here, the slowest element in a band settles 940ms after it
 * enters view — the hero included, which is the case that has to feel quick.
 */
const STAGGER_CAP = 5;

export function MotionEngine() {
  const pathname = usePathname();

  /* --- Reading position -------------------------------------------------
     Published as `--scroll-p`, 0→1 across the scrollable length. Read by the
     rail bead and the header hairline. */
  useEffect(() => {
    const root = document.documentElement;
    let frame = 0;

    const write = () => {
      frame = 0;
      const scrollable = root.scrollHeight - root.clientHeight;
      root.style.setProperty(
        '--scroll-p',
        scrollable > 0 ? (root.scrollTop / scrollable).toFixed(4) : '0',
      );
    };

    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(write);
    };

    write();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule, { passive: true });

    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      root.style.removeProperty('--scroll-p');
    };
  }, []);

  /* --- Reveal on approach ------------------------------------------------
     Re-armed per route: an App Router navigation swaps the tree underneath a
     persistent layout, so the observer would otherwise be holding nodes that
     are no longer in the document while the incoming ones sit hidden forever. */
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add('is-revealed');
          // One-way. A section that fades back out as you scroll past turns
          // re-reading a page into a light show.
          observer.unobserve(entry.target);
        }
      },
      // Fire a little before the element reaches the fold, so the movement is
      // finished by the time it is squarely in view rather than starting there.
      { rootMargin: '0px 0px -10% 0px', threshold: 0.04 },
    );

    const armed = new WeakSet<Element>();

    const scan = () => {
      // Delays are assigned per group first: a member's delay depends on its
      // position among its siblings, which is not knowable one element at a
      // time.
      document.querySelectorAll<HTMLElement>('[data-reveal-group]').forEach((group) => {
        const members = group.querySelectorAll<HTMLElement>('[data-reveal]');
        members.forEach((member, index) => {
          if (armed.has(member)) return;
          member.style.setProperty(
            '--reveal-delay',
            `${Math.min(index, STAGGER_CAP) * STAGGER_MS}ms`,
          );
        });
      });

      document.querySelectorAll<HTMLElement>('[data-reveal]').forEach((element) => {
        if (armed.has(element)) return;
        armed.add(element);
        observer.observe(element);
      });
    };

    scan();

    // Catches anything the page reveals later — an opened accordion, the mobile
    // navigation, a form's success state.
    let rescan = 0;
    const mutations = new MutationObserver(() => {
      if (rescan) return;
      rescan = requestAnimationFrame(() => {
        rescan = 0;
        scan();
      });
    });
    mutations.observe(document.body, { childList: true, subtree: true });

    return () => {
      if (rescan) cancelAnimationFrame(rescan);
      mutations.disconnect();
      observer.disconnect();
    };
  }, [pathname]);

  /* --- Pointer light -----------------------------------------------------
     One delegated listener for every lit surface on the page. Coordinates are
     written to the hovered element as `--lx`/`--ly`; the gradient itself lives
     in CSS and is only composited when that element is also `:hover`, so a
     pointer crossing the page costs one `getBoundingClientRect` per frame and
     nothing else. */
  useEffect(() => {
    // Coarse pointers never hover, so the whole mechanism would be dead weight
    // — and on touch the light would be pinned wherever the last tap landed.
    if (!window.matchMedia('(pointer: fine)').matches) return;

    let frame = 0;
    let pending: { element: HTMLElement; x: number; y: number } | null = null;

    const flush = () => {
      frame = 0;
      if (!pending) return;
      const { element, x, y } = pending;
      element.style.setProperty('--lx', `${x}px`);
      element.style.setProperty('--ly', `${y}px`);
      pending = null;
    };

    const onPointerMove = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;

      const surface = target.closest<HTMLElement>('.lit, .lit-row');
      if (!surface) return;

      const rect = surface.getBoundingClientRect();
      pending = {
        element: surface,
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      };
      if (!frame) frame = requestAnimationFrame(flush);
    };

    window.addEventListener('pointermove', onPointerMove, { passive: true });

    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener('pointermove', onPointerMove);
    };
  }, []);

  return null;
}
