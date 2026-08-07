import { CHAKRA_PETCH, JETBRAINS_MONO } from './brand-font-data';

/**
 * The brand faces, installed the same way and for the same reason as `src/fonts.ts` installs
 * Geist and Cascadia Mono: inlined as data URIs, declared `font-display: block`, with no
 * `delayRender()` anywhere near them.
 *
 * Two earlier full renders of the explainer died three quarters of the way through on a
 * delayRender timeout because one tab out of six never settled its font-load promise. Removing the
 * fetch removes the failure mode — the faces are available as soon as the stylesheet is parsed,
 * which happens before the first frame is painted.
 *
 * Chakra Petch is the Corelith display and text face; JetBrains Mono is the brand's machine face.
 * Both come from `corelith-web`'s own font configuration rather than being picked here. Geist and
 * Cascadia Mono are still installed by `src/fonts.ts` — they are what the *product* is drawn in,
 * and the twin inside the film has to keep looking like the product.
 */

const faces = [
  ...CHAKRA_PETCH.map((face) => ({ family: 'Chakra Petch', ...face })),
  ...JETBRAINS_MONO.map((face) => ({ family: 'JetBrains Mono', ...face })),
];

const style = document.createElement('style');
style.textContent = faces
  .map(
    (face) => `
@font-face {
  font-family: '${face.family}';
  src: url(${face.src}) format('woff2');
  font-weight: ${face.weight};
  font-style: normal;
  font-display: block;
}`,
  )
  .join('\n');
document.head.appendChild(style);

export {};
