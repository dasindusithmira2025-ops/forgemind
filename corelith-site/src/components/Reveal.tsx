"use client";

import { useEffect } from "react";

/**
 * One IntersectionObserver for the whole document, mounted once in the layout.
 *
 * Reveal state is a data attribute, not React state: elements declare their
 * gesture with a class in the markup and stay server-rendered, and the observer
 * only ever stamps `data-inview` on them. Nothing re-renders when you scroll.
 *
 * Two properties matter more than the animation itself:
 *
 * - The hidden state lives behind `[data-reveal]`, set here. Until this
 *   component runs, every reveal element is simply visible — so a failure
 *   anywhere in this file leaves a readable page instead of a blank one.
 * - A MutationObserver picks up elements added later by client navigation or a
 *   state change, which is the case a mount-time query silently misses.
 *
 * Elements are unobserved once revealed: the gesture is an arrival, not a
 * scroll-linked effect, and replaying it on the way back up reads as a page
 * that cannot sit still.
 */
export function RevealRoot() {
  useEffect(() => {
    const root = document.documentElement;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const selector = ".reveal, .reveal-wipe, .reveal-rule";
    const mark = (element: Element) => element.setAttribute("data-inview", "");

    if (reduced) {
      document.querySelectorAll(selector).forEach(mark);
      return;
    }

    root.setAttribute("data-reveal", "");

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          mark(entry.target);
          observer.unobserve(entry.target);
        }
      },
      // Any part on screen is the trigger. A ratio threshold looks more
      // considered and is wrong: an element taller than the viewport can never
      // reach it, so the tallest headings on the site would be the ones that
      // never arrive.
      { rootMargin: "0px 0px -8% 0px", threshold: 0 },
    );

    const scan = (scope: ParentNode) => {
      scope.querySelectorAll(`${selector}`).forEach((element) => {
        if (element.hasAttribute("data-inview")) return;
        observer.observe(element);
      });
    };

    scan(document);

    const mutations = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (!(node instanceof Element)) continue;
          if (node.matches(selector) && !node.hasAttribute("data-inview")) observer.observe(node);
          scan(node);
        }
      }
    });
    mutations.observe(document.body, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      mutations.disconnect();
      root.removeAttribute("data-reveal");
    };
  }, []);

  return null;
}
