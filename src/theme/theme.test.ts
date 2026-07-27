import { beforeEach, describe, expect, it } from 'vitest'
import indexCss from '../index.css?raw'
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
  it('keeps solid controls achromatic so chroma stays reserved for meaning', () => {
    // A primary button tinted toward the accent makes every screen with a save button look like
    // the accent is the subject. The control layer is therefore held to near-grey.
    for (const theme of CONCRETE_THEME_ORDER) {
      const { primary, primaryHover, primaryActive, secondary } = theme.colors.control
      for (const [name, value] of Object.entries({ primary, primaryHover, primaryActive, secondary })) {
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
      const { default: base, subtle, strong } = theme.colors.border
      for (const [name, value] of Object.entries({ default: base, subtle, strong })) {
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

  it('gives card and popover the same elevation surface', () => {
    for (const theme of CONCRETE_THEME_ORDER) {
      expect(theme.colors.control.card, `${theme.id}`).toBe(theme.colors.control.popover)
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
