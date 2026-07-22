import { describe, expect, it } from 'vitest'
import { decodeInspectPayload, encodeInspectPayload } from './browserInspectBridge'

describe('inspect payload bridge', () => {
  it('round-trips an element through base64url', () => {
    const element = { tag: 'BUTTON', id: 'save', text: 'Save — ✓ Ünïcode', classNames: ['a', 'b'] }
    const decoded = decodeInspectPayload(encodeInspectPayload(element))
    expect(decoded).toEqual(element)
  })

  it('returns undefined for corrupt or empty payloads', () => {
    expect(decodeInspectPayload('')).toBeUndefined()
    expect(decodeInspectPayload('!!!not-base64!!!')).toBeUndefined()
    expect(decodeInspectPayload(encodeInspectPayload({ notTag: 1 } as never))).toBeUndefined()
  })
})
