import type { ThemeDefinition } from './tokens'

/**
 * The concrete PARALITH themes.
 *
 * All five share one *genome* — the structural rules that make the app read as a single product
 * regardless of which palette is active:
 *
 * 1. **Achromatic surfaces.** Canvas → card → raised → overlay is a pure neutral luminance ladder.
 *    Nothing in the chrome is tinted toward the accent.
 * 2. **Alpha hairline borders.** Dividers are a translucent wash of the foreground, not an opaque
 *    grey. They therefore stay correct on every surface in the ladder instead of reading heavy on
 *    the canvas and invisible on a popover.
 * 3. **Neutral solid controls.** The highest-emphasis button is a near-white (dark themes) or
 *    near-black (light themes) fill. Chroma is reserved for meaning.
 * 4. **Neutral selection.** Hover / selected / pressed are steps on the same neutral ladder; the
 *    accent appears only as the 2px state edge.
 * 5. **Neutral focus ring.** Focus is a soft 3px ring in a mid-grey, so it reads as focus rather
 *    than as a second brand accent.
 * 6. **Colourblind-safe identity hues.** Role and Git-lane colours come from the IBM
 *    colourblind-safe set (blue #648fff, indigo #785ef0, magenta #dc267f, orange #fe6100,
 *    amber #ffb000, teal #40b0a6) so a Scout is never confused with a Debugger.
 *
 * `paralith-dark` is the default and defines the reference values; the others move the ladder's
 * temperature and contrast without changing any of the six rules above.
 *
 * `system` is not defined here — it is resolved to `paralith-dark` or `arctic-light` at runtime
 * (see registry.ts) so previews and application always derive from a real concrete theme.
 */

/* Editor surfaces stay one step lighter than the app canvas on dark themes. Code is read for
   minutes at a time; a pure near-black behind syntax colour crushes the low-luminance tokens. */

const paralithDark: ThemeDefinition = {
  id: 'paralith-dark',
  name: 'Paralith Dark',
  description: 'Neutral near-black surfaces, hairline borders, iris state edge.',
  category: 'dark',
  version: 2,
  preview: { hint: 'Neutral near-black, iris edge' },
  colors: {
    background: {
      canvas: '#0a0a0a', surface: '#171717', surfaceRaised: '#1f1f1f', surfaceOverlay: '#262626',
      sidebar: '#171717', input: '#212121', hover: '#2e2e2e', selected: '#454545',
      pressed: '#383838', disabled: '#1a1a1a',
    },
    foreground: {
      primary: '#fafafa', strong: '#ffffff', secondary: '#d4d4d4', muted: '#a1a1a1',
      disabled: '#737373', onAccent: '#1b1035',
    },
    border: {
      default: 'rgb(255 255 255 / 0.07)', subtle: 'rgb(255 255 255 / 0.045)',
      strong: 'rgb(255 255 255 / 0.15)', accent: 'color-mix(in srgb, #a78bfa 35%, transparent)',
    },
    accent: {
      primary: '#a78bfa', hover: '#c4b5fd', active: '#8b5cf6',
      soft: 'color-mix(in srgb, #a78bfa 12%, transparent)',
      edge: '#a78bfa', contrast: '#1b1035',
    },
    control: {
      primary: '#e5e5e5', primaryHover: '#f5f5f5', primaryActive: '#cfcfcf', onPrimary: '#171717',
      secondary: '#262626', secondaryHover: '#333333', onSecondary: '#fafafa',
      card: '#171717', popover: '#1f1f1f', ring: '#737373',
    },
    status: {
      success: '#86efac',
      successSoft: 'color-mix(in srgb, #86efac 10%, transparent)',
      successBorder: 'color-mix(in srgb, #86efac 25%, transparent)',
      warning: '#fbbf24',
      warningSoft: 'color-mix(in srgb, #fbbf24 10%, transparent)',
      warningBorder: 'color-mix(in srgb, #fbbf24 25%, transparent)',
      warningText: '#fcd34d',
      error: '#ff6568',
      errorSoft: 'color-mix(in srgb, #ff6568 12%, transparent)',
      errorBorder: 'color-mix(in srgb, #ff6568 28%, transparent)',
      errorText: '#ffc4c5',
      info: '#60a5fa',
      working: '#86efac', waiting: '#fbbf24', blocked: '#ff6568',
      unread: '#60a5fa', offline: '#6e6e6e', idle: '#a1a1a1',
    },
    git: {
      added: '#81b88b', modified: '#e2c08d', deleted: '#c74e39', renamed: '#73c991',
      untracked: '#6e6e6e', branch: '#3794ff', review: '#b66dff', conflict: '#ea5c00',
    },
    agent: { claude: '#d97757', codex: '#a1a1a1', generic: '#737373', action: '#a78bfa' },
    proof: { verified: '#86efac', partial: '#fbbf24', missing: '#6e6e6e', failed: '#ff6568' },
    role: {
      coordinator: '#648fff', scout: '#40b0a6', builder: '#785ef0',
      reviewer: '#ffb000', debugger: '#fe6100', integrator: '#dc267f',
    },
    risk: { low: '#86efac', medium: '#fbbf24', high: '#fe6100', critical: '#ff6568' },
    diff: {
      addedText: '#a7dcb4', removedText: '#f0b3a5',
      addedBackground: 'color-mix(in srgb, #81b88b 12%, transparent)',
      removedBackground: 'color-mix(in srgb, #c74e39 14%, transparent)',
      modified: '#e2c08d',
    },
    effects: {
      focusRing: '#737373', scrim: 'rgb(0 0 0 / 0.6)',
      scrollbarThumb: 'color-mix(in srgb, #a1a1a1 28%, transparent)',
      scrollbarThumbHover: 'color-mix(in srgb, #a1a1a1 48%, transparent)',
      shadowLow: '0 1px 2px rgb(0 0 0 / 0.24)',
      shadowMedium: '0 8px 20px rgb(0 0 0 / 0.28), 0 2px 6px rgb(0 0 0 / 0.2)',
      shadowHigh: '0 16px 40px rgb(0 0 0 / 0.45), 0 6px 16px rgb(0 0 0 / 0.3)',
    },
  },
  terminal: {
    background: '#0a0a0a', foreground: '#d4d4d4', cursor: '#a78bfa', cursorAccent: '#0a0a0a',
    selection: 'rgb(167 139 250 / 0.28)',
    black: '#171717', red: '#ff6568', green: '#86efac', yellow: '#fbbf24', blue: '#60a5fa',
    magenta: '#c4b5fd', cyan: '#40b0a6', white: '#d4d4d4',
    brightBlack: '#737373', brightRed: '#ff8b8d', brightGreen: '#a7f3c4', brightYellow: '#fcd34d',
    brightBlue: '#93c5fd', brightMagenta: '#ddd0ff', brightCyan: '#67d4ca', brightWhite: '#fafafa',
  },
  editor: {
    base: 'vs-dark', background: '#1e1e1e', foreground: '#fafafa', lineHighlight: '#252525',
    selection: '#3a3550', gutter: '#1e1e1e', cursor: '#a78bfa', lineNumber: '#737373',
    lineNumberActive: '#d4d4d4', indentGuide: '#333333', widgetBackground: '#252526',
    diffInserted: 'rgb(129 184 139 / 0.14)', diffRemoved: 'rgb(199 78 57 / 0.16)',
  },
}

const graphite: ThemeDefinition = {
  id: 'graphite',
  name: 'Graphite',
  description: 'Cool zinc surfaces with a silver state edge and no brand chroma.',
  category: 'dark',
  version: 2,
  preview: { hint: 'Cool zinc, silver edge' },
  colors: {
    background: {
      canvas: '#0c0c0e', surface: '#18181b', surfaceRaised: '#212124', surfaceOverlay: '#27272a',
      sidebar: '#18181b', input: '#232326', hover: '#2f2f33', selected: '#46464c',
      pressed: '#3a3a3f', disabled: '#1b1b1e',
    },
    foreground: {
      primary: '#fafafa', strong: '#ffffff', secondary: '#d4d4d8', muted: '#a1a1aa',
      disabled: '#71717a', onAccent: '#18181b',
    },
    border: {
      default: 'rgb(255 255 255 / 0.07)', subtle: 'rgb(255 255 255 / 0.045)',
      strong: 'rgb(255 255 255 / 0.15)', accent: 'color-mix(in srgb, #d4d4d8 30%, transparent)',
    },
    /* Graphite's identity is the *absence* of chroma: the state edge is a bright silver, so the
       only colour on screen is status, Git and role signal. */
    accent: {
      primary: '#d4d4d8', hover: '#f4f4f5', active: '#a1a1aa',
      soft: 'color-mix(in srgb, #d4d4d8 10%, transparent)',
      edge: '#d4d4d8', contrast: '#18181b',
    },
    control: {
      primary: '#e4e4e7', primaryHover: '#f4f4f5', primaryActive: '#c9c9ce', onPrimary: '#18181b',
      secondary: '#27272a', secondaryHover: '#34343a', onSecondary: '#fafafa',
      card: '#18181b', popover: '#212124', ring: '#71717a',
    },
    status: {
      success: '#86efac',
      successSoft: 'color-mix(in srgb, #86efac 10%, transparent)',
      successBorder: 'color-mix(in srgb, #86efac 25%, transparent)',
      warning: '#fbbf24',
      warningSoft: 'color-mix(in srgb, #fbbf24 10%, transparent)',
      warningBorder: 'color-mix(in srgb, #fbbf24 25%, transparent)',
      warningText: '#fcd34d',
      error: '#ff6568',
      errorSoft: 'color-mix(in srgb, #ff6568 12%, transparent)',
      errorBorder: 'color-mix(in srgb, #ff6568 28%, transparent)',
      errorText: '#ffc4c5',
      info: '#60a5fa',
      working: '#86efac', waiting: '#fbbf24', blocked: '#ff6568',
      unread: '#60a5fa', offline: '#71717a', idle: '#a1a1aa',
    },
    git: {
      added: '#81b88b', modified: '#e2c08d', deleted: '#c74e39', renamed: '#73c991',
      untracked: '#71717a', branch: '#3794ff', review: '#b66dff', conflict: '#ea5c00',
    },
    agent: { claude: '#d97757', codex: '#a1a1aa', generic: '#71717a', action: '#d4d4d8' },
    proof: { verified: '#86efac', partial: '#fbbf24', missing: '#71717a', failed: '#ff6568' },
    role: {
      coordinator: '#648fff', scout: '#40b0a6', builder: '#785ef0',
      reviewer: '#ffb000', debugger: '#fe6100', integrator: '#dc267f',
    },
    risk: { low: '#86efac', medium: '#fbbf24', high: '#fe6100', critical: '#ff6568' },
    diff: {
      addedText: '#a7dcb4', removedText: '#f0b3a5',
      addedBackground: 'color-mix(in srgb, #81b88b 12%, transparent)',
      removedBackground: 'color-mix(in srgb, #c74e39 14%, transparent)',
      modified: '#e2c08d',
    },
    effects: {
      focusRing: '#71717a', scrim: 'rgb(0 0 0 / 0.6)',
      scrollbarThumb: 'color-mix(in srgb, #a1a1aa 28%, transparent)',
      scrollbarThumbHover: 'color-mix(in srgb, #a1a1aa 48%, transparent)',
      shadowLow: '0 1px 2px rgb(0 0 0 / 0.24)',
      shadowMedium: '0 8px 20px rgb(0 0 0 / 0.28), 0 2px 6px rgb(0 0 0 / 0.2)',
      shadowHigh: '0 16px 40px rgb(0 0 0 / 0.45), 0 6px 16px rgb(0 0 0 / 0.3)',
    },
  },
  terminal: {
    background: '#0c0c0e', foreground: '#d4d4d8', cursor: '#f4f4f5', cursorAccent: '#0c0c0e',
    selection: 'rgb(212 212 216 / 0.24)',
    black: '#18181b', red: '#ff6568', green: '#86efac', yellow: '#fbbf24', blue: '#60a5fa',
    magenta: '#c4b5fd', cyan: '#40b0a6', white: '#d4d4d8',
    brightBlack: '#71717a', brightRed: '#ff8b8d', brightGreen: '#a7f3c4', brightYellow: '#fcd34d',
    brightBlue: '#93c5fd', brightMagenta: '#ddd0ff', brightCyan: '#67d4ca', brightWhite: '#fafafa',
  },
  editor: {
    base: 'vs-dark', background: '#1e1e21', foreground: '#fafafa', lineHighlight: '#252528',
    selection: '#3a3a41', gutter: '#1e1e21', cursor: '#f4f4f5', lineNumber: '#71717a',
    lineNumberActive: '#d4d4d8', indentGuide: '#34343a', widgetBackground: '#252528',
    diffInserted: 'rgb(129 184 139 / 0.14)', diffRemoved: 'rgb(199 78 57 / 0.16)',
  },
}

const obsidian: ThemeDefinition = {
  id: 'obsidian',
  name: 'Obsidian',
  description: 'True-black canvas for OLED panels, tuned for maximum contrast.',
  category: 'dark',
  version: 2,
  preview: { hint: 'True black, maximum contrast' },
  colors: {
    background: {
      canvas: '#000000', surface: '#0d0d0d', surfaceRaised: '#161616', surfaceOverlay: '#1f1f1f',
      sidebar: '#0d0d0d', input: '#1a1a1a', hover: '#2a2a2a', selected: '#414141',
      pressed: '#343434', disabled: '#121212',
    },
    foreground: {
      primary: '#ffffff', strong: '#ffffff', secondary: '#dcdcdc', muted: '#adadad',
      disabled: '#7a7a7a', onAccent: '#14092b',
    },
    /* True black gives borders no ambient light to sit against, so the hairline wash runs a step
       stronger than the other dark themes to stay visible at all. */
    border: {
      default: 'rgb(255 255 255 / 0.1)', subtle: 'rgb(255 255 255 / 0.06)',
      strong: 'rgb(255 255 255 / 0.2)', accent: 'color-mix(in srgb, #b6a3ff 38%, transparent)',
    },
    accent: {
      primary: '#b6a3ff', hover: '#cfc2ff', active: '#9a80f8',
      soft: 'color-mix(in srgb, #b6a3ff 12%, transparent)',
      edge: '#b6a3ff', contrast: '#14092b',
    },
    control: {
      primary: '#f5f5f5', primaryHover: '#ffffff', primaryActive: '#dcdcdc', onPrimary: '#0d0d0d',
      secondary: '#1f1f1f', secondaryHover: '#2c2c2c', onSecondary: '#ffffff',
      card: '#0d0d0d', popover: '#161616', ring: '#8a8a8a',
    },
    status: {
      success: '#8ff5b6',
      successSoft: 'color-mix(in srgb, #8ff5b6 11%, transparent)',
      successBorder: 'color-mix(in srgb, #8ff5b6 28%, transparent)',
      warning: '#ffc73d',
      warningSoft: 'color-mix(in srgb, #ffc73d 11%, transparent)',
      warningBorder: 'color-mix(in srgb, #ffc73d 28%, transparent)',
      warningText: '#ffd970',
      error: '#ff7376',
      errorSoft: 'color-mix(in srgb, #ff7376 13%, transparent)',
      errorBorder: 'color-mix(in srgb, #ff7376 30%, transparent)',
      errorText: '#ffcfd0',
      info: '#6cb0ff',
      working: '#8ff5b6', waiting: '#ffc73d', blocked: '#ff7376',
      unread: '#6cb0ff', offline: '#7a7a7a', idle: '#adadad',
    },
    git: {
      added: '#8dc797', modified: '#eccb98', deleted: '#d85a43', renamed: '#7fd69d',
      untracked: '#7a7a7a', branch: '#4aa0ff', review: '#c17dff', conflict: '#f56a10',
    },
    agent: { claude: '#e5825f', codex: '#adadad', generic: '#7a7a7a', action: '#b6a3ff' },
    proof: { verified: '#8ff5b6', partial: '#ffc73d', missing: '#7a7a7a', failed: '#ff7376' },
    role: {
      coordinator: '#7ba1ff', scout: '#4fc0b6', builder: '#8a72ff',
      reviewer: '#ffbe1f', debugger: '#ff7420', integrator: '#ea3c92',
    },
    risk: { low: '#8ff5b6', medium: '#ffc73d', high: '#ff7420', critical: '#ff7376' },
    diff: {
      addedText: '#b4e8c2', removedText: '#f5c0b3',
      addedBackground: 'color-mix(in srgb, #8dc797 13%, transparent)',
      removedBackground: 'color-mix(in srgb, #d85a43 15%, transparent)',
      modified: '#eccb98',
    },
    effects: {
      focusRing: '#8a8a8a', scrim: 'rgb(0 0 0 / 0.72)',
      scrollbarThumb: 'color-mix(in srgb, #adadad 30%, transparent)',
      scrollbarThumbHover: 'color-mix(in srgb, #adadad 52%, transparent)',
      shadowLow: '0 1px 2px rgb(0 0 0 / 0.5)',
      shadowMedium: '0 8px 20px rgb(0 0 0 / 0.55), 0 2px 6px rgb(0 0 0 / 0.4)',
      shadowHigh: '0 16px 40px rgb(0 0 0 / 0.7), 0 6px 16px rgb(0 0 0 / 0.5)',
    },
  },
  terminal: {
    background: '#000000', foreground: '#dcdcdc', cursor: '#cfc2ff', cursorAccent: '#000000',
    selection: 'rgb(182 163 255 / 0.3)',
    black: '#0d0d0d', red: '#ff7376', green: '#8ff5b6', yellow: '#ffc73d', blue: '#6cb0ff',
    magenta: '#cfc2ff', cyan: '#4fc0b6', white: '#dcdcdc',
    brightBlack: '#7a7a7a', brightRed: '#ff9799', brightGreen: '#adfbcd', brightYellow: '#ffd970',
    brightBlue: '#9ccbff', brightMagenta: '#e3d9ff', brightCyan: '#77d8cf', brightWhite: '#ffffff',
  },
  editor: {
    base: 'vs-dark', background: '#0d0d0d', foreground: '#ffffff', lineHighlight: '#161616',
    selection: '#332b52', gutter: '#0d0d0d', cursor: '#cfc2ff', lineNumber: '#7a7a7a',
    lineNumberActive: '#dcdcdc', indentGuide: '#2c2c2c', widgetBackground: '#161616',
    diffInserted: 'rgb(141 199 151 / 0.15)', diffRemoved: 'rgb(216 90 67 / 0.17)',
  },
}

const ember: ThemeDefinition = {
  id: 'ember',
  name: 'Ember',
  description: 'Warm stone surfaces with an amber state edge.',
  category: 'dark',
  version: 2,
  preview: { hint: 'Warm stone, amber edge' },
  colors: {
    background: {
      canvas: '#0c0a09', surface: '#1c1917', surfaceRaised: '#23201d', surfaceOverlay: '#292524',
      sidebar: '#1c1917', input: '#262220', hover: '#332e2b', selected: '#4a4441',
      pressed: '#3d3835', disabled: '#1e1b19',
    },
    foreground: {
      primary: '#fafaf9', strong: '#ffffff', secondary: '#d6d3d1', muted: '#a8a29e',
      disabled: '#78716c', onAccent: '#1c1206',
    },
    border: {
      default: 'rgb(255 245 235 / 0.08)', subtle: 'rgb(255 245 235 / 0.05)',
      strong: 'rgb(255 245 235 / 0.16)', accent: 'color-mix(in srgb, #fbbf24 32%, transparent)',
    },
    accent: {
      primary: '#fbbf24', hover: '#fcd34d', active: '#f59e0b',
      soft: 'color-mix(in srgb, #fbbf24 12%, transparent)',
      edge: '#fbbf24', contrast: '#1c1206',
    },
    control: {
      primary: '#e7e5e4', primaryHover: '#f5f5f4', primaryActive: '#d6d3d1', onPrimary: '#1c1917',
      secondary: '#292524', secondaryHover: '#36302e', onSecondary: '#fafaf9',
      card: '#1c1917', popover: '#272320', ring: '#a8a29e',
    },
    status: {
      success: '#86efac',
      successSoft: 'color-mix(in srgb, #86efac 10%, transparent)',
      successBorder: 'color-mix(in srgb, #86efac 25%, transparent)',
      /* Ember's accent is amber, so warning shifts to orange — a warning must never be mistaken
         for the theme's own emphasis colour. */
      warning: '#fb923c',
      warningSoft: 'color-mix(in srgb, #fb923c 11%, transparent)',
      warningBorder: 'color-mix(in srgb, #fb923c 26%, transparent)',
      warningText: '#fdba74',
      error: '#ff6568',
      errorSoft: 'color-mix(in srgb, #ff6568 12%, transparent)',
      errorBorder: 'color-mix(in srgb, #ff6568 28%, transparent)',
      errorText: '#ffc4c5',
      info: '#7dd3c0',
      working: '#86efac', waiting: '#fb923c', blocked: '#ff6568',
      unread: '#7dd3c0', offline: '#78716c', idle: '#a8a29e',
    },
    git: {
      added: '#a3c98d', modified: '#e2c08d', deleted: '#d4614a', renamed: '#94cf9a',
      untracked: '#78716c', branch: '#7dd3c0', review: '#c79ae0', conflict: '#ea5c00',
    },
    agent: { claude: '#e08a5f', codex: '#a8a29e', generic: '#78716c', action: '#fbbf24' },
    proof: { verified: '#86efac', partial: '#fb923c', missing: '#78716c', failed: '#ff6568' },
    role: {
      coordinator: '#7fa8e8', scout: '#4fb8a8', builder: '#9d84ee',
      reviewer: '#e9b83f', debugger: '#fe6100', integrator: '#dc5f96',
    },
    risk: { low: '#86efac', medium: '#fb923c', high: '#fe6100', critical: '#ff6568' },
    diff: {
      addedText: '#c6e2b6', removedText: '#f3bcae',
      addedBackground: 'color-mix(in srgb, #a3c98d 12%, transparent)',
      removedBackground: 'color-mix(in srgb, #d4614a 14%, transparent)',
      modified: '#e2c08d',
    },
    effects: {
      focusRing: '#a8a29e', scrim: 'rgb(12 8 4 / 0.62)',
      scrollbarThumb: 'color-mix(in srgb, #a8a29e 28%, transparent)',
      scrollbarThumbHover: 'color-mix(in srgb, #a8a29e 48%, transparent)',
      shadowLow: '0 1px 2px rgb(10 6 2 / 0.3)',
      shadowMedium: '0 8px 20px rgb(10 6 2 / 0.32), 0 2px 6px rgb(10 6 2 / 0.24)',
      shadowHigh: '0 16px 40px rgb(10 6 2 / 0.5), 0 6px 16px rgb(10 6 2 / 0.34)',
    },
  },
  terminal: {
    background: '#0c0a09', foreground: '#d6d3d1', cursor: '#fcd34d', cursorAccent: '#0c0a09',
    selection: 'rgb(251 191 36 / 0.24)',
    black: '#1c1917', red: '#ff6568', green: '#a3c98d', yellow: '#fbbf24', blue: '#7fa8e8',
    magenta: '#c79ae0', cyan: '#7dd3c0', white: '#d6d3d1',
    brightBlack: '#78716c', brightRed: '#ff8b8d', brightGreen: '#bedcab', brightYellow: '#fcd34d',
    brightBlue: '#a3c4f0', brightMagenta: '#dbb8ec', brightCyan: '#9ee2d3', brightWhite: '#fafaf9',
  },
  editor: {
    base: 'vs-dark', background: '#1c1917', foreground: '#fafaf9', lineHighlight: '#23201d',
    selection: '#3f3524', gutter: '#1c1917', cursor: '#fcd34d', lineNumber: '#78716c',
    lineNumberActive: '#d6d3d1', indentGuide: '#36302e', widgetBackground: '#23201d',
    diffInserted: 'rgb(163 201 141 / 0.14)', diffRemoved: 'rgb(212 97 74 / 0.16)',
  },
}

const arcticLight: ThemeDefinition = {
  id: 'arctic-light',
  name: 'Arctic Light',
  description: 'Paper-white surfaces with a near-black primary and iris state edge.',
  category: 'light',
  version: 2,
  preview: { hint: 'Paper white, near-black primary' },
  colors: {
    background: {
      canvas: '#f7f7f7', surface: '#ffffff', surfaceRaised: '#fafafa', surfaceOverlay: '#f2f2f2',
      sidebar: '#fafafa', input: '#ffffff', hover: '#e9e9e9', selected: '#d4d4d4',
      pressed: '#dfdfdf', disabled: '#f2f2f2',
    },
    foreground: {
      primary: '#0a0a0a', strong: '#000000', secondary: '#525252', muted: '#737373',
      disabled: '#a1a1a1', onAccent: '#ffffff',
    },
    /* On light surfaces an alpha-white wash is invisible, so the hairline inverts to an alpha
       *black* wash — same rule, opposite direction. */
    border: {
      default: 'rgb(0 0 0 / 0.1)', subtle: 'rgb(0 0 0 / 0.06)',
      strong: 'rgb(0 0 0 / 0.18)', accent: 'color-mix(in srgb, #8b5cf6 35%, transparent)',
    },
    accent: {
      primary: '#8b5cf6', hover: '#7c3aed', active: '#6d28d9',
      soft: 'color-mix(in srgb, #8b5cf6 10%, transparent)',
      edge: '#8b5cf6', contrast: '#ffffff',
    },
    control: {
      primary: '#171717', primaryHover: '#000000', primaryActive: '#333333', onPrimary: '#fafafa',
      secondary: '#f2f2f2', secondaryHover: '#e9e9e9', onSecondary: '#171717',
      card: '#ffffff', popover: '#ffffff', ring: '#a1a1a1',
    },
    status: {
      success: '#15803d',
      successSoft: 'color-mix(in srgb, #15803d 10%, transparent)',
      successBorder: 'color-mix(in srgb, #15803d 25%, transparent)',
      warning: '#b45309',
      warningSoft: 'color-mix(in srgb, #b45309 10%, transparent)',
      warningBorder: 'color-mix(in srgb, #b45309 25%, transparent)',
      warningText: '#92400e',
      error: '#e40014',
      errorSoft: 'color-mix(in srgb, #e40014 8%, transparent)',
      errorBorder: 'color-mix(in srgb, #e40014 22%, transparent)',
      errorText: '#b1000f',
      info: '#1d4ed8',
      working: '#15803d', waiting: '#b45309', blocked: '#e40014',
      unread: '#1d4ed8', offline: '#8c8c8c', idle: '#737373',
    },
    git: {
      added: '#587c0c', modified: '#895503', deleted: '#ad0707', renamed: '#007acc',
      untracked: '#007100', branch: '#007acc', review: '#b66dff', conflict: '#ea5c00',
    },
    agent: { claude: '#b8552c', codex: '#525252', generic: '#737373', action: '#8b5cf6' },
    proof: { verified: '#15803d', partial: '#b45309', missing: '#8c8c8c', failed: '#e40014' },
    /* The IBM colourblind-safe set, darkened where the light variant would drop below 4.5:1
       against white. */
    role: {
      coordinator: '#3a5fd0', scout: '#2c7d76', builder: '#5b40c9',
      reviewer: '#8a5f00', debugger: '#c24a00', integrator: '#b31e66',
    },
    risk: { low: '#15803d', medium: '#b45309', high: '#c24a00', critical: '#b1000f' },
    diff: {
      addedText: '#3f6100', removedText: '#a32013',
      addedBackground: 'color-mix(in srgb, #587c0c 12%, transparent)',
      removedBackground: 'color-mix(in srgb, #ad0707 10%, transparent)',
      modified: '#895503',
    },
    effects: {
      focusRing: '#a1a1a1', scrim: 'rgb(10 10 10 / 0.4)',
      scrollbarThumb: 'color-mix(in srgb, #737373 30%, transparent)',
      scrollbarThumbHover: 'color-mix(in srgb, #737373 50%, transparent)',
      shadowLow: '0 1px 2px rgb(10 10 10 / 0.06)',
      shadowMedium: '0 8px 20px rgb(10 10 10 / 0.1), 0 2px 6px rgb(10 10 10 / 0.06)',
      shadowHigh: '0 16px 40px rgb(10 10 10 / 0.16), 0 6px 16px rgb(10 10 10 / 0.1)',
    },
  },
  terminal: {
    background: '#ffffff', foreground: '#171717', cursor: '#8b5cf6', cursorAccent: '#ffffff',
    selection: 'rgb(139 92 246 / 0.18)',
    black: '#171717', red: '#ad0707', green: '#15803d', yellow: '#895503', blue: '#1d4ed8',
    magenta: '#7c3aed', cyan: '#0e7490', white: '#525252',
    brightBlack: '#8c8c8c', brightRed: '#e40014', brightGreen: '#16a34a', brightYellow: '#b45309',
    brightBlue: '#2563eb', brightMagenta: '#9333ea', brightCyan: '#0891b2', brightWhite: '#0a0a0a',
  },
  editor: {
    base: 'vs', background: '#ffffff', foreground: '#171717', lineHighlight: '#f5f5f5',
    selection: '#ddd3fb', gutter: '#ffffff', cursor: '#8b5cf6', lineNumber: '#a1a1a1',
    lineNumberActive: '#525252', indentGuide: '#e5e5e5', widgetBackground: '#fafafa',
    diffInserted: 'rgb(88 124 12 / 0.14)', diffRemoved: 'rgb(173 7 7 / 0.12)',
  },
}

/** All concrete themes, keyed by id. `system` is resolved to one of these at runtime. */
export const CONCRETE_THEMES: Record<string, ThemeDefinition> = {
  'paralith-dark': paralithDark,
  graphite,
  obsidian,
  ember,
  'arctic-light': arcticLight,
}

/** Ordered concrete themes for stable listing. */
export const CONCRETE_THEME_ORDER: ThemeDefinition[] = [
  paralithDark, graphite, obsidian, ember, arcticLight,
]
