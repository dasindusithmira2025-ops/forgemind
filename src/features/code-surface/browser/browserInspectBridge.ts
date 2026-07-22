import type { RawInspectedElement } from './inspectContext'

/**
 * Decode the opaque base64url payload delivered by the native Inspect bridge back into a raw element
 * record. The payload originates in an untrusted page, so this only performs a structural decode —
 * `sanitizeInspectedElement` is always applied afterwards before the data is shown or forwarded.
 */
export function decodeInspectPayload(payload: string): RawInspectedElement | undefined {
  if (!payload) return undefined
  try {
    const b64 = payload.replace(/-/g, '+').replace(/_/g, '/')
    const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4))
    const binary = atob(b64 + pad)
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
    const json = new TextDecoder().decode(bytes)
    const parsed = JSON.parse(json) as unknown
    if (!parsed || typeof parsed !== 'object') return undefined
    const candidate = parsed as Record<string, unknown>
    if (typeof candidate.tag !== 'string') return undefined
    return candidate as unknown as RawInspectedElement
  } catch {
    return undefined
  }
}

/** Encode a raw element the same way the injected script does — used only by tests to round-trip. */
export function encodeInspectPayload(element: RawInspectedElement): string {
  const json = JSON.stringify(element)
  const bytes = new TextEncoder().encode(json)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
