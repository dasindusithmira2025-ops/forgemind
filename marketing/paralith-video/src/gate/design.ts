import { useVideoConfig } from 'remotion';

/**
 * The gate film's design system.
 *
 * The earlier films are lit like product photography — a window floating in a dark room with a key
 * light, a contact shadow and a floor reflection. This one is drawn like a **schematic that
 * happens to be lit**: flat planes, hairlines, hard corners, and one horizontal rule running the
 * whole length of the film. There is no bloom, no reflection, no perspective and no rounded
 * container anywhere in it. That is not minimalism for its own sake; it is because the film's
 * subject is a mechanism, and a mechanism drawn with soft edges looks like it might yield.
 *
 * Colour follows PARALITH's own rule, which is that chroma is reserved for meaning. The chrome is
 * achromatic. The three chromatic values in the film are the product's own tokens, and each one is
 * allowed to mean exactly one thing:
 *
 *   accent  `--accent`   the work itself — the token travelling the rail, and nothing else
 *   pass    `--success`  a condition that has been satisfied
 *   fail    `--warning`  a condition that has not, and has therefore stopped
 *
 * There is no fourth. If something on screen needs to be noticed and is not one of those three, it
 * gets brighter, not more colourful.
 */

/* ---- Scale ------------------------------------------------------------------------------------
 *
 * Everything in this film is authored in a 1920×1080 design space and multiplied. `useScale` is the
 * width ratio and is what every dimension passes through; `useFrameBox` reports the design-space
 * rectangle actually available, which is what the vertical and square deliveries read instead of
 * assuming 1920×1080.
 */

export const useScale = (): number => {
  const { width } = useVideoConfig();
  return width / 1920;
};

export interface FrameBox {
  /** Design-space width of the delivered frame. 1920 in landscape. */
  width: number;
  /** Design-space height of the delivered frame. 1080 in landscape. */
  height: number;
  portrait: boolean;
  square: boolean;
}

export const useFrameBox = (): FrameBox => {
  const { width, height } = useVideoConfig();
  const k = width / 1920;
  const designHeight = height / k;
  const ratio = width / height;
  return {
    width: 1920,
    height: designHeight,
    portrait: ratio < 0.95,
    square: ratio >= 0.95 && ratio < 1.2,
  };
};

/* ---- Ink --------------------------------------------------------------------------------------- */

/**
 * The achromatic ramp. Six steps, and the film uses all six — a schematic drawn in two greys reads
 * as a wireframe, and the difference between a wireframe and a designed frame is the number of
 * distinct values it can hold apart at 1px.
 */
export const INK = {
  /** The field. PARALITH's own `--bg`, not pure black: a true #000 crushes the 1px rules into it. */
  field: '#070707',
  /** Panel fills, from the product's `--surface` family. */
  surface: '#141414',
  surfaceLift: '#1c1c1c',
  /** Rules. `line` is structural, `hair` is subdivision, `edge` is a lit border on a raised plane. */
  hair: 'rgba(255,255,255,0.06)',
  line: 'rgba(255,255,255,0.12)',
  edge: 'rgba(255,255,255,0.22)',
  /** Type. */
  bright: '#f6f6f6',
  text: '#cfcfcf',
  muted: '#8d8d8d',
  faint: '#5e5e5e',
  ghost: '#3a3a3a',
} as const;

/** The three meanings. Sampled from `Paralith-tauri/src/theme/tokens.ts`. */
export const STATE = {
  accent: '#a78bfa',
  accentSoft: 'rgba(167,139,250,0.16)',
  accentEdge: 'rgba(167,139,250,0.42)',
  pass: '#86efac',
  passSoft: 'rgba(134,239,172,0.14)',
  fail: '#fbbf24',
  failSoft: 'rgba(251,191,36,0.14)',
} as const;

/* ---- Type ---------------------------------------------------------------------------------------
 *
 * Two faces and a strict division of labour, which is different from how the earlier films set
 * type. There, Chakra Petch set everything and the mono was decoration. Here the split carries
 * meaning: **the machine speaks in mono and the film speaks in Chakra Petch.** Every string that
 * the product would actually render — branch names, check names, states, paths, the instruction
 * itself — is monospaced. Every string that is the film talking to the viewer is not. A viewer
 * never has to wonder which of the two they are reading.
 */

export const DISPLAY = '"Chakra Petch", "Segoe UI Variable", system-ui, sans-serif';
export const MONO = '"JetBrains Mono", "Cascadia Mono", ui-monospace, monospace';

/** Design-space type sizes, landscape basis. */
export const SIZE = {
  /** The endcard's one slogan. */
  statement: 62,
  /** A sequence's primary line. */
  primary: 46,
  /** A sequence's second, quieter line. */
  secondary: 34,
  /** The same two against a 1080-wide basis for the 9:16 cut. See `useCopyScale`. */
  primaryPortrait: 58,
  secondaryPortrait: 43,
  /** Burned-in subtitles, landscape and portrait bases. */
  caption: 28,
  captionPortrait: 42,
  /** The station name, set in small caps above the rail. */
  station: 15,
  /** Machine text: branches, checks, paths, states. */
  machine: 15,
  machineSmall: 12.5,
  /** The instruction as it is typed. */
  instruction: 27,
  /** The ledger along the bottom. */
  ledger: 12,
  /** Endcard category, company, domain. */
  category: 21,
  fine: 16,
} as const;

/**
 * Tracking. Chakra Petch is condensed with squared joins and closes up badly when tracked negative,
 * so every sans value here is positive and the largest sizes get the most. JetBrains Mono is drawn
 * open already and only the small-cap uses need help.
 */
export const TRACK = {
  statement: '0.004em',
  primary: '0.008em',
  secondary: '0.012em',
  caption: '0.015em',
  station: '0.32em',
  category: '0.34em',
  fine: '0.22em',
  machine: '0.01em',
  ledger: '0.04em',
} as const;

export const WEIGHT = {
  statement: 500,
  primary: 500,
  secondary: 400,
  machine: 400,
  machineStrong: 500,
} as const;

export const LEADING = { display: 1.26, caption: 1.34, machine: 1.5 } as const;

/**
 * The copy scale.
 *
 * Display copy is authored against the *narrow* edge of the frame, not the wide one. Set against
 * 1920 in a 1080-wide vertical delivery, a 46px line renders at 26px — smaller than the machine
 * text underneath it. This returns the multiplier that keeps a statement the same optical size
 * relative to the frame it is delivered in.
 */
export const useCopyScale = (): { k: number; portrait: boolean } => {
  const { width, height } = useVideoConfig();
  const portrait = width / height < 0.95;
  return { k: portrait ? width / 1080 : width / 1920, portrait };
};

/* ---- Geometry ------------------------------------------------------------------------------------ */

/**
 * The film's one grid unit. Every gap, inset, panel height and lane pitch in the gate film is a
 * multiple of this, which is why panels line up across sequences that were never drawn together.
 */
export const U = 12;

/** Panel corner radius. Two pixels. A schematic does not have rounded corners; it has cut ones. */
export const RADIUS = 2;
