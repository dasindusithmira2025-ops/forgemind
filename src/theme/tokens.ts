/**
 * PARALITH theme token model.
 *
 * A theme is defined once as a set of *semantic* tokens. Every downstream surface — the CSS custom
 * properties consumed across `index.css`, the xterm palette, and the Monaco editor theme — is
 * derived from these tokens by pure functions so a preview can never drift from what is applied.
 *
 * The token names are intentionally semantic (`background.surface`, `accent.hover`) rather than
 * component-specific. Raw colour values live only in `themes.ts`.
 */

export type ThemeCategory = 'dark' | 'light' | 'system'

/** The stable id set persisted to settings + localStorage. Kept as a literal union for exhaustiveness. */
export type ThemeId = 'paralith-dark' | 'graphite' | 'obsidian' | 'ember' | 'arctic-light' | 'system'

export interface BackgroundTokens {
  /** The application root / editor-less canvas. */
  canvas: string
  /** Default panel / card surface. */
  surface: string
  /** A surface raised one level above the default (menus, popovers, active headers step 1). */
  surfaceRaised: string
  /** The highest neutral surface (active pane header, overlay chrome). */
  surfaceOverlay: string
  /** Primary sidebar / navigation column. */
  sidebar: string
  /** Text inputs, selects, textareas. */
  input: string
  /** Hover feedback on rows, list items, ghost buttons. */
  hover: string
  /** Selected / active row background. */
  selected: string
  /** Active press feedback — one step denser than {@link hover}. */
  pressed: string
  /** Fill for disabled controls; stays readable rather than fading out. */
  disabled: string
}

export interface ForegroundTokens {
  /** Body text. */
  primary: string
  /** Emphasised text (headings, active labels). */
  strong: string
  /** Secondary text. */
  secondary: string
  /** Muted / tertiary text — still readable, never decorative-only. */
  muted: string
  /** Disabled text. */
  disabled: string
  /** Text drawn on top of the accent fill. */
  onAccent: string
}

export interface BorderTokens {
  /** Default separators and control borders. */
  default: string
  /** The faintest hairline dividers. */
  subtle: string
  /** Emphasised borders (focused inputs, active pane outline). */
  strong: string
  /** Accent-tinted border used on accent chips/badges. */
  accent: string
}

export interface AccentTokens {
  /** Primary brand accent fill. */
  primary: string
  /** Brighter accent for hover / emphasis text. */
  hover: string
  /** Pressed / active accent. */
  active: string
  /** Low-emphasis accent surface (chip / badge background). */
  soft: string
  /** The 2px "state edge" marker colour. */
  edge: string
  /** Text/graphic drawn on top of the accent fill. */
  contrast: string
}

export interface StatusTokens {
  success: string
  successSoft: string
  successBorder: string
  warning: string
  warningSoft: string
  warningBorder: string
  warningText: string
  error: string
  errorSoft: string
  errorBorder: string
  errorText: string
  info: string
  /** Agent/task lifecycle states. These carry meaning through a dot, badge, or icon — never
   *  through a filled panel. `success` and `error` above serve as the terminal success/failure
   *  states, so they are deliberately not duplicated here. */
  working: string
  waiting: string
  blocked: string
  unread: string
  offline: string
  idle: string
}

/** Version-control decorations. Kept separate from {@link StatusTokens} so Git meaning never
 *  drifts into agent-state meaning even when the underlying hues are related. */
export interface GitTokens {
  added: string
  modified: string
  deleted: string
  renamed: string
  untracked: string
  branch: string
  review: string
  conflict: string
}

/** Provider identity for agent rows and icons. Used at icon/dot scale only — provider colour
 *  must never fill a region large enough to read as the app's own accent. */
export interface AgentTokens {
  claude: string
  codex: string
  generic: string
  /** Highlight for an agent-initiated action awaiting the operator. */
  action: string
}

/** Evidence state in the Proof Ledger. */
export interface ProofTokens {
  verified: string
  partial: string
  missing: string
  failed: string
}

export interface DiffTokens {
  addedText: string
  removedText: string
  addedBackground: string
  removedBackground: string
  modified: string
}

export interface EffectTokens {
  focusRing: string
  shadowLow: string
  shadowMedium: string
  shadowHigh: string
  scrim: string
  scrollbarThumb: string
  scrollbarThumbHover: string
}

export interface SemanticColors {
  background: BackgroundTokens
  foreground: ForegroundTokens
  border: BorderTokens
  accent: AccentTokens
  status: StatusTokens
  git: GitTokens
  agent: AgentTokens
  proof: ProofTokens
  diff: DiffTokens
  effects: EffectTokens
}

/** The 16 ANSI colours plus core rendering colours for xterm.js. */
export interface TerminalPalette {
  background: string
  foreground: string
  cursor: string
  cursorAccent: string
  selection: string
  black: string
  red: string
  green: string
  yellow: string
  blue: string
  magenta: string
  cyan: string
  white: string
  brightBlack: string
  brightRed: string
  brightGreen: string
  brightYellow: string
  brightBlue: string
  brightMagenta: string
  brightCyan: string
  brightWhite: string
}

/** Colour mapping used when registering the Monaco editor + diff theme. */
export interface EditorColors {
  /** `vs` for light themes, `vs-dark` for dark themes. */
  base: 'vs' | 'vs-dark'
  background: string
  foreground: string
  lineHighlight: string
  selection: string
  gutter: string
  cursor: string
  lineNumber: string
  lineNumberActive: string
  indentGuide: string
  widgetBackground: string
  diffInserted: string
  diffRemoved: string
}

export interface ThemePreviewMeta {
  /** Short human hint used by assistive tech / tooltips. */
  hint: string
}

export interface ThemeDefinition {
  id: ThemeId
  name: string
  description: string
  category: ThemeCategory
  /** Bumped when the token shape changes so caches can be invalidated safely. */
  version: number
  colors: SemanticColors
  terminal: TerminalPalette
  editor: EditorColors
  preview: ThemePreviewMeta
}

/**
 * Flatten a theme's semantic colours into the CSS custom properties consumed by `index.css`.
 * This is the single mapping between semantic tokens and the concrete `--*` variables, so adding a
 * variable in one place keeps every surface consistent. Metrics/typography tokens are theme
 * independent and stay defined in `index.css :root`.
 */
export function toCssVars(theme: ThemeDefinition): Record<string, string> {
  const { background: bg, foreground: fg, border, accent, status, git, agent, proof, diff, effects } = theme.colors
  const term = theme.terminal
  return {
    '--bg': bg.canvas,
    '--canvas': term.background,
    '--surface': bg.surface,
    '--surface-2': bg.surfaceRaised,
    '--surface-3': bg.surfaceOverlay,
    '--surface-hover': bg.hover,
    '--sidebar-bg': bg.sidebar,
    '--bg-input': bg.input,
    '--bg-selected': bg.selected,
    '--surface-pressed': bg.pressed,
    '--surface-disabled': bg.disabled,

    '--border': border.default,
    '--border-subtle': border.subtle,
    '--border-strong': border.strong,
    '--accent-border': border.accent,

    '--text': fg.primary,
    '--text-strong': fg.strong,
    '--muted': fg.secondary,
    '--faint': fg.muted,
    '--disabled': fg.disabled,

    '--accent': accent.primary,
    '--accent-strong': accent.hover,
    '--accent-active': accent.active,
    '--accent-soft': accent.soft,
    '--accent-edge': accent.edge,
    '--on-accent': accent.contrast,

    '--success': status.success,
    '--success-soft': status.successSoft,
    '--success-border': status.successBorder,
    '--warning': status.warning,
    '--warning-soft': status.warningSoft,
    '--warning-border': status.warningBorder,
    '--warning-text': status.warningText,
    '--danger': status.error,
    '--danger-soft': status.errorSoft,
    '--danger-border': status.errorBorder,
    '--danger-text': status.errorText,
    '--info': status.info,
    '--status-working': status.working,
    '--status-waiting': status.waiting,
    '--status-blocked': status.blocked,
    '--status-unread': status.unread,
    '--status-offline': status.offline,
    '--status-idle': status.idle,

    '--git-added': git.added,
    '--git-modified': git.modified,
    '--git-deleted': git.deleted,
    '--git-renamed': git.renamed,
    '--git-untracked': git.untracked,
    '--git-branch': git.branch,
    '--git-review': git.review,
    '--git-conflict': git.conflict,

    '--agent-claude': agent.claude,
    '--agent-codex': agent.codex,
    '--agent-generic': agent.generic,
    '--agent-action': agent.action,

    '--proof-verified': proof.verified,
    '--proof-partial': proof.partial,
    '--proof-missing': proof.missing,
    '--proof-failed': proof.failed,

    '--diff-add-text': diff.addedText,
    '--diff-del-text': diff.removedText,
    '--diff-add-bg': diff.addedBackground,
    '--diff-del-bg': diff.removedBackground,

    '--terminal-fg': term.foreground,

    '--focus-ring': effects.focusRing,
    '--overlay-scrim': effects.scrim,
    '--scrollbar-thumb': effects.scrollbarThumb,
    '--scrollbar-thumb-hover': effects.scrollbarThumbHover,
    '--shadow-sm': effects.shadowLow,
    '--shadow-md': effects.shadowMedium,
    '--shadow-lg': effects.shadowHigh,
  }
}

/** The complete list of CSS variable names a valid theme must produce. Used by tests. */
export const REQUIRED_CSS_VARS: readonly string[] = [
  '--bg', '--canvas', '--surface', '--surface-2', '--surface-3', '--surface-hover',
  '--sidebar-bg', '--bg-input', '--bg-selected', '--surface-pressed', '--surface-disabled',
  '--border', '--border-subtle', '--border-strong', '--accent-border',
  '--text', '--text-strong', '--muted', '--faint', '--disabled',
  '--accent', '--accent-strong', '--accent-active', '--accent-soft', '--accent-edge', '--on-accent',
  '--success', '--success-soft', '--success-border',
  '--warning', '--warning-soft', '--warning-border', '--warning-text',
  '--danger', '--danger-soft', '--danger-border', '--danger-text', '--info',
  '--status-working', '--status-waiting', '--status-blocked',
  '--status-unread', '--status-offline', '--status-idle',
  '--git-added', '--git-modified', '--git-deleted', '--git-renamed',
  '--git-untracked', '--git-branch', '--git-review', '--git-conflict',
  '--agent-claude', '--agent-codex', '--agent-generic', '--agent-action',
  '--proof-verified', '--proof-partial', '--proof-missing', '--proof-failed',
  '--diff-add-text', '--diff-del-text', '--diff-add-bg', '--diff-del-bg',
  '--terminal-fg', '--focus-ring', '--overlay-scrim',
  '--scrollbar-thumb', '--scrollbar-thumb-hover', '--shadow-sm', '--shadow-md', '--shadow-lg',
]

/** Convert a theme palette into the xterm.js ITheme shape (a stable structural subset). */
export function toTerminalTheme(theme: ThemeDefinition): Record<string, string> {
  const t = theme.terminal
  return {
    background: t.background,
    foreground: t.foreground,
    cursor: t.cursor,
    cursorAccent: t.cursorAccent,
    selectionBackground: t.selection,
    black: t.black,
    red: t.red,
    green: t.green,
    yellow: t.yellow,
    blue: t.blue,
    magenta: t.magenta,
    cyan: t.cyan,
    white: t.white,
    brightBlack: t.brightBlack,
    brightRed: t.brightRed,
    brightGreen: t.brightGreen,
    brightYellow: t.brightYellow,
    brightBlue: t.brightBlue,
    brightMagenta: t.brightMagenta,
    brightCyan: t.brightCyan,
    brightWhite: t.brightWhite,
  }
}

/** The internal Monaco theme name registered for a given theme id. */
export function monacoThemeName(id: ThemeId): string {
  return `paralith-${id}`
}

/** Build the Monaco `defineTheme` colour map from a theme's editor tokens. */
export function toMonacoColors(theme: ThemeDefinition): Record<string, string> {
  const e = theme.editor
  return {
    'editor.background': e.background,
    'editor.foreground': e.foreground,
    'editorLineNumber.foreground': e.lineNumber,
    'editorLineNumber.activeForeground': e.lineNumberActive,
    'editor.selectionBackground': e.selection,
    'editor.lineHighlightBackground': e.lineHighlight,
    'editorCursor.foreground': e.cursor,
    'editorIndentGuide.background1': e.indentGuide,
    'editorWidget.background': e.widgetBackground,
    'editorGutter.background': e.gutter,
    'diffEditor.insertedTextBackground': e.diffInserted,
    'diffEditor.removedTextBackground': e.diffRemoved,
    focusBorder: '#00000000',
  }
}
