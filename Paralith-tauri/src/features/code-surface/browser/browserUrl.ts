/**
 * URL handling for the embedded development Browser surface.
 *
 * These are pure functions with no DOM/Tauri dependency so they can be exhaustively unit-tested and
 * reused by both the navigation bar and the Rust-facing command layer's client guard. The Browser is
 * a developer tool aimed at localhost dev servers, so bare `host:port` input is normalized to http,
 * but every result is still validated against a strict scheme allow-list before it is allowed to
 * become a real navigation.
 */

/** Schemes the embedded browser is ever allowed to navigate to. Everything else — `file:`,
 * `javascript:`, `data:`, `about:`, `blob:`, and privileged internal schemes such as `tauri:`,
 * `ipc:`, `asset:` — is refused so a page can never reach the local filesystem or Paralith IPC. */
export const ALLOWED_BROWSER_SCHEMES = ['http:', 'https:'] as const

export type UrlRejectReason = 'empty' | 'invalid' | 'blocked-scheme'

export type NormalizedUrl =
  | { ok: true; url: string; secure: boolean }
  | { ok: false; reason: UrlRejectReason; scheme?: string }

const SCHEME_WITH_SLASHES = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//
const BARE_SCHEME = /^([a-zA-Z][a-zA-Z0-9+.-]*):(?!\/\/)/

/**
 * Normalize free-form address-bar input into a concrete, allow-listed URL.
 *
 * - `localhost:3000`, `127.0.0.1:8080/api?x=1` → `http://…` (host:port with a numeric port).
 * - `example.com/path` → `http://example.com/path` (bare host).
 * - `https://site` is preserved, including its path, query and fragment.
 * - `javascript:`, `file:`, `data:`, `about:` and any non-http(s) scheme are rejected as blocked.
 */
export function normalizeUrl(input: string): NormalizedUrl {
  const raw = input.trim()
  if (!raw) return { ok: false, reason: 'empty' }

  let candidate = raw
  if (!SCHEME_WITH_SLASHES.test(raw)) {
    const bare = BARE_SCHEME.exec(raw)
    if (bare) {
      const rest = raw.slice(bare[0].length)
      // `localhost:3000` — a hostname label followed by a numeric port — is dev-server input, not a
      // custom scheme. Anything else with a `scheme:` prefix (javascript:, file:, mailto:…) is left
      // intact so the scheme allow-list below can reject it honestly.
      if (/^\d+([/?#]|$)/.test(rest)) candidate = `http://${raw}`
    } else {
      candidate = `http://${raw}`
    }
  }

  let parsed: URL
  try {
    parsed = new URL(candidate)
  } catch {
    return { ok: false, reason: 'invalid' }
  }

  const scheme = parsed.protocol.toLowerCase()
  if (!ALLOWED_BROWSER_SCHEMES.includes(scheme as (typeof ALLOWED_BROWSER_SCHEMES)[number])) {
    return { ok: false, reason: 'blocked-scheme', scheme }
  }
  if (!parsed.hostname) return { ok: false, reason: 'invalid' }

  return { ok: true, url: parsed.href, secure: scheme === 'https:' }
}

/** True when a *normalized* URL string is a navigation the browser may perform. Used as a final
 * gate right before handing a URL to the native webview, and mirrored by the Rust guard. */
export function isNavigableUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return ALLOWED_BROWSER_SCHEMES.includes(parsed.protocol.toLowerCase() as (typeof ALLOWED_BROWSER_SCHEMES)[number])
  } catch {
    return false
  }
}

/** A user-facing copy of a URL with any embedded `user:password@` credentials removed, so the
 * address bar and any copied/attached context never leak secrets baked into the URL. */
export function displayUrl(url: string): string {
  try {
    const parsed = new URL(url)
    if (!parsed.username && !parsed.password) return parsed.href
    parsed.username = ''
    parsed.password = ''
    return parsed.href
  } catch {
    return url
  }
}

/** True when the URL has credentials embedded in it — surfaced so the UI can warn before copying or
 * attaching a URL that would otherwise leak them. */
export function hasEmbeddedCredentials(url: string): boolean {
  try {
    const parsed = new URL(url)
    return Boolean(parsed.username || parsed.password)
  } catch {
    return false
  }
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0'])

/** Loopback / localhost origins are the only ones the browser treats as trusted development targets
 * for element inspection. Inspection injects scripts, so it is deliberately not offered for arbitrary
 * remote origins where it could exfiltrate private page state. */
export function isTrustedInspectOrigin(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase()
    return LOOPBACK_HOSTS.has(host) || host.endsWith('.localhost')
  } catch {
    return false
  }
}

/** A short host[:port] label for compact chips (e.g. `localhost:5173`). */
export function hostLabel(url: string): string {
  try {
    return new URL(url).host || url
  } catch {
    return url
  }
}
