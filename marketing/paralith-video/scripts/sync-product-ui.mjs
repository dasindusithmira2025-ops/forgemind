// Derives the film's product-UI layer from the PARALITH desktop source.
//
// The brand film claims to show the real product. That claim is only worth anything if the
// pixels come from the product's own source rather than from a designer's recollection of it,
// so nothing in `src/product/generated/` is written by hand:
//
//   Paralith-tauri/src/index.css      -> generated/paralith-ui.css   (the real stylesheet)
//   Paralith-tauri/src/theme/*.ts     -> generated/theme.ts          (the real `paralith-dark`)
//
// The theme is not transcribed either. `toCssVars` and `CONCRETE_THEMES` are pure, DOM-free
// modules, so this script imports them directly (Node strips the types) and calls the same
// function the application calls at startup. A palette drift in the product is therefore a
// palette drift in the film, by construction.
//
//   node scripts/sync-product-ui.mjs           regenerate
//   node scripts/sync-product-ui.mjs --check   fail if the checked-in output has drifted
//
// `--check` is what keeps the twin honest in CI: it re-derives everything in memory and
// compares, so a merged change to the product's stylesheet or theme cannot silently leave a
// stale film behind.

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const VIDEO_ROOT = resolve(HERE, '..');
const PRODUCT_ROOT = resolve(VIDEO_ROOT, '../../Paralith-tauri');
const OUT_DIR = join(VIDEO_ROOT, 'src/product/generated');

const SOURCE_CSS = join(PRODUCT_ROOT, 'src/index.css');
const SOURCE_THEMES = join(PRODUCT_ROOT, 'src/theme/themes.ts');
const SOURCE_TOKENS = join(PRODUCT_ROOT, 'src/theme/tokens.ts');

/** The theme the film shoots on: the product's own default. */
const THEME_ID = 'paralith-dark';

/** The CSS container the product window establishes; see `scopeBreakpointsToWindow`. */
const CONTAINER_NAME = 'paralith-window';

const sha256 = (value) => createHash('sha256').update(normalize(value)).digest('hex');
const rel = (path) => relative(VIDEO_ROOT, path).replaceAll('\\', '/');

/**
 * Line endings are not content. Git rewrites them on checkout according to each machine's
 * config, so both the drift comparison and the recorded source hashes work on normalised text —
 * otherwise the same source would hash differently on the Windows runner than on the machine
 * that generated it.
 */
function normalize(text) {
  return text.replace(/\r\n/g, '\n');
}

/**
 * The product bundles Geist from its own `src/assets`, which does not exist here. The film
 * installs the identical `.woff2` itself (see `src/fonts.ts`), so the rule is dropped rather
 * than rewritten — leaving a broken `url()` in place would make every render log a 404.
 */
function stripFontFace(css) {
  const start = css.indexOf('@font-face');
  if (start === -1) return { css, stripped: false };
  const end = css.indexOf('}', start);
  if (end === -1) return { css, stripped: false };
  return { css: `${css.slice(0, start)}${css.slice(end + 1)}`.replace(/\n{3,}/g, '\n\n'), stripped: true };
}

/**
 * Re-points the responsive breakpoints from the viewport to the product window.
 *
 * In the application the window *is* the viewport, so a 1440-wide PARALITH window is exactly
 * what `@media (max-width: 1440px)` describes. In the film the window is a 1440-wide box inside
 * a 1920 or 3840 canvas, so those same rules would silently never fire and the film would show a
 * layout no user has — wider chrome, labels the real window hides. Rewriting the width queries
 * as container queries against the window element restores the product's real behaviour: the
 * twin reflows off its own width, exactly as the app does.
 *
 * Only width queries move. `prefers-reduced-motion` is a user preference, not a size, and stays
 * a media query so the render environment keeps answering it.
 */
function scopeBreakpointsToWindow(css) {
  let rewritten = 0;
  const out = css.replace(/@media\s*\(\s*(max|min)-width:\s*([\d.]+)px\s*\)/g, (_match, bound, px) => {
    rewritten += 1;
    return `@container ${CONTAINER_NAME} (${bound}-width: ${px}px)`;
  });
  return { css: out, rewritten };
}

async function buildCss() {
  const source = await readFile(SOURCE_CSS, 'utf8');

  const { css: withoutFace, stripped } = stripFontFace(source);
  if (!stripped) {
    throw new Error(`Expected an @font-face rule in ${rel(SOURCE_CSS)}; the strip step is now wrong.`);
  }

  const { css, rewritten } = scopeBreakpointsToWindow(withoutFace);
  if (rewritten === 0) {
    throw new Error(
      `No width breakpoints found in ${rel(SOURCE_CSS)}. Either the product dropped its responsive ` +
        'rules or their syntax changed; the container-query rewrite is now wrong.',
    );
  }

  const header = [
    '/* GENERATED FILE — DO NOT EDIT.',
    ` * Source:  ${rel(SOURCE_CSS)}`,
    ` * SHA-256: ${sha256(source)}`,
    ' * Regenerate: npm run sync:product',
    ' *',
    ' * This is the PARALITH desktop stylesheet, verbatim except for two mechanical edits:',
    ' *   1. Its @font-face rule is dropped — the film installs the same Geist face itself.',
    ` *   2. Its ${rewritten} width breakpoints became @container ${CONTAINER_NAME} queries, so the`,
    " *      twin reflows off the product window's width instead of the film canvas's.",
    ' *',
    ' * Every class the product-twin components use — .app-shell, .ws-row, .fleet-cell,',
    ' * .terminal-pane, .terminal-header — is defined here, by the product, so the film cannot',
    ' * drift into a lookalike.',
    ' */',
    '',
  ].join('\n');

  return header + css;
}

async function buildTheme() {
  const [themes, tokens] = await Promise.all([
    import(pathToFileURL(SOURCE_THEMES).href),
    import(pathToFileURL(SOURCE_TOKENS).href),
  ]);

  const theme = themes.CONCRETE_THEMES[THEME_ID];
  if (!theme) throw new Error(`Theme '${THEME_ID}' is no longer defined in ${rel(SOURCE_THEMES)}.`);

  const vars = tokens.toCssVars(theme);
  const missing = tokens.REQUIRED_CSS_VARS.filter((name) => !(name in vars));
  if (missing.length > 0) {
    throw new Error(`toCssVars omitted required variables: ${missing.join(', ')}`);
  }

  const [themesSource, tokensSource] = await Promise.all([
    readFile(SOURCE_THEMES, 'utf8'),
    readFile(SOURCE_TOKENS, 'utf8'),
  ]);

  const entry = ([name, value]) => `  ${JSON.stringify(name)}: ${JSON.stringify(value)},`;

  return [
    '/* GENERATED FILE — DO NOT EDIT.',
    ` * Source:  ${rel(SOURCE_THEMES)} (sha-256 ${sha256(themesSource)})`,
    ` *          ${rel(SOURCE_TOKENS)} (sha-256 ${sha256(tokensSource)})`,
    ' * Regenerate: npm run sync:product',
    ' *',
    ` * Produced by calling the product's own toCssVars() on its own '${THEME_ID}' definition —`,
    ' * the exact call the application makes when it paints its first frame.',
    ' */',
    '',
    `/** Every CSS custom property the product sets on <html> for '${THEME_ID}'. */`,
    'export const PARALITH_DARK_VARS: Readonly<Record<string, string>> = Object.freeze({',
    ...Object.entries(vars).map(entry),
    '});',
    '',
    '/** The xterm.js palette the product hands to its terminals. Agent output is drawn in these. */',
    'export const PARALITH_TERMINAL = Object.freeze({',
    ...Object.entries(theme.terminal).map(entry),
    '});',
    '',
    `/** Display metadata for '${THEME_ID}', so on-screen theme names stay true as well. */`,
    'export const PARALITH_THEME_META = Object.freeze({',
    ...Object.entries({ id: theme.id, name: theme.name, description: theme.description }).map(entry),
    '});',
    '',
  ].join('\n');
}

async function main() {
  const check = process.argv.includes('--check');

  const artifacts = [
    { path: join(OUT_DIR, 'paralith-ui.css'), content: await buildCss() },
    { path: join(OUT_DIR, 'theme.ts'), content: await buildTheme() },
  ];

  if (check) {
    const drifted = [];
    for (const { path, content } of artifacts) {
      const current = await readFile(path, 'utf8').catch(() => null);
      // Compare on content, not bytes. Git normalises line endings on checkout, so on a Windows
      // runner these files arrive with CRLF while the generator always writes LF — without this,
      // a freshly checked-out tree would report drift on every generated file, every time.
      if (current === null || normalize(current) !== normalize(content)) drifted.push(rel(path));
    }
    if (drifted.length > 0) {
      console.error(
        `Product-UI twin is stale: ${drifted.join(', ')}\n` +
          'The PARALITH stylesheet or theme changed since these were generated.\n' +
          'Run `npm run sync:product` and commit the result.',
      );
      process.exit(1);
    }
    console.log(`Product-UI twin is in sync with ${rel(PRODUCT_ROOT)} (${artifacts.length} artifacts).`);
    return;
  }

  await mkdir(OUT_DIR, { recursive: true });
  for (const { path, content } of artifacts) {
    await writeFile(path, content, 'utf8');
    console.log(`wrote ${rel(path)} (${content.length.toLocaleString()} bytes)`);
  }
}

await main();
