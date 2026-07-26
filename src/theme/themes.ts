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
      canvas: '#0b0b0c', surface: '#111112', surfaceRaised: '#161617', surfaceOverlay: '#1c1c1e',
      sidebar: '#0f0f10', input: '#1a1a1c', hover: '#232326', selected: '#313136',
      pressed: '#2b2b2e', disabled: '#171718',
    },
    foreground: {
      primary: '#f4f4f5', strong: '#ffffff', secondary: '#c8c8cb', muted: '#97979d',
      disabled: '#66666c', onAccent: '#120e2b',
    },
    border: { default: '#26262a', subtle: '#1c1c1f', strong: '#3a3a40', accent: '#35305c' },
    accent: {
      primary: '#8b7cf6', hover: '#a89bfa', active: '#7668e0', soft: '#201d33',
      edge: '#8b7cf6', contrast: '#120e2b',
    },
    status: {
      success: '#55c982', successSoft: '#12241a', successBorder: '#2a5540',
      warning: '#d9a441', warningSoft: '#231c10', warningBorder: '#57462a', warningText: '#eeca86',
      error: '#ec7277', errorSoft: '#28171a', errorBorder: '#5c2d33', errorText: '#f9cdcf',
      info: '#68a6ef',
      working: '#36c990', waiting: '#d9a441', blocked: '#e36f72',
      unread: '#68a6ef', offline: '#6e6e76', idle: '#8d8d93',
    },
    git: {
      added: '#59b978', modified: '#d3a54e', deleted: '#e36f72', renamed: '#a38ae8',
      untracked: '#7d7d86', branch: '#6fa8e6', review: '#a38ae8', conflict: '#ed7b72',
    },
    agent: { claude: '#d97757', codex: '#9aa0aa', generic: '#8d8d93', action: '#8b7cf6' },
    proof: { verified: '#55c982', partial: '#d9a441', missing: '#6e6e76', failed: '#ec7277' },
    role: {
      coordinator: '#5794df', scout: '#62a86f', builder: '#45aeb1',
      reviewer: '#c8994f', debugger: '#cf735c', integrator: '#9276c9',
    },
    risk: { low: '#6fce9f', medium: '#d9a441', high: '#e5896a', critical: '#e5678a' },
    diff: {
      addedText: '#b6e8c9', removedText: '#f0bcbc',
      addedBackground: 'rgba(89, 185, 120, .09)', removedBackground: 'rgba(236, 114, 119, .09)',
      modified: '#d3a54e',
    },
    effects: {
      focusRing: '#8b7cf6', scrim: 'rgba(0, 0, 0, .55)',
      scrollbarThumb: '#2e2e33', scrollbarThumbHover: '#3d3d44',
      shadowLow: '0 1px 2px rgba(0, 0, 0, .35), 0 2px 6px rgba(0, 0, 0, .22)',
      shadowMedium: '0 6px 18px rgba(0, 0, 0, .38), 0 2px 6px rgba(0, 0, 0, .28)',
      shadowHigh: '0 20px 50px rgba(0, 0, 0, .55), 0 8px 24px rgba(0, 0, 0, .4)',
    },
  },
  terminal: {
    background: '#0b0b0c', foreground: '#dcdcdf', cursor: '#a89bfa', cursorAccent: '#0b0b0c',
    selection: 'rgba(139, 124, 246, .30)',
    black: '#17171a', red: '#ef7d7d', green: '#82c99a', yellow: '#d9bf76', blue: '#72a7ff',
    magenta: '#b99af7', cyan: '#70c4c9', white: '#dcdcdf',
    brightBlack: '#74747d', brightRed: '#ff9a9a', brightGreen: '#9adcb2', brightYellow: '#ecd48f',
    brightBlue: '#93bdff', brightMagenta: '#ccb2ff', brightCyan: '#8ad9de', brightWhite: '#f6f6f8',
  },
  editor: {
    base: 'vs-dark', background: '#0d0d0e', foreground: '#f4f4f5', lineHighlight: '#151517',
    selection: '#2c2a4a', gutter: '#0d0d0e', cursor: '#a89bfa', lineNumber: '#97979d',
    lineNumberActive: '#c8c8cb', indentGuide: '#26262a', widgetBackground: '#161617',
    diffInserted: 'rgba(89, 185, 120, .12)', diffRemoved: 'rgba(236, 114, 119, .12)',
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
      canvas: '#0f1012', surface: '#16171a', surfaceRaised: '#1c1e22', surfaceOverlay: '#23252a',
      sidebar: '#131417', input: '#1e2025', hover: '#292c32', selected: '#33363d',
      pressed: '#2e3138', disabled: '#1b1c20',
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
      working: '#6fbf95', waiting: '#cdb072', blocked: '#d98b90',
      unread: '#86a7c9', offline: '#666b75', idle: '#767c87',
    },
    git: {
      added: '#6fbf95', modified: '#cdb072', deleted: '#d98b90', renamed: '#a99fc0',
      untracked: '#767c87', branch: '#86a7c9', review: '#a99fc0', conflict: '#dd9196',
    },
    agent: { claude: '#c98567', codex: '#9aa0aa', generic: '#8b95a6', action: '#a6afbd' },
    proof: { verified: '#6fbf95', partial: '#cdb072', missing: '#666b75', failed: '#d98b90' },
    /* Graphite deliberately suppresses chroma, so roles stay recognisable by hue but never
       compete with content. */
    role: {
      coordinator: '#7d93ab', scout: '#7fa287', builder: '#6fa3a5',
      reviewer: '#b9a279', debugger: '#c08d7e', integrator: '#9b93b5',
    },
    risk: { low: '#6fbf95', medium: '#cdb072', high: '#d9a07f', critical: '#d98b90' },
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
    background: '#0f1012', foreground: '#d5d8de', cursor: '#a6afbd', cursorAccent: '#0f1012',
    selection: 'rgba(139, 149, 166, .30)',
    black: '#1b1e24', red: '#d98b90', green: '#8dc7a2', yellow: '#cdb072', blue: '#8fb0d4',
    magenta: '#b0a6c4', cyan: '#86bcc0', white: '#d5d8de',
    brightBlack: '#727884', brightRed: '#e6a3a7', brightGreen: '#a6d6ba', brightYellow: '#dcc691',
    brightBlue: '#a8c4e0', brightMagenta: '#c4bcd6', brightCyan: '#a0cccf', brightWhite: '#eef0f4',
  },
  editor: {
    base: 'vs-dark', background: '#111214', foreground: '#e5e7ec', lineHighlight: '#16171a',
    selection: '#2f3540', gutter: '#111214', cursor: '#a6afbd', lineNumber: '#8b9099',
    lineNumberActive: '#c3c7ce', indentGuide: '#2b2e35', widgetBackground: '#1c1e22',
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
      canvas: '#050506', surface: '#0d0d0f', surfaceRaised: '#141416', surfaceOverlay: '#1c1c1f',
      sidebar: '#08080a', input: '#17171a', hover: '#1f1f23', selected: '#2c2c31',
      pressed: '#26262a', disabled: '#141416',
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
      working: '#63d29a', waiting: '#e3c074', blocked: '#ec7f8a',
      unread: '#74b0ee', offline: '#6b7280', idle: '#838995',
    },
    git: {
      added: '#63d29a', modified: '#e3c074', deleted: '#ec7f8a', renamed: '#b09bff',
      untracked: '#838995', branch: '#74b0ee', review: '#b09bff', conflict: '#f28a92',
    },
    agent: { claude: '#e08464', codex: '#a3a9b3', generic: '#838995', action: '#9a8cff' },
    proof: { verified: '#63d29a', partial: '#e3c074', missing: '#6b7280', failed: '#ec7f8a' },
    role: {
      coordinator: '#6aa6f0', scout: '#72bd82', builder: '#55c3c6',
      reviewer: '#dcaa5e', debugger: '#e28470', integrator: '#a68ade',
    },
    risk: { low: '#63d29a', medium: '#e3c074', high: '#ec9a72', critical: '#f2758c' },
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
    base: 'vs-dark', background: '#08080a', foreground: '#f3f4f7', lineHighlight: '#0d0d0f',
    selection: '#2b2748', gutter: '#08080a', cursor: '#b6acff', lineNumber: '#8f95a1',
    lineNumberActive: '#c6cad3', indentGuide: '#23252c', widgetBackground: '#141416',
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
      sidebar: '#171410', input: '#221d15', hover: '#2a2419', selected: '#38301f',
      pressed: '#332c1c', disabled: '#1f1a14',
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
      working: '#74bd88', waiting: '#e0b45f', blocked: '#e08574',
      unread: '#83a9b5', offline: '#6f6555', idle: '#877a66',
    },
    git: {
      added: '#74bd88', modified: '#e0b45f', deleted: '#e08574', renamed: '#c9a06f',
      untracked: '#877a66', branch: '#83a9b5', review: '#c9a06f', conflict: '#e89078',
    },
    agent: { claude: '#dd8a5f', codex: '#a99c88', generic: '#877a66', action: '#d8963f' },
    proof: { verified: '#74bd88', partial: '#e0b45f', missing: '#6f6555', failed: '#e08574' },
    /* Ember runs warm, so the cool roles are pulled toward the theme's slate-teal info hue
       rather than a true blue that would read as foreign. */
    role: {
      coordinator: '#7ea6b4', scout: '#86b57f', builder: '#6fae9f',
      reviewer: '#dca85c', debugger: '#dd8467', integrator: '#b294c4',
    },
    risk: { low: '#74bd88', medium: '#e0b45f', high: '#e08574', critical: '#d9647a' },
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
      sidebar: '#f4f6fa', input: '#ffffff', hover: '#eef1f7', selected: '#dfe4f6',
      pressed: '#e2e6f0', disabled: '#f1f3f7',
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
      working: '#1f8a5c', waiting: '#96650f', blocked: '#b83b46',
      unread: '#2f6fbf', offline: '#8790a0', idle: '#6d7889',
    },
    git: {
      added: '#1f7a44', modified: '#96650f', deleted: '#c23a45', renamed: '#6a4fc0',
      untracked: '#6d7889', branch: '#2f6fbf', review: '#6a4fc0', conflict: '#b02a35',
    },
    agent: { claude: '#b8552c', codex: '#55606f', generic: '#6d7889', action: '#6a57df' },
    proof: { verified: '#1f7a44', partial: '#96650f', missing: '#8790a0', failed: '#c23a45' },
    /* Darkened on light: these are read against white surfaces, so they carry the contrast the
       dark themes get for free. */
    role: {
      coordinator: '#2f6fbf', scout: '#2f8f57', builder: '#17787c',
      reviewer: '#96650f', debugger: '#b8552c', integrator: '#6a4fc0',
    },
    risk: { low: '#2f8f57', medium: '#96650f', high: '#b45a2a', critical: '#b0263a' },
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
