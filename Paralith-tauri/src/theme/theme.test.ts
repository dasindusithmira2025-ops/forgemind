import { beforeEach, describe, expect, it } from 'vitest'
import indexCss from '../index.css?raw'
import codeSurfaceCss from '../features/code-surface/codeSurface.css?raw'
import toolPanelCss from '../features/code-surface/workspaceToolPanel.css?raw'
import browserCss from '../features/code-surface/browser/browser.css?raw'
import indexHtml from '../../index.html?raw'
import {
  REQUIRED_CSS_VARS, monacoThemeName, toCssVars, toMonacoColors, toTerminalTheme,
} from './tokens'
import { CONCRETE_THEME_ORDER } from './themes'
import {
  DEFAULT_THEME_ID, allConcreteThemes, coerceThemeId, isValidThemeId, listThemes,
  missingCssVars, resolveSystemConcreteId, resolveTheme,
} from './registry'
import { applyTheme, cachedThemeId, STORAGE_KEYS, TOKEN_REVISION } from './applyTheme'

/** Parse `#rgb` / `#rrggbb` into 0-255 channels. Returns null for non-hex token values. */
function hexChannels(value: string): [number, number, number] | null {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim())
  if (!match) return null
  const hex = match[1].length === 3 ? match[1].replace(/./g, (c) => c + c) : match[1]
  return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number]
}

/** Max channel spread. 0 is a perfect grey; the genome caps control fills well below chroma. */
function chroma(value: string): number {
  const rgb = hexChannels(value)
  if (!rgb) return 0
  return Math.max(...rgb) - Math.min(...rgb)
}

/** Relative luminance per WCAG 2.x, for contrast assertions on the control layer. */
function luminance(value: string): number {
  const rgb = hexChannels(value)
  if (!rgb) return 0
  const [r, g, b] = rgb.map((channel) => {
    const c = channel / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrastRatio(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (light + 0.05) / (dark + 0.05)
}

/**
 * Chroma budget for anything in the control layer, as a 0-255 channel spread.
 *
 * 14 (≈5% of the range) leaves room for the deliberately tinted neutral ramps — zinc runs cool,
 * stone runs warm, and both land around 9-12 — while still rejecting anything that reads as a
 * hue. For scale: the iris accent is 111 and the amber accent is 191.
 */
const CONTROL_CHROMA_BUDGET = 14

/** How far apart two neutral surfaces are, as a 0-255 mean-channel distance. */
function step(a: string, b: string): number {
  const [left, right] = [hexChannels(a), hexChannels(b)]
  if (!left || !right) return Number.POSITIVE_INFINITY
  const mean = (rgb: [number, number, number]) => (rgb[0] + rgb[1] + rgb[2]) / 3
  return Math.abs(mean(left) - mean(right))
}

/**
 * The smallest surface step that is still legible as a change of state.
 *
 * 8/255 (≈3%) is roughly where a filled row stops reading as "the same colour, maybe" on a
 * typical laptop panel at a normal brightness. Below that a hover is technically present and
 * practically invisible.
 */
const MIN_SURFACE_STEP = 8

describe('theme registry', () => {
  it('exposes every concrete theme plus a System option, all with unique ids', () => {
    const listed = listThemes()
    const ids = listed.map((entry) => entry.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toContain('system')
    for (const theme of allConcreteThemes()) expect(ids).toContain(theme.id)
  })

  it('ships the six required themes', () => {
    const ids = listThemes().map((entry) => entry.id)
    expect(ids).toEqual(
      expect.arrayContaining(['system', 'paralith-dark', 'graphite', 'obsidian', 'ember', 'arctic-light']),
    )
  })

  it('every concrete theme produces the complete required token set with non-empty values', () => {
    for (const theme of CONCRETE_THEME_ORDER) {
      expect(missingCssVars(theme)).toEqual([])
      const vars = toCssVars(theme)
      for (const name of REQUIRED_CSS_VARS) {
        expect(vars[name]?.trim().length ?? 0).toBeGreaterThan(0)
      }
    }
  })

  it('defines every required token in the index.css bootstrap :root so nothing renders unstyled before applyTheme runs', () => {
    // The app paints from the :root block on first frame (flash-free bootstrap) and only then
    // swaps in the persisted theme. A token added to the theme model but not to that block would
    // resolve to nothing for that frame, so the two lists have to stay in lockstep.
    const root = /:root\s*\{([\s\S]*?)\n\}/.exec(indexCss)
    expect(root).not.toBeNull()
    const declared = new Set(
      Array.from(root![1].matchAll(/^\s*(--[\w-]+)\s*:/gm), (match) => match[1]),
    )
    expect(REQUIRED_CSS_VARS.filter((name) => !declared.has(name))).toEqual([])
  })

  it('validates and coerces theme ids, falling back to the default for unknown values', () => {
    expect(isValidThemeId('graphite')).toBe(true)
    expect(isValidThemeId('system')).toBe(true)
    expect(isValidThemeId('does-not-exist')).toBe(false)
    expect(isValidThemeId(undefined)).toBe(false)
    expect(coerceThemeId('does-not-exist')).toBe(DEFAULT_THEME_ID)
    expect(coerceThemeId(null)).toBe(DEFAULT_THEME_ID)
    expect(coerceThemeId('ember')).toBe('ember')
  })

  it('resolves a corrupt saved id to the default theme rather than leaving the app unstyled', () => {
    expect(resolveTheme('garbage', true).id).toBe(DEFAULT_THEME_ID)
    expect(resolveTheme(undefined, false).id).toBe(DEFAULT_THEME_ID)
  })

  it('resolves System to an appropriate concrete theme for each OS appearance', () => {
    expect(resolveTheme('system', true).category).toBe('dark')
    expect(resolveTheme('system', false).category).toBe('light')
    expect(resolveSystemConcreteId(true)).toBe('paralith-dark')
    expect(resolveSystemConcreteId(false)).toBe('arctic-light')
  })

  it('keeps every theme id lowercase-kebab and backend-acceptable', () => {
    for (const theme of CONCRETE_THEME_ORDER) {
      expect(theme.id).toMatch(/^[a-z0-9-]+$/)
      expect(theme.version).toBeGreaterThan(0)
    }
  })
})

describe('design genome', () => {
  it('fills the highest-emphasis control from the accent ramp, not from a fifth colour', () => {
    // design.md §7.1: the single dominant action in a region takes the accent fill. The risk that
    // creates is a *second* brand colour appearing on buttons, so the fill is pinned to a step of
    // the accent ramp rather than merely being "blue-ish". Light themes take the ramp's darker
    // step, since the primary step itself cannot carry white text at 4.5:1.
    for (const theme of CONCRETE_THEME_ORDER) {
      const { primary, primaryHover, primaryActive, onPrimary } = theme.colors.control
      const { primary: aPrimary, hover: aHover, active: aActive, contrast } = theme.colors.accent
      const ramp = [aPrimary, aHover, aActive]
      for (const [name, value] of Object.entries({ primary, primaryHover, primaryActive })) {
        expect(ramp, `${theme.id}.control.${name} (${value}) is off the accent ramp`).toContain(value)
      }
      expect(onPrimary, `${theme.id}: primary label must be the accent's own contrast colour`).toBe(contrast)
    }
  })

  it('keeps every control tier below primary achromatic so the accent stays the only colour', () => {
    // The 90/8/2 budget only holds if exactly one tier is coloured. Secondary fills, the two
    // floating surfaces and the focus ring all stay on the neutral ladder.
    for (const theme of CONCRETE_THEME_ORDER) {
      const { secondary, secondaryHover, card, popover } = theme.colors.control
      for (const [name, value] of Object.entries({ secondary, secondaryHover, card, popover })) {
        expect(chroma(value), `${theme.id}.control.${name} (${value}) carries chroma`).toBeLessThanOrEqual(CONTROL_CHROMA_BUDGET)
      }
    }
  })

  it('keeps label text on a solid control readable', () => {
    for (const theme of CONCRETE_THEME_ORDER) {
      const { primary, onPrimary, secondary, onSecondary } = theme.colors.control
      expect(contrastRatio(primary, onPrimary), `${theme.id} primary label`).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(secondary, onSecondary), `${theme.id} secondary label`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('draws dividers as an alpha wash rather than an opaque grey', () => {
    // One border value has to sit correctly on canvas, card and popover. An opaque grey cannot:
    // it reads heavy on the canvas and disappears on a raised surface.
    for (const theme of CONCRETE_THEME_ORDER) {
      const { faint, default: base, subtle, hover, strong } = theme.colors.border
      for (const [name, value] of Object.entries({ faint, default: base, subtle, hover, strong })) {
        expect(value, `${theme.id}.border.${name} is not translucent`).toMatch(/^rgb\(|^rgba\(|color-mix/)
      }
    }
  })

  it('keeps the focus ring neutral so a focused control is never confused with an accented one', () => {
    for (const theme of CONCRETE_THEME_ORDER) {
      expect(chroma(theme.colors.control.ring), `${theme.id} ring`).toBeLessThanOrEqual(CONTROL_CHROMA_BUDGET)
      expect(theme.colors.effects.focusRing).toBe(theme.colors.control.ring)
    }
  })

  // Every stylesheet that carries component rules, so genome checks cover the whole app and not
  // just the token layer. Rules 1 and 3 are breakable in component CSS, not only in a palette.
  const GENOME_STYLESHEETS = {
    'index.css': indexCss,
    'codeSurface.css': codeSurfaceCss,
    'workspaceToolPanel.css': toolPanelCss,
    'browser.css': browserCss,
  }

  it('never invents a fifth surface by mixing a component background toward black', () => {
    // Rule 1 allows exactly four neutral steps, and says a fifth "always turns out to be one of
    // these four plus a border". Reaching for `color-mix(..., #000)` instead is theme-fragile: on
    // obsidian (`canvas: #000000`) the mix returns the canvas it started from and the recess it was
    // drawing disappears, while on arctic-light it lands a heavy grey slab under white cards.
    for (const [name, sheet] of Object.entries(GENOME_STYLESHEETS)) {
      expect(sheet, `${name}: step the surface ladder or add a border, do not mix toward black`)
        .not.toMatch(/#000\b|#000000\b/)
    }
  })

  it('never lets a component rule paint a solid control outside the control tokens', () => {
    // The token-level half of rule 3 is covered by the two tests above. It is still breakable in
    // component CSS: a single `.button-primary { background: #4f86ea }` pins one surface to a
    // literal and quietly desynchronises it from every theme but the default.
    for (const [name, sheet] of Object.entries(GENOME_STYLESHEETS)) {
      for (const rule of sheet.split('}')) {
        if (!/\.button-primary\b/.test(rule)) continue
        const background = /background(-color)?:\s*([^;]+)/.exec(rule)
        if (!background) continue
        expect(background[2], `${name}: .button-primary must stay on the --primary tokens`)
          .toMatch(/var\(--primary/)
      }
    }
  })

  it('keeps the hairline ladder monotonic so each step reads as one notch of structure', () => {
    // design.md §4.1 gives five border steps. They are only useful if they are ordered: a `hover`
    // edge that is fainter than the `default` edge it replaces makes a control look like it lost
    // focus on pointer-enter.
    const alpha = (value: string): number => {
      const match = /\/\s*([\d.]+)\s*\)/.exec(value)
      return match ? Number(match[1]) : Number.NaN
    }
    for (const theme of CONCRETE_THEME_ORDER) {
      const { faint, subtle, default: base, hover, strong } = theme.colors.border
      const steps = [faint, subtle, base, hover, strong].map(alpha)
      for (const [index, value] of steps.entries()) {
        expect(value, `${theme.id}: border step ${index} is not an alpha wash`).not.toBeNaN()
      }
      for (let i = 1; i < steps.length; i += 1) {
        expect(steps[i], `${theme.id}: border ladder is not ascending at step ${i}`)
          .toBeGreaterThan(steps[i - 1])
      }
    }
  })

  it('never reads a custom property that no stylesheet defines', () => {
    // `var(--undefined)` with no fallback is invalid at computed-value time, so the declaration is
    // dropped silently rather than failing loudly. On an inherited property like `color` the
    // element then takes its parent's value, which is how the update toast shipped a near-white
    // label on the violet accent at 2.65:1. A var with no fallback has to resolve.
    const defined = new Set<string>()
    for (const sheet of Object.values(GENOME_STYLESHEETS)) {
      for (const match of sheet.matchAll(/(--[a-zA-Z0-9-]+)\s*:/g)) defined.add(match[1])
    }
    for (const [name, sheet] of Object.entries(GENOME_STYLESHEETS)) {
      for (const match of sheet.matchAll(/var\(\s*(--[a-zA-Z0-9-]+)\s*([,)])/g)) {
        if (match[2] === ',') continue // a fallback makes the reference safe
        expect(defined, `${name}: var(${match[1]}) has no definition and no fallback`)
          .toContain(match[1])
      }
    }
  })

  it('keeps every interaction fill visible on every surface it can be painted on', () => {
    // The bug this catches: `--surface-hover` and `--surface-3` collapsing onto the same value,
    // which makes hover invisible on chips, badges and the active pane header while still looking
    // correct on the canvas — so it reads as "hover is broken on some rows" rather than as a
    // palette mistake. A hover can land on any surface in the ladder, so it has to clear all of
    // them, not just the canvas.
    for (const theme of CONCRETE_THEME_ORDER) {
      const { canvas, surface, surfaceRaised, surfaceOverlay, sidebar, hover, pressed, selected } =
        theme.colors.background
      const ladder = { canvas, surface, surfaceRaised, surfaceOverlay, sidebar }
      for (const [stateName, state] of Object.entries({ hover, pressed, selected })) {
        for (const [surfaceName, base] of Object.entries(ladder)) {
          expect(
            step(state, base),
            `${theme.id}: ${stateName} (${state}) is indistinguishable from ${surfaceName} (${base})`,
          ).toBeGreaterThanOrEqual(MIN_SURFACE_STEP)
        }
      }
    }
  })

  it('separates the three interaction fills from each other', () => {
    for (const theme of CONCRETE_THEME_ORDER) {
      const { hover, pressed, selected } = theme.colors.background
      expect(step(hover, pressed), `${theme.id}: hover vs pressed`).toBeGreaterThanOrEqual(MIN_SURFACE_STEP)
      expect(step(pressed, selected), `${theme.id}: pressed vs selected`).toBeGreaterThanOrEqual(MIN_SURFACE_STEP)
    }
  })

  it('floats a popover clear of the sidebar it opens over', () => {
    // Our one Project popover opens directly on top of the sidebar. Orca gives popover, card and
    // sidebar a single surface, which works there but would leave our menu carried entirely by a
    // 7%-alpha border, so the popover takes one step of elevation.
    //
    // Dark themes only: on a light theme the card is already white and there is nowhere above it
    // to go, so a light popover's elevation is carried by its shadow instead — which is exactly
    // where a drop shadow reads best.
    for (const theme of CONCRETE_THEME_ORDER.filter((entry) => entry.category === 'dark')) {
      expect(
        step(theme.colors.control.popover, theme.colors.background.sidebar),
        `${theme.id}: popover sits flat on the sidebar`,
      ).toBeGreaterThanOrEqual(MIN_SURFACE_STEP)
    }
  })

  it('keeps every role hue distinguishable from every other role hue', () => {
    // Roles are identity, not status: two roles that render as the same dot are unreadable in the
    // swarm graph regardless of how pleasant the palette is.
    for (const theme of CONCRETE_THEME_ORDER) {
      const entries = Object.entries(theme.colors.role)
      for (let i = 0; i < entries.length; i += 1) {
        for (let j = i + 1; j < entries.length; j += 1) {
          const [aName, a] = entries[i]
          const [bName, b] = entries[j]
          expect(a, `${theme.id}: ${aName} and ${bName} share a hue`).not.toBe(b)
        }
      }
    }
  })
})

describe('terminal + editor mapping', () => {
  it('converts a theme into a full xterm palette (16 ANSI colours + core colours)', () => {
    const term = toTerminalTheme(CONCRETE_THEME_ORDER[0])
    for (const key of [
      'background', 'foreground', 'cursor', 'cursorAccent', 'selectionBackground',
      'black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white',
      'brightBlack', 'brightRed', 'brightGreen', 'brightYellow', 'brightBlue',
      'brightMagenta', 'brightCyan', 'brightWhite',
    ]) {
      expect(term[key], `missing ${key}`).toBeTruthy()
    }
  })

  it('names Monaco themes deterministically and maps editor colours + base', () => {
    for (const theme of CONCRETE_THEME_ORDER) {
      expect(monacoThemeName(theme.id)).toBe(`paralith-${theme.id}`)
      const colors = toMonacoColors(theme)
      expect(colors['editor.background']).toBe(theme.editor.background)
      expect(colors['editor.foreground']).toBe(theme.editor.foreground)
      expect(['vs', 'vs-dark']).toContain(theme.editor.base)
    }
    // Light theme uses the light Monaco base; dark themes use the dark base.
    const light = allConcreteThemes().find((theme) => theme.category === 'light')!
    expect(light.editor.base).toBe('vs')
  })
})

describe('applyTheme', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.removeAttribute('style')
    document.documentElement.removeAttribute('data-theme')
  })

  it('writes CSS variables, the data-theme attribute, color-scheme, and the bootstrap cache', () => {
    const theme = resolveTheme('graphite', true)
    applyTheme(theme, 'graphite')
    const root = document.documentElement
    expect(root.getAttribute('data-theme')).toBe('graphite')
    expect(root.style.getPropertyValue('--bg')).toBe(theme.colors.background.canvas)
    expect(root.style.colorScheme).toBe('dark')
    expect(localStorage.getItem(STORAGE_KEYS.id)).toBe('graphite')
    expect(localStorage.getItem(STORAGE_KEYS.scheme)).toBe('dark')
    expect(cachedThemeId()).toBe('graphite')
    const cached = JSON.parse(localStorage.getItem(STORAGE_KEYS.vars) ?? '{}')
    expect(cached['--bg']).toBe(theme.colors.background.canvas)
    expect(cached['--primary']).toBe(theme.colors.control.primary)
  })

  it('stamps the cache with the token revision the index.html bootstrap gates on', () => {
    // The bootstrap replays the cache only when the stamps match. If this literal drifts from the
    // one in index.html, an upgraded install paints a frame of the previous palette.
    applyTheme(resolveTheme('paralith-dark', true), 'paralith-dark')
    expect(localStorage.getItem(STORAGE_KEYS.rev)).toBe(TOKEN_REVISION)
    expect(indexHtml).toContain(`localStorage.getItem('paralith.theme.rev') === '${TOKEN_REVISION}'`)
  })

  it('stores the user selection (system), not the resolved id, so the choice survives restart', () => {
    applyTheme(resolveTheme('system', false), 'system')
    expect(localStorage.getItem(STORAGE_KEYS.id)).toBe('system')
    expect(document.documentElement.style.colorScheme).toBe('light')
  })
})
