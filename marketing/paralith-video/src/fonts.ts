import { GEIST_WOFF2 } from './font-data';
import { CASCADIA_MONO_TTF } from './mono-font-data';

/**
 * Geist is the typeface Paralith bundles and paints its own first frame with, so the film
 * uses the exact same `.woff2` rather than a lookalike from a CDN.
 *
 * It is inlined as a data URI and declared `font-display: block`, with no `delayRender()`
 * anywhere near it. Two earlier full renders died three quarters of the way through on a
 * delayRender timeout: on one tab out of six the font's load promise never settled — and
 * neither did a `setTimeout` racing it, so the tab was wedged rather than merely slow.
 * Removing the fetch removes the failure mode. There is nothing left to await: the face is
 * available as soon as the stylesheet is parsed, which happens before the first frame is
 * ever painted.
 */
/**
 * Cascadia Mono is installed for the same reason and by the same means. It is not a stylistic
 * choice: `AppSettings::default()` in the Rust crate sets `terminal_font_family` to
 * "Cascadia Mono, Consolas, monospace", so this is the face a PARALITH terminal is drawn in on a
 * default install, and the terminals are what the film spends most of its running time on.
 */
const style = document.createElement('style');
style.textContent = `
@font-face {
  font-family: 'Geist';
  src: url(${GEIST_WOFF2}) format('woff2');
  font-weight: 100 900;
  font-style: normal;
  font-display: block;
}
@font-face {
  font-family: 'Cascadia Mono';
  src: url(${CASCADIA_MONO_TTF}) format('truetype');
  font-weight: 200 700;
  font-style: normal;
  font-display: block;
}`;
document.head.appendChild(style);

export {};
