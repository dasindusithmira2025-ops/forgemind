import type { ThemeDefinition } from './tokens'

/**
 * The concrete PARALITH themes.
 *
 * All five share one *genome* — the structural rules that make the app read as a single product
 * regardless of which palette is active:
 *
 * 1. **Near-achromatic surfaces.** Canvas → card → raised → overlay is a quiet luminance ladder.
 *    A theme may carry a faint temperature (paralith-dark runs blue, ember warm), but the chrome
 *    is never tinted far enough toward the accent to read as a coloured panel.
 * 2. **Alpha hairline borders.** Dividers are a translucent wash of the foreground, not an opaque
 *    grey. They therefore stay correct on every surface in the ladder instead of reading heavy on
 *    the canvas and invisible on a popover. The ladder has five steps (design.md §4.1) because
 *    structure in Paralith is carried by borders rather than by elevation.
 * 3. **The primary control takes the accent fill** (design.md §7.1). There is exactly one such
 *    control per region, so the accent stays a ~2% ink budget rather than a background colour.
 *    Everything below primary — secondary fills, popovers, cards — stays neutral.
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
  description: 'Cool blue-black surfaces, hairline structure, restrained blue accent.',
  category: 'dark',
  version: 3,
  preview: { hint: 'Blue-black canvas, blue accent' },
  colors: {
    background: {
      canvas: '#0b0f15', surface: '#0e1217', surfaceRaised: '#13181e', surfaceOverlay: '#181d24',
      sidebar: '#0e1217', input: '#0e1217', hover: '#262d37', selected: '#3c4653',
      pressed: '#303945', disabled: '#12161b',
    },
    foreground: {
      primary: '#e8ebef', strong: '#f6f8fa', secondary: '#a0a7b0', muted: '#69717c',
      disabled: '#4c535d', onAccent: '#0a1220',
    },
    border: {
      faint: 'rgb(255 255 255 / 0.045)', subtle: 'rgb(255 255 255 / 0.065)',
      default: 'rgb(255 255 255 / 0.085)', hover: 'rgb(255 255 255 / 0.12)',
      strong: 'rgb(255 255 255 / 0.16)', accent: 'rgb(79 134 234 / 0.28)',
    },
    accent: {
      primary: '#4f86ea', hover: '#5b91f4', active: '#4478d5',
      soft: 'rgb(79 134 234 / 0.12)',
      edge: '#4f86ea', contrast: '#0a1220',
    },
    control: {
      primary: '#4f86ea', primaryHover: '#5b91f4', primaryActive: '#4478d5', onPrimary: '#0a1220',
      secondary: '#181d24', secondaryHover: '#1d232b', onSecondary: '#e8ebef',
      card: '#0e1217', popover: '#181d24', ring: '#787d83',
    },
    status: {
      success: '#4fac82',
      successSoft: 'rgb(79 172 130 / 0.10)',
      successBorder: 'rgb(79 172 130 / 0.26)',
      warning: '#d3a84f',
      warningSoft: 'rgb(211 168 79 / 0.10)',
      warningBorder: 'rgb(211 168 79 / 0.26)',
      warningText: '#e0bd76',
      error: '#d35f6f',
      errorSoft: 'rgb(211 95 111 / 0.11)',
      errorBorder: 'rgb(211 95 111 / 0.28)',
      errorText: '#e9a4ae',
      info: '#4f86ea',
      ready: '#4ca9a5',
      working: '#8a72d8', waiting: '#d3a84f', blocked: '#d35f6f',
      unread: '#4f86ea', offline: '#707986', idle: '#8b939f',
    },
    git: {
      added: '#4fac82', modified: '#d3a84f', deleted: '#d35f6f', renamed: '#4ca9a5',
      untracked: '#707986', branch: '#4f86ea', review: '#8a72d8', conflict: '#d3813f',
    },
    agent: { claude: '#d97757', codex: '#a0a7b0', generic: '#69717c', action: '#8a72d8' },
    proof: { verified: '#4fac82', partial: '#d3a84f', missing: '#707986', failed: '#d35f6f' },
    role: {
      coordinator: '#648fff', scout: '#40b0a6', builder: '#785ef0',
      reviewer: '#ffb000', debugger: '#fe6100', integrator: '#dc267f',
    },
    risk: { low: '#4fac82', medium: '#d3a84f', high: '#d3813f', critical: '#d35f6f' },
    diff: {
      addedText: '#8fc9a3', removedText: '#e0a3ac',
      addedBackground: 'rgb(79 172 130 / 0.12)',
      removedBackground: 'rgb(211 95 111 / 0.14)',
      modified: '#d3a84f',
    },
    effects: {
      focusRing: '#787d83', scrim: 'rgb(4 7 11 / 0.62)',
      scrollbarThumb: 'rgb(160 167 176 / 0.26)',
      scrollbarThumbHover: 'rgb(160 167 176 / 0.44)',
      shadowLow: '0 1px 2px rgb(0 0 0 / 0.3)',
      shadowMedium: '0 8px 20px rgb(0 0 0 / 0.34), 0 2px 6px rgb(0 0 0 / 0.24)',
      shadowHigh: '0 16px 40px rgb(0 0 0 / 0.5), 0 6px 16px rgb(0 0 0 / 0.32)',
    },
  },
  terminal: {
    background: '#0b0f15', foreground: '#c3cad3', cursor: '#4f86ea', cursorAccent: '#0b0f15',
    selection: 'rgb(79 134 234 / 0.26)',
    black: '#181d24', red: '#d35f6f', green: '#4fac82', yellow: '#d3a84f', blue: '#4f86ea',
    magenta: '#8a72d8', cyan: '#4ca9a5', white: '#c3cad3',
    brightBlack: '#69717c', brightRed: '#e18190', brightGreen: '#74c39f', brightYellow: '#e0bd76',
    brightBlue: '#79a4f0', brightMagenta: '#a793e4', brightCyan: '#6fc2be', brightWhite: '#e8ebef',
  },
  editor: {
    base: 'vs-dark', background: '#0e1217', foreground: '#e8ebef', lineHighlight: '#13181e',
    selection: '#23364f', gutter: '#0e1217', cursor: '#4f86ea', lineNumber: '#4c535d',
    lineNumberActive: '#a0a7b0', indentGuide: '#1d232b', widgetBackground: '#13181e',
    diffInserted: 'rgb(79 172 130 / 0.14)', diffRemoved: 'rgb(211 95 111 / 0.16)',
  },
}

const graphite: ThemeDefinition = {
  id: 'graphite',
  name: 'Graphite',
  description: 'Cool zinc surfaces with a silver state edge and no brand chroma.',
  category: 'dark',
  version: 3,
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
      faint: 'rgb(255 255 255 / 0.045)', subtle: 'rgb(255 255 255 / 0.065)',
      default: 'rgb(255 255 255 / 0.085)', hover: 'rgb(255 255 255 / 0.12)',
      strong: 'rgb(255 255 255 / 0.16)', accent: 'color-mix(in srgb, #d4d4d8 30%, transparent)',
    },
    /* Graphite's identity is the *absence* of chroma: the state edge is a bright silver, so the
       only colour on screen is status, Git and role signal. It is the one theme where design.md's
       "primary control takes the accent fill" rule produces a neutral button, by construction. */
    accent: {
      primary: '#d4d4d8', hover: '#f4f4f5', active: '#a1a1aa',
      soft: 'color-mix(in srgb, #d4d4d8 10%, transparent)',
      edge: '#d4d4d8', contrast: '#18181b',
    },
    control: {
      primary: '#d4d4d8', primaryHover: '#f4f4f5', primaryActive: '#a1a1aa', onPrimary: '#18181b',
      secondary: '#27272a', secondaryHover: '#34343a', onSecondary: '#fafafa',
      card: '#18181b', popover: '#27272a', ring: '#71717a',
    },
    status: {
      success: '#4fac82',
      successSoft: 'rgb(79 172 130 / 0.10)',
      successBorder: 'rgb(79 172 130 / 0.26)',
      warning: '#d3a84f',
      warningSoft: 'rgb(211 168 79 / 0.10)',
      warningBorder: 'rgb(211 168 79 / 0.26)',
      warningText: '#e0bd76',
      error: '#d35f6f',
      errorSoft: 'rgb(211 95 111 / 0.11)',
      errorBorder: 'rgb(211 95 111 / 0.28)',
      errorText: '#e9a4ae',
      info: '#4f86ea',
      ready: '#4ca9a5',
      working: '#8a72d8', waiting: '#d3a84f', blocked: '#d35f6f',
      unread: '#4f86ea', offline: '#71717a', idle: '#a1a1aa',
    },
    git: {
      added: '#4fac82', modified: '#d3a84f', deleted: '#d35f6f', renamed: '#4ca9a5',
      untracked: '#71717a', branch: '#4f86ea', review: '#8a72d8', conflict: '#d3813f',
    },
    agent: { claude: '#d97757', codex: '#a1a1aa', generic: '#71717a', action: '#8a72d8' },
    proof: { verified: '#4fac82', partial: '#d3a84f', missing: '#71717a', failed: '#d35f6f' },
    role: {
      coordinator: '#648fff', scout: '#40b0a6', builder: '#785ef0',
      reviewer: '#ffb000', debugger: '#fe6100', integrator: '#dc267f',
    },
    risk: { low: '#4fac82', medium: '#d3a84f', high: '#d3813f', critical: '#d35f6f' },
    diff: {
      addedText: '#8fc9a3', removedText: '#e0a3ac',
      addedBackground: 'rgb(79 172 130 / 0.12)',
      removedBackground: 'rgb(211 95 111 / 0.14)',
      modified: '#d3a84f',
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
    black: '#18181b', red: '#d35f6f', green: '#4fac82', yellow: '#d3a84f', blue: '#4f86ea',
    magenta: '#8a72d8', cyan: '#4ca9a5', white: '#d4d4d8',
    brightBlack: '#71717a', brightRed: '#e18190', brightGreen: '#74c39f', brightYellow: '#e0bd76',
    brightBlue: '#79a4f0', brightMagenta: '#a793e4', brightCyan: '#6fc2be', brightWhite: '#fafafa',
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
  version: 3,
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
      faint: 'rgb(255 255 255 / 0.06)', subtle: 'rgb(255 255 255 / 0.085)',
      default: 'rgb(255 255 255 / 0.1)', hover: 'rgb(255 255 255 / 0.15)',
      strong: 'rgb(255 255 255 / 0.2)', accent: 'color-mix(in srgb, #b6a3ff 38%, transparent)',
    },
    accent: {
      primary: '#b6a3ff', hover: '#cfc2ff', active: '#9a80f8',
      soft: 'color-mix(in srgb, #b6a3ff 12%, transparent)',
      edge: '#b6a3ff', contrast: '#14092b',
    },
    control: {
      primary: '#b6a3ff', primaryHover: '#cfc2ff', primaryActive: '#9a80f8', onPrimary: '#14092b',
      secondary: '#1f1f1f', secondaryHover: '#2c2c2c', onSecondary: '#ffffff',
      card: '#0d0d0d', popover: '#1f1f1f', ring: '#8a8a8a',
    },
    status: {
      success: '#5cbe90',
      successSoft: 'rgb(92 190 144 / 0.12)',
      successBorder: 'rgb(92 190 144 / 0.30)',
      warning: '#e2b65b',
      warningSoft: 'rgb(226 182 91 / 0.12)',
      warningBorder: 'rgb(226 182 91 / 0.30)',
      warningText: '#ecc87f',
      error: '#e06b7c',
      errorSoft: 'rgb(224 107 124 / 0.13)',
      errorBorder: 'rgb(224 107 124 / 0.32)',
      errorText: '#f2b0b9',
      info: '#5b91f4',
      ready: '#57b8b4',
      working: '#9a80f8', waiting: '#e2b65b', blocked: '#e06b7c',
      unread: '#5b91f4', offline: '#7a7a7a', idle: '#adadad',
    },
    git: {
      added: '#5cbe90', modified: '#e2b65b', deleted: '#e06b7c', renamed: '#57b8b4',
      untracked: '#7a7a7a', branch: '#5b91f4', review: '#9a80f8', conflict: '#e08e4a',
    },
    agent: { claude: '#e5825f', codex: '#adadad', generic: '#7a7a7a', action: '#9a80f8' },
    proof: { verified: '#5cbe90', partial: '#e2b65b', missing: '#7a7a7a', failed: '#e06b7c' },
    role: {
      coordinator: '#7ba1ff', scout: '#4fc0b6', builder: '#8a72ff',
      reviewer: '#ffbe1f', debugger: '#ff7420', integrator: '#ea3c92',
    },
    risk: { low: '#5cbe90', medium: '#e2b65b', high: '#e08e4a', critical: '#e06b7c' },
    diff: {
      addedText: '#9ad3b2', removedText: '#eeb0b9',
      addedBackground: 'rgb(92 190 144 / 0.13)',
      removedBackground: 'rgb(224 107 124 / 0.15)',
      modified: '#e2b65b',
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
    black: '#0d0d0d', red: '#e06b7c', green: '#5cbe90', yellow: '#e2b65b', blue: '#5b91f4',
    magenta: '#b6a3ff', cyan: '#57b8b4', white: '#dcdcdc',
    brightBlack: '#7a7a7a', brightRed: '#ee8f9d', brightGreen: '#7fd2aa', brightYellow: '#ecc87f',
    brightBlue: '#85adf7', brightMagenta: '#cfc2ff', brightCyan: '#79ccc8', brightWhite: '#ffffff',
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
  version: 3,
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
      faint: 'rgb(255 245 235 / 0.05)', subtle: 'rgb(255 245 235 / 0.07)',
      default: 'rgb(255 245 235 / 0.09)', hover: 'rgb(255 245 235 / 0.13)',
      strong: 'rgb(255 245 235 / 0.17)', accent: 'rgb(217 164 65 / 0.30)',
    },
    accent: {
      primary: '#d9a441', hover: '#e7b658', active: '#c08f30',
      soft: 'rgb(217 164 65 / 0.12)',
      edge: '#d9a441', contrast: '#1c1206',
    },
    control: {
      primary: '#d9a441', primaryHover: '#e7b658', primaryActive: '#c08f30', onPrimary: '#1c1206',
      secondary: '#292524', secondaryHover: '#36302e', onSecondary: '#fafaf9',
      card: '#1c1917', popover: '#292524', ring: '#a8a29e',
    },
    status: {
      success: '#4fac82',
      successSoft: 'rgb(79 172 130 / 0.10)',
      successBorder: 'rgb(79 172 130 / 0.26)',
      /* Ember's accent is amber, so warning shifts to orange — a warning must never be mistaken
         for the theme's own emphasis colour. */
      warning: '#d3813f',
      warningSoft: 'rgb(211 129 63 / 0.11)',
      warningBorder: 'rgb(211 129 63 / 0.28)',
      warningText: '#e0a06b',
      error: '#d35f6f',
      errorSoft: 'rgb(211 95 111 / 0.12)',
      errorBorder: 'rgb(211 95 111 / 0.28)',
      errorText: '#e9a4ae',
      info: '#4ca9a5',
      ready: '#4ca9a5',
      working: '#8a72d8', waiting: '#d3813f', blocked: '#d35f6f',
      unread: '#4ca9a5', offline: '#78716c', idle: '#a8a29e',
    },
    git: {
      added: '#4fac82', modified: '#d9a441', deleted: '#d35f6f', renamed: '#4ca9a5',
      untracked: '#78716c', branch: '#4ca9a5', review: '#8a72d8', conflict: '#d3813f',
    },
    agent: { claude: '#e08a5f', codex: '#a8a29e', generic: '#78716c', action: '#8a72d8' },
    proof: { verified: '#4fac82', partial: '#d3813f', missing: '#78716c', failed: '#d35f6f' },
    role: {
      coordinator: '#7fa8e8', scout: '#4fb8a8', builder: '#9d84ee',
      reviewer: '#e9b83f', debugger: '#fe6100', integrator: '#dc5f96',
    },
    risk: { low: '#4fac82', medium: '#d9a441', high: '#d3813f', critical: '#d35f6f' },
    diff: {
      addedText: '#8fc9a3', removedText: '#e0a3ac',
      addedBackground: 'rgb(79 172 130 / 0.12)',
      removedBackground: 'rgb(211 95 111 / 0.14)',
      modified: '#d9a441',
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
    background: '#0c0a09', foreground: '#d6d3d1', cursor: '#e7b658', cursorAccent: '#0c0a09',
    selection: 'rgb(217 164 65 / 0.24)',
    black: '#1c1917', red: '#d35f6f', green: '#4fac82', yellow: '#d9a441', blue: '#4ca9a5',
    magenta: '#8a72d8', cyan: '#4ca9a5', white: '#d6d3d1',
    brightBlack: '#78716c', brightRed: '#e18190', brightGreen: '#74c39f', brightYellow: '#e7b658',
    brightBlue: '#6fc2be', brightMagenta: '#a793e4', brightCyan: '#8ed2cf', brightWhite: '#fafaf9',
  },
  editor: {
    base: 'vs-dark', background: '#1c1917', foreground: '#fafaf9', lineHighlight: '#23201d',
    selection: '#3f3524', gutter: '#1c1917', cursor: '#e7b658', lineNumber: '#78716c',
    lineNumberActive: '#d6d3d1', indentGuide: '#36302e', widgetBackground: '#23201d',
    diffInserted: 'rgb(79 172 130 / 0.14)', diffRemoved: 'rgb(211 95 111 / 0.16)',
  },
}

const arcticLight: ThemeDefinition = {
  id: 'arctic-light',
  name: 'Arctic Light',
  description: 'Paper-white surfaces with a deep blue accent and near-black text.',
  category: 'light',
  version: 3,
  preview: { hint: 'Paper white, blue accent' },
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
      faint: 'rgb(0 0 0 / 0.06)', subtle: 'rgb(0 0 0 / 0.085)',
      default: 'rgb(0 0 0 / 0.11)', hover: 'rgb(0 0 0 / 0.16)',
      strong: 'rgb(0 0 0 / 0.2)', accent: 'rgb(45 100 200 / 0.35)',
    },
    accent: {
      primary: '#2d64c8', hover: '#255ab8', active: '#1e4b9c',
      soft: 'rgb(45 100 200 / 0.10)',
      edge: '#2d64c8', contrast: '#ffffff',
    },
    control: {
      primary: '#2d64c8', primaryHover: '#255ab8', primaryActive: '#1e4b9c', onPrimary: '#ffffff',
      secondary: '#f2f2f2', secondaryHover: '#e9e9e9', onSecondary: '#171717',
      card: '#ffffff', popover: '#ffffff', ring: '#a1a1a1',
    },
    status: {
      success: '#1c7a51',
      successSoft: 'rgb(28 122 81 / 0.10)',
      successBorder: 'rgb(28 122 81 / 0.26)',
      warning: '#8a6410',
      warningSoft: 'rgb(138 100 16 / 0.10)',
      warningBorder: 'rgb(138 100 16 / 0.26)',
      warningText: '#6e4f0c',
      error: '#b3243a',
      errorSoft: 'rgb(179 36 58 / 0.09)',
      errorBorder: 'rgb(179 36 58 / 0.24)',
      errorText: '#8e1c2e',
      info: '#2d64c8',
      ready: '#12726e',
      working: '#5b3fbe', waiting: '#8a6410', blocked: '#b3243a',
      unread: '#2d64c8', offline: '#8c8c8c', idle: '#737373',
    },
    git: {
      added: '#1c7a51', modified: '#8a6410', deleted: '#b3243a', renamed: '#12726e',
      untracked: '#737373', branch: '#2d64c8', review: '#5b3fbe', conflict: '#a8500c',
    },
    agent: { claude: '#b8552c', codex: '#525252', generic: '#737373', action: '#5b3fbe' },
    proof: { verified: '#1c7a51', partial: '#8a6410', missing: '#8c8c8c', failed: '#b3243a' },
    /* The IBM colourblind-safe set, darkened where the light variant would drop below 4.5:1
       against white. */
    role: {
      coordinator: '#3a5fd0', scout: '#2c7d76', builder: '#5b40c9',
      reviewer: '#8a5f00', debugger: '#c24a00', integrator: '#b31e66',
    },
    risk: { low: '#1c7a51', medium: '#8a6410', high: '#a8500c', critical: '#8e1c2e' },
    diff: {
      addedText: '#15603f', removedText: '#8e1c2e',
      addedBackground: 'rgb(28 122 81 / 0.12)',
      removedBackground: 'rgb(179 36 58 / 0.10)',
      modified: '#8a6410',
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
    background: '#ffffff', foreground: '#171717', cursor: '#2d64c8', cursorAccent: '#ffffff',
    selection: 'rgb(45 100 200 / 0.18)',
    black: '#171717', red: '#b3243a', green: '#1c7a51', yellow: '#8a6410', blue: '#2d64c8',
    magenta: '#5b3fbe', cyan: '#12726e', white: '#525252',
    brightBlack: '#8c8c8c', brightRed: '#d1394f', brightGreen: '#249166', brightYellow: '#a37a1c',
    brightBlue: '#3f79dc', brightMagenta: '#6f52d4', brightCyan: '#188a85', brightWhite: '#0a0a0a',
  },
  editor: {
    base: 'vs', background: '#ffffff', foreground: '#171717', lineHighlight: '#f5f5f5',
    selection: '#cfdff7', gutter: '#ffffff', cursor: '#2d64c8', lineNumber: '#a1a1a1',
    lineNumberActive: '#525252', indentGuide: '#e5e5e5', widgetBackground: '#fafafa',
    diffInserted: 'rgb(28 122 81 / 0.14)', diffRemoved: 'rgb(179 36 58 / 0.12)',
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
