/**
 * The campaign film's typographic system.
 *
 * One family sets everything the film says: **Chakra Petch**, which is the face Corelith's own
 * site sets both its display and its reading copy in. Its squared terminals and slight
 * condensation are what let a headline sit under the PARALITH wordmark and read as the same voice
 * rather than as a caption someone added afterwards.
 *
 * Three things had to change from the Geist setting beyond the family name, because Chakra Petch
 * is a fundamentally different instrument:
 *
 * **Tracking goes positive, not negative.** A neutral grotesk like Geist is drawn tight and wants
 * negative tracking at display size. Chakra Petch is already condensed and its squared joins close
 * up badly — set at -0.02em the counters in `a`, `e` and `g` fill in at 60px and the line reads as
 * a smear. Everything here is tracked open, and the further from body size it goes, the more.
 *
 * **Weight comes down.** Chakra Petch's 600 carries about as much visual mass as Geist's 700. The
 * statements are set at 500 and the secondary lines at 400, where Geist needed 560 and 420.
 *
 * **Line height comes up.** Squared descenders and a tall x-height make tight leading feel
 * cramped, so display lines get 1.28 rather than 1.22.
 */

export const DISPLAY = '"Chakra Petch", "Segoe UI Variable", system-ui, sans-serif';
export const MONO = '"JetBrains Mono", "Cascadia Mono", ui-monospace, monospace';

/**
 * Type sizes in the 1920-wide design space. Everything multiplies by `useScale()`, so 4K and the
 * social formats stay in proportion.
 */
export const SIZE = {
  /** The film's one slogan, on its own frame. */
  statement: 64,
  /** A sequence's primary line. */
  primary: 50,
  /** A sequence's second, quieter line. */
  secondary: 37,
  /**
   * The same two in the 9:16 cut.
   *
   * These are expressed against a 1080-wide design space, not the 1920-wide one the landscape
   * sizes use — see `useCopyScale`. Set against 1920 they rendered at 22px in a 1080-wide frame,
   * which is smaller than this paragraph and unreadable on the device the cut exists for.
   */
  primaryPortrait: 62,
  secondaryPortrait: 47,
  /** Burned-in subtitles. Landscape basis. */
  caption: 29,
  /** Burned-in subtitles, 1080-wide basis. */
  captionPortrait: 44,
  /** The category line under the wordmark. */
  category: 22,
  /** Endcard company and domain. */
  fine: 17,
  /** Chrome labels in the opening sequence. */
  label: 11.5,
} as const;

/**
 * Tracking, in ems.
 *
 * Chakra Petch needs air. These are all positive — the largest sizes get the most, which is the
 * opposite of what a neutral grotesk wants and is why the previous setting looked wrong at 54px.
 */
export const TRACK = {
  statement: '0.005em',
  primary: '0.008em',
  secondary: '0.012em',
  caption: '0.015em',
  /** Letterspaced small caps, matched to the wordmark's own spacing. */
  category: '0.34em',
  fine: '0.24em',
  label: '0.14em',
} as const;

export const WEIGHT = {
  statement: 500,
  primary: 500,
  secondary: 400,
  caption: 400,
  category: 400,
  fine: 400,
} as const;

export const LEADING = {
  display: 1.28,
  caption: 1.34,
} as const;

/** Copy colours. The film spends no chroma on type — chroma belongs to product state. */
export const INK = {
  primary: '#fafafa',
  secondary: '#a8a8a8',
  category: '#b4b4b4',
  company: '#7a7a7a',
  domain: '#5c5c5c',
} as const;
