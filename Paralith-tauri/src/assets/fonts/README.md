# Bundled fonts

## Geist-Variable.woff2

Geist Sans (variable, weight 100–900) by Vercel, released under the SIL Open Font
License 1.1. Bundled rather than loaded from a CDN because Paralith is a desktop
application and must render identically offline and on first paint.

- Upstream: https://github.com/vercel/geist-font
- License: SIL OFL 1.1 — https://github.com/vercel/geist-font/blob/main/LICENSE.TXT

Geist is the UI typeface for the whole application (`--font-sans`). Monospace stays
a system stack (`--font-mono`) so terminal and editor glyph metrics match what the
OS ships.
