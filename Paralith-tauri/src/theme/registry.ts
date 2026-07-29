import type { ThemeCategory, ThemeDefinition, ThemeId } from './tokens'
import { REQUIRED_CSS_VARS, toCssVars } from './tokens'
import { CONCRETE_THEMES, CONCRETE_THEME_ORDER } from './themes'

/** The id applied when a persisted preference is missing, invalid, or unreadable. */
export const DEFAULT_THEME_ID: ThemeId = 'paralith-dark'
export const SYSTEM_THEME_ID: ThemeId = 'system'

/** The concrete themes system resolves to for each OS appearance. */
const SYSTEM_DARK_ID: ThemeId = 'paralith-dark'
const SYSTEM_LIGHT_ID: ThemeId = 'arctic-light'

/** A card entry shown in the Appearance grid, including the synthetic System option. */
export interface ThemeListEntry {
  id: ThemeId
  name: string
  description: string
  category: ThemeCategory
}

/** True when `id` is a recognised theme id (including `system`). */
export function isValidThemeId(id: string | null | undefined): id is ThemeId {
  return id === SYSTEM_THEME_ID || (typeof id === 'string' && id in CONCRETE_THEMES)
}

/** Normalise any input to a valid theme id, falling back to the default. */
export function coerceThemeId(id: string | null | undefined): ThemeId {
  return isValidThemeId(id) ? id : DEFAULT_THEME_ID
}

/**
 * Resolve a (possibly `system`) theme id to a concrete {@link ThemeDefinition}. `prefersDark`
 * comes from the OS appearance query; it is ignored for non-system ids. Any unknown id falls back
 * to the default theme so a corrupt preference can never leave the app unstyled.
 */
export function resolveTheme(id: string | null | undefined, prefersDark: boolean): ThemeDefinition {
  if (id === SYSTEM_THEME_ID) {
    return CONCRETE_THEMES[prefersDark ? SYSTEM_DARK_ID : SYSTEM_LIGHT_ID]
  }
  if (isValidThemeId(id)) return CONCRETE_THEMES[id]
  return CONCRETE_THEMES[DEFAULT_THEME_ID]
}

/** The concrete id `system` resolves to for the given OS appearance. */
export function resolveSystemConcreteId(prefersDark: boolean): ThemeId {
  return prefersDark ? SYSTEM_DARK_ID : SYSTEM_LIGHT_ID
}

/** Ordered list for the Appearance grid: System first, then the concrete themes. */
export function listThemes(): ThemeListEntry[] {
  return [
    {
      id: SYSTEM_THEME_ID,
      name: 'System',
      description: 'Follow the operating system’s light or dark appearance.',
      category: 'system',
    },
    ...CONCRETE_THEME_ORDER.map((theme) => ({
      id: theme.id,
      name: theme.name,
      description: theme.description,
      category: theme.category,
    })),
  ]
}

/** The concrete theme used to render a card preview for `id` (resolves system). */
export function previewTheme(id: ThemeId, prefersDark: boolean): ThemeDefinition {
  return resolveTheme(id, prefersDark)
}

/** All concrete theme definitions (excludes the synthetic system entry). */
export function allConcreteThemes(): ThemeDefinition[] {
  return CONCRETE_THEME_ORDER
}

/**
 * Validate a theme definition produces every required CSS variable with a non-empty value. Returns
 * the list of missing variable names (empty when valid). Exercised by the theme registry tests.
 */
export function missingCssVars(theme: ThemeDefinition): string[] {
  const vars = toCssVars(theme)
  return REQUIRED_CSS_VARS.filter((name) => !vars[name] || vars[name].trim() === '')
}
