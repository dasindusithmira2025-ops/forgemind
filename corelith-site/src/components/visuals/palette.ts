"use client";

import { useEffect, useState } from "react";

/**
 * THE CORELITH VISUAL DNA.
 *
 * Every spatial graphic on this site is a different object, and they belong to
 * one family because they share this file rather than because they share a
 * model. What is common is the material, the light, the line weight, the blue,
 * and the timing — not the geometry.
 *
 * Colours are read from the CSS custom properties the rest of the page uses, so
 * a visual can never drift out of step with the sheet it stands on, and a theme
 * swap relights it rather than repainting it.
 */
export type VizPalette = {
  /** Fine graphite points. */
  point: string;
  /** Thin connections. Barely there — a visible wireframe is a crypto graphic. */
  line: string;
  /** Frosted white / translucent glass surfaces. */
  surface: string;
  /** Corelith blue. State, never structure. */
  accent: string;
  dark: boolean;
};

const FALLBACK: VizPalette = {
  point: "#586274",
  line: "rgba(12, 20, 35, 0.28)",
  surface: "rgba(255, 255, 255, 0.55)",
  accent: "#246bfd",
  dark: false,
};

export function readPalette(element: HTMLElement | null): VizPalette {
  if (typeof window === "undefined" || !element) return FALLBACK;

  // Read from the element itself rather than the document: custom properties
  // inherit, so a visual standing inside a section that redefines a role picks
  // that role up automatically.
  const styles = getComputedStyle(element);
  const read = (name: string, fallback: string) =>
    styles.getPropertyValue(name).trim() || fallback;

  return {
    point: read("--viz-point", FALLBACK.point),
    line: read("--viz-line", FALLBACK.line),
    surface: read("--viz-surface", FALLBACK.surface),
    accent: read("--accent", FALLBACK.accent),
    dark: read("--ground", "#ffffff").toLowerCase().startsWith("#0"),
  };
}

/** Re-reads on an explicit theme change and on a system theme change. */
export function usePalette(element: HTMLElement | null): VizPalette {
  const [palette, setPalette] = useState(FALLBACK);

  useEffect(() => {
    const update = () => setPalette(readPalette(element));
    update();

    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", update);

    return () => {
      observer.disconnect();
      media.removeEventListener("change", update);
    };
  }, [element]);

  return palette;
}

/**
 * The theme, read outside a canvas so a Stage can pick its lighting before the
 * scene mounts. Same three sources of truth as the boot script: an explicit
 * attribute wins, otherwise the system preference.
 */
export function useIsDark() {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const read = () => {
      const attribute = document.documentElement.getAttribute("data-theme");
      if (attribute === "dark") return true;
      if (attribute === "light") return false;
      return window.matchMedia("(prefers-color-scheme: dark)").matches;
    };
    const update = () => setDark(read());
    update();

    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", update);

    return () => {
      observer.disconnect();
      media.removeEventListener("change", update);
    };
  }, []);

  return dark;
}
