import { describe, expect, it } from 'vitest'
import {
  displayUrl,
  hasEmbeddedCredentials,
  hostLabel,
  isNavigableUrl,
  isTrustedInspectOrigin,
  normalizeUrl,
} from './browserUrl'

describe('normalizeUrl', () => {
  it('rejects empty input', () => {
    expect(normalizeUrl('   ')).toEqual({ ok: false, reason: 'empty' })
  })

  it('promotes bare localhost:port to http and preserves path + query', () => {
    expect(normalizeUrl('localhost:3000')).toEqual({ ok: true, url: 'http://localhost:3000/', secure: false })
    expect(normalizeUrl('127.0.0.1:8080/api?x=1&y=2')).toEqual({
      ok: true,
      url: 'http://127.0.0.1:8080/api?x=1&y=2',
      secure: false,
    })
  })

  it('promotes a bare host without a scheme to http', () => {
    expect(normalizeUrl('example.com/docs')).toEqual({ ok: true, url: 'http://example.com/docs', secure: false })
  })

  it('preserves an explicit https URL including query and fragment', () => {
    const result = normalizeUrl('https://example.com/a/b?q=1#frag')
    expect(result).toEqual({ ok: true, url: 'https://example.com/a/b?q=1#frag', secure: true })
  })

  it('blocks dangerous and privileged schemes', () => {
    for (const bad of ['javascript:alert(1)', 'file:///etc/passwd', 'data:text/html,<h1>x', 'about:blank', 'tauri://localhost', 'ipc://x']) {
      const result = normalizeUrl(bad)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.reason).toBe('blocked-scheme')
    }
  })

  it('rejects structurally invalid input', () => {
    expect(normalizeUrl('http://').ok).toBe(false)
  })
})

describe('isNavigableUrl', () => {
  it('accepts http(s) and rejects everything else', () => {
    expect(isNavigableUrl('http://localhost:3000/')).toBe(true)
    expect(isNavigableUrl('https://a.test/')).toBe(true)
    expect(isNavigableUrl('file:///c:/secret')).toBe(false)
    expect(isNavigableUrl('not a url')).toBe(false)
  })
})

describe('displayUrl / credentials', () => {
  it('strips embedded credentials for display', () => {
    expect(displayUrl('http://user:pass@localhost:3000/x')).toBe('http://localhost:3000/x')
    expect(hasEmbeddedCredentials('http://user:pass@localhost:3000/x')).toBe(true)
    expect(hasEmbeddedCredentials('http://localhost:3000/x')).toBe(false)
  })
})

describe('isTrustedInspectOrigin', () => {
  it('trusts loopback and *.localhost only', () => {
    expect(isTrustedInspectOrigin('http://localhost:3000')).toBe(true)
    expect(isTrustedInspectOrigin('http://127.0.0.1:8080')).toBe(true)
    expect(isTrustedInspectOrigin('http://app.localhost:5173')).toBe(true)
    expect(isTrustedInspectOrigin('https://example.com')).toBe(false)
  })
})

describe('hostLabel', () => {
  it('returns host:port', () => {
    expect(hostLabel('http://localhost:5173/x')).toBe('localhost:5173')
  })
})
