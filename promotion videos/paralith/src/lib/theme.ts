export const C = {
  deep: "#05070b",
  base: "#090d13",
  s1: "#0e1217",
  s2: "#13181e",
  s3: "#181d24",
  s4: "#1d232b",

  text: "#e8ebef",
  text2: "#a0a7b0",
  muted: "#69717c",
  faint: "#4c535d",

  accent: "#4f86ea",
  cyan: "#22d3ee",
  violet: "#8b5cf6",

  success: "#4fac82",
  warning: "#d3a84f",
  danger: "#d35f6f",
  agent: "#8a72d8",
  ready: "#4ca9a5",

  lineFaint: "rgba(255,255,255,0.04)",
  line: "rgba(255,255,255,0.075)",
  lineStrong: "rgba(255,255,255,0.14)",
} as const;

export const FONT = "'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif";
export const MONO = "'JetBrains Mono', 'SFMono-Regular', Consolas, monospace";

/** Brand gradient, cyan -> blue -> violet. */
export const BRAND_GRADIENT = `linear-gradient(115deg, ${C.cyan} 0%, ${C.accent} 48%, ${C.violet} 100%)`;

export const LAYOUT = {
  width: 1920,
  height: 1080,
  margin: 132,
} as const;
