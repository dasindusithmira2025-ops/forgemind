import type { ThemeDefinition } from './tokens'

/**
 * The concrete PARALITH themes. Every value here is original to PARALITH and tuned for a restrained,
 * professional developer-tool aesthetic (no neon, glow, or glass). `paralith-dark` intentionally
 * mirrors the historical `index.css :root` values so the built-in default renders identically even
 * if the theme engine never runs.
 *
 * `system` is not defined here — it is resolved to `paralith-dark` or `arctic-light` at runtime (see
 * registry.ts) so previews and application always derive from a real concrete theme.
 */

const paralithDark: ThemeDefinition = {
  id: 'paralith-dark',
  name: 'Paralith Dark',
  description: 'Neutral charcoal surfaces with a restrained iris accent.',
  category: 'dark',
  version: 1,
  preview: { hint: 'Charcoal surfaces, iris accent' },
  colors: {
    background: {
      canvas: '#0b0c10', surface: '#12141b', surfaceRaised: '#171a23', surfaceOverlay: '#1e222d',
      sidebar: '#12141b', input: '#12141b', hover: '#232837', selected: '#20232f',
    },
    foreground: {
      primary: '#e8eaf1', strong: '#ffffff', secondary: '#a3abbd', muted: '#778094',
      disabled: '#566079', onAccent: '#120e2b',
    },
    border: { default: '#262b37', subtle: '#1d2130', strong: '#39404f', accent: '#38315e' },
    accent: {
      primary: '#8b7cf6', hover: '#a89bfa', active: '#7668e0', soft: '#221f3f',
      edge: '#8b7cf6', contrast: '#120e2b',
    },
    status: {
      success: '#66c98e', successSoft: '#12271c', successBorder: '#2b5a41',
      warning: '#ddb666', warningSoft: '#241d10', warningBorder: '#5a4a2b', warningText: '#f1d48a',
      error: '#e58089', errorSoft: '#2a171b', errorBorder: '#5f2d34', errorText: '#ffd0d0',
      info: '#6fa8e6',
    },
    diff: {
      addedText: '#b6e8c9', removedText: '#f0bcbc',
      addedBackground: 'rgba(102, 201, 142, .09)', removedBackground: 'rgba(229, 128, 137, .09)',
      modified: '#ddb666',
    },
    effects: {
      focusRing: '#8b7cf6', scrim: 'rgba(0, 0, 0, .55)',
      scrollbarThumb: '#2c3242', scrollbarThumbHover: '#3b4356',
      shadowLow: '0 1px 2px rgba(0, 0, 0, .35), 0 2px 6px rgba(0, 0, 0, .22)',
      shadowMedium: '0 6px 18px rgba(0, 0, 0, .38), 0 2px 6px rgba(0, 0, 0, .28)',
      shadowHigh: '0 20px 50px rgba(0, 0, 0, .55), 0 8px 24px rgba(0, 0, 0, .4)',
    },
  },
  terminal: {
    background: '#0a0c10', foreground: '#d8dde7', cursor: '#a89bfa', cursorAccent: '#0a0c10',
    selection: 'rgba(139, 124, 246, .30)',
    black: '#161a22', red: '#ef7d7d', green: '#82c99a', yellow: '#d9bf76', blue: '#72a7ff',
    magenta: '#b99af7', cyan: '#70c4c9', white: '#d8dde7',
    brightBlack: '#6f7889', brightRed: '#ff9a9a', brightGreen: '#9adcb2', brightYellow: '#ecd48f',
    brightBlue: '#93bdff', brightMagenta: '#ccb2ff', brightCyan: '#8ad9de', brightWhite: '#f2f5fa',
  },
  editor: {
    base: 'vs-dark', background: '#0a0c10', foreground: '#e8eaf1', lineHighlight: '#12141b',
    selection: '#2c2a4a', gutter: '#0a0c10', cursor: '#a89bfa', lineNumber: '#778094',
    lineNumberActive: '#a3abbd', indentGuide: '#262b37', widgetBackground: '#171a23',
    diffInserted: 'rgba(102, 201, 142, .12)', diffRemoved: 'rgba(229, 128, 137, .12)',
  },
}

const graphite: ThemeDefinition = {
  id: 'graphite',
  name: 'Graphite',
  description: 'Monochrome slate with minimal colour distraction.',
  category: 'dark',
  version: 1,
  preview: { hint: 'Monochrome slate, neutral accent' },
  colors: {
    background: {
      canvas: '#101114', surface: '#191b1f', surfaceRaised: '#20232a', surfaceOverlay: '#282b32',
      sidebar: '#17181c', input: '#191b1f', hover: '#24272f', selected: '#22252d',
    },
    foreground: {
      primary: '#e5e7ec', strong: '#ffffff', secondary: '#a4a9b3', muted: '#767c87',
      disabled: '#565b66', onAccent: '#14161a',
    },
    border: { default: '#2b2e35', subtle: '#202329', strong: '#3e424b', accent: '#3a3f49' },
    accent: {
      primary: '#8b95a6', hover: '#a6afbd', active: '#757e8e', soft: '#23262d',
      edge: '#8b95a6', contrast: '#14161a',
    },
    status: {
      success: '#6fbf95', successSoft: '#14261d', successBorder: '#2c5241',
      warning: '#cdb072', warningSoft: '#23200f', warningBorder: '#514626', warningText: '#e6d29a',
      error: '#d98b90', errorSoft: '#271a1c', errorBorder: '#55353a', errorText: '#f2d2d4',
      info: '#86a7c9',
    },
    diff: {
      addedText: '#b9dcc5', removedText: '#e6bcbf',
      addedBackground: 'rgba(111, 191, 149, .09)', removedBackground: 'rgba(217, 139, 144, .09)',
      modified: '#cdb072',
    },
    effects: {
      focusRing: '#a6afbd', scrim: 'rgba(0, 0, 0, .55)',
      scrollbarThumb: '#313640', scrollbarThumbHover: '#414753',
      shadowLow: '0 1px 2px rgba(0, 0, 0, .35), 0 2px 6px rgba(0, 0, 0, .22)',
      shadowMedium: '0 6px 18px rgba(0, 0, 0, .38), 0 2px 6px rgba(0, 0, 0, .28)',
      shadowHigh: '0 20px 50px rgba(0, 0, 0, .55), 0 8px 24px rgba(0, 0, 0, .4)',
    },
  },
  terminal: {
    background: '#101114', foreground: '#d5d8de', cursor: '#a6afbd', cursorAccent: '#101114',
    selection: 'rgba(139, 149, 166, .30)',
    black: '#1b1e24', red: '#d98b90', green: '#8dc7a2', yellow: '#cdb072', blue: '#8fb0d4',
    magenta: '#b0a6c4', cyan: '#86bcc0', white: '#d5d8de',
    brightBlack: '#727884', brightRed: '#e6a3a7', brightGreen: '#a6d6ba', brightYellow: '#dcc691',
    brightBlue: '#a8c4e0', brightMagenta: '#c4bcd6', brightCyan: '#a0cccf', brightWhite: '#eef0f4',
  },
  editor: {
    base: 'vs-dark', background: '#101114', foreground: '#e5e7ec', lineHighlight: '#191b1f',
    selection: '#2f3540', gutter: '#101114', cursor: '#a6afbd', lineNumber: '#767c87',
    lineNumberActive: '#a4a9b3', indentGuide: '#2b2e35', widgetBackground: '#20232a',
    diffInserted: 'rgba(111, 191, 149, .12)', diffRemoved: 'rgba(217, 139, 144, .12)',
  },
}

const obsidian: ThemeDefinition = {
  id: 'obsidian',
  name: 'Obsidian',
  description: 'Near-black surfaces tuned for high contrast.',
  category: 'dark',
  version: 1,
  preview: { hint: 'Near-black, high contrast' },
  colors: {
    background: {
      canvas: '#050506', surface: '#0d0e11', surfaceRaised: '#141519', surfaceOverlay: '#1c1d22',
      sidebar: '#08090b', input: '#0d0e11', hover: '#1e2027', selected: '#1c1e28',
    },
    foreground: {
      primary: '#f3f4f7', strong: '#ffffff', secondary: '#b4b9c3', muted: '#838995',
      disabled: '#5c626d', onAccent: '#090713',
    },
    border: { default: '#23252c', subtle: '#16171c', strong: '#3b3e47', accent: '#35304f' },
    accent: {
      primary: '#9a8cff', hover: '#b6acff', active: '#8272f0', soft: '#17142a',
      edge: '#9a8cff', contrast: '#090713',
    },
    status: {
      success: '#63d29a', successSoft: '#0c261a', successBorder: '#275640',
      warning: '#e3c074', warningSoft: '#241d0d', warningBorder: '#574728', warningText: '#f4d99a',
      error: '#ec7f8a', errorSoft: '#2a1417', errorBorder: '#5e2c34', errorText: '#ffd4d7',
      info: '#74b0ee',
    },
    diff: {
      addedText: '#c0f0d3', removedText: '#f5c2c6',
      addedBackground: 'rgba(99, 210, 154, .10)', removedBackground: 'rgba(236, 127, 138, .10)',
      modified: '#e3c074',
    },
    effects: {
      focusRing: '#b6acff', scrim: 'rgba(0, 0, 0, .65)',
      scrollbarThumb: '#2a2d36', scrollbarThumbHover: '#3b3f4b',
      shadowLow: '0 1px 2px rgba(0, 0, 0, .5), 0 2px 6px rgba(0, 0, 0, .35)',
      shadowMedium: '0 6px 18px rgba(0, 0, 0, .55), 0 2px 6px rgba(0, 0, 0, .4)',
      shadowHigh: '0 20px 50px rgba(0, 0, 0, .7), 0 8px 24px rgba(0, 0, 0, .5)',
    },
  },
  terminal: {
    background: '#050506', foreground: '#e2e5ec', cursor: '#b6acff', cursorAccent: '#050506',
    selection: 'rgba(154, 140, 255, .27)',
    black: '#12131a', red: '#ec7f8a', green: '#6ad3a0', yellow: '#e3c074', blue: '#74b0ee',
    magenta: '#b79bf8', cyan: '#6fcfd4', white: '#e2e5ec',
    brightBlack: '#6b7280', brightRed: '#ff9aa3', brightGreen: '#8ce0b6', brightYellow: '#efd292',
    brightBlue: '#95c4ff', brightMagenta: '#ccb6ff', brightCyan: '#8ee0e4', brightWhite: '#ffffff',
  },
  editor: {
    base: 'vs-dark', background: '#050506', foreground: '#f3f4f7', lineHighlight: '#0d0e11',
    selection: '#2b2748', gutter: '#050506', cursor: '#b6acff', lineNumber: '#838995',
    lineNumberActive: '#b4b9c3', indentGuide: '#23252c', widgetBackground: '#141519',
    diffInserted: 'rgba(99, 210, 154, .13)', diffRemoved: 'rgba(236, 127, 138, .13)',
  },
}

const ember: ThemeDefinition = {
  id: 'ember',
  name: 'Ember',
  description: 'Warm graphite surfaces with a restrained amber accent.',
  category: 'dark',
  version: 1,
  preview: { hint: 'Warm graphite, amber accent' },
  colors: {
    background: {
      canvas: '#12100c', surface: '#1b1712', surfaceRaised: '#241f18', surfaceOverlay: '#2c261d',
      sidebar: '#171410', input: '#1b1712', hover: '#2a2419', selected: '#282013',
    },
    foreground: {
      primary: '#ece4d7', strong: '#fff7ec', secondary: '#b4a892', muted: '#877a66',
      disabled: '#635a4b', onAccent: '#1a1206',
    },
    border: { default: '#322b20', subtle: '#221e17', strong: '#493f2d', accent: '#4a3d24' },
    accent: {
      primary: '#d8963f', hover: '#e8ac57', active: '#bd7f2f', soft: '#2a2012',
      edge: '#d8963f', contrast: '#1a1206',
    },
    status: {
      success: '#74bd88', successSoft: '#16241a', successBorder: '#2f5238',
      warning: '#e0b45f', warningSoft: '#2a2110', warningBorder: '#574524', warningText: '#f0d69a',
      error: '#e08574', errorSoft: '#2a1a14', errorBorder: '#593a2e', errorText: '#ffd6c8',
      info: '#83a9b5',
    },
    diff: {
      addedText: '#cfe6c0', removedText: '#eec3b4',
      addedBackground: 'rgba(116, 189, 136, .09)', removedBackground: 'rgba(224, 133, 116, .10)',
      modified: '#e0b45f',
    },
    effects: {
      focusRing: '#e8ac57', scrim: 'rgba(10, 7, 3, .58)',
      scrollbarThumb: '#3a3122', scrollbarThumbHover: '#4c4030',
      shadowLow: '0 1px 2px rgba(6, 4, 0, .4), 0 2px 6px rgba(6, 4, 0, .26)',
      shadowMedium: '0 6px 18px rgba(6, 4, 0, .42), 0 2px 6px rgba(6, 4, 0, .3)',
      shadowHigh: '0 20px 50px rgba(6, 4, 0, .58), 0 8px 24px rgba(6, 4, 0, .42)',
    },
  },
  terminal: {
    background: '#12100c', foreground: '#e0d6c6', cursor: '#e8ac57', cursorAccent: '#12100c',
    selection: 'rgba(216, 150, 63, .25)',
    black: '#201a12', red: '#e08574', green: '#9dc389', yellow: '#e0b45f', blue: '#86a7bf',
    magenta: '#c79fb0', cyan: '#7fbcac', white: '#e0d6c6',
    brightBlack: '#857a68', brightRed: '#efa08f', brightGreen: '#b4d4a1', brightYellow: '#eecb85',
    brightBlue: '#a2bfd2', brightMagenta: '#d7b6c4', brightCyan: '#9ccfc1', brightWhite: '#fdf6ea',
  },
  editor: {
    base: 'vs-dark', background: '#12100c', foreground: '#ece4d7', lineHighlight: '#1b1712',
    selection: '#3a2f1a', gutter: '#12100c', cursor: '#e8ac57', lineNumber: '#877a66',
    lineNumberActive: '#b4a892', indentGuide: '#322b20', widgetBackground: '#241f18',
    diffInserted: 'rgba(116, 189, 136, .12)', diffRemoved: 'rgba(224, 133, 116, .13)',
  },
}

const arcticLight: ThemeDefinition = {
  id: 'arctic-light',
  name: 'Arctic Light',
  description: 'Crisp light theme with soft neutral surfaces.',
  category: 'light',
  version: 1,
  preview: { hint: 'Crisp light, soft neutrals' },
  colors: {
    background: {
      canvas: '#eef1f6', surface: '#ffffff', surfaceRaised: '#f6f8fc', surfaceOverlay: '#e9edf4',
      sidebar: '#f4f6fa', input: '#ffffff', hover: '#eef1f7', selected: '#e7ebfb',
    },
    foreground: {
      primary: '#1b2330', strong: '#0a0e15', secondary: '#55606f', muted: '#6d7889',
      disabled: '#a2aab6', onAccent: '#ffffff',
    },
    border: { default: '#d7dce4', subtle: '#e7eaf0', strong: '#bcc4d0', accent: '#c9c6f0' },
    accent: {
      primary: '#6a57df', hover: '#5644c6', active: '#4c3cb0', soft: '#ececfb',
      edge: '#6a57df', contrast: '#ffffff',
    },
    status: {
      success: '#2f8f57', successSoft: '#e4f4ea', successBorder: '#b7dec6',
      warning: '#96650f', warningSoft: '#f7ecd6', warningBorder: '#e4cf9f', warningText: '#7a5307',
      error: '#c23a45', errorSoft: '#fbe6e8', errorBorder: '#eec2c6', errorText: '#8f2730',
      info: '#2f6fbf',
    },
    diff: {
      addedText: '#1f7a44', removedText: '#b23640',
      addedBackground: 'rgba(47, 143, 87, .12)', removedBackground: 'rgba(194, 58, 69, .10)',
      modified: '#96650f',
    },
    effects: {
      focusRing: '#6a57df', scrim: 'rgba(20, 26, 38, .35)',
      scrollbarThumb: '#c4ccd8', scrollbarThumbHover: '#aab4c4',
      shadowLow: '0 1px 2px rgba(20, 28, 45, .1), 0 2px 6px rgba(20, 28, 45, .07)',
      shadowMedium: '0 6px 18px rgba(20, 28, 45, .12), 0 2px 6px rgba(20, 28, 45, .08)',
      shadowHigh: '0 20px 50px rgba(20, 28, 45, .18), 0 8px 24px rgba(20, 28, 45, .12)',
    },
  },
  terminal: {
    background: '#ffffff', foreground: '#1f2733', cursor: '#6a57df', cursorAccent: '#ffffff',
    selection: 'rgba(106, 87, 223, .18)',
    black: '#2b3440', red: '#c23a45', green: '#2f8f57', yellow: '#96650f', blue: '#2f6fbf',
    magenta: '#7d54c9', cyan: '#2b8a8f', white: '#3b434f',
    brightBlack: '#8790a0', brightRed: '#d1515c', brightGreen: '#3aa267', brightYellow: '#b07d1a',
    brightBlue: '#3d80d6', brightMagenta: '#8f66d8', brightCyan: '#37a0a6', brightWhite: '#1b2330',
  },
  editor: {
    base: 'vs', background: '#ffffff', foreground: '#1f2733', lineHighlight: '#f2f4f9',
    selection: '#d9def5', gutter: '#ffffff', cursor: '#6a57df', lineNumber: '#9aa3b2',
    lineNumberActive: '#55606f', indentGuide: '#e2e6ee', widgetBackground: '#f6f8fc',
    diffInserted: 'rgba(47, 143, 87, .14)', diffRemoved: 'rgba(194, 58, 69, .12)',
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
