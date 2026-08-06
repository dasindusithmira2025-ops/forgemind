import { describe, expect, it } from 'vitest'
import { formatBytes, isPreviewableImage, isPreviewablePdf, toMediaBytes } from './media'

describe('media helpers', () => {
  it('classifies the MIME types the backend reports', () => {
    expect(isPreviewableImage('image/png')).toBe(true)
    expect(isPreviewableImage('image/svg+xml')).toBe(true)
    expect(isPreviewableImage('application/pdf')).toBe(false)
    expect(isPreviewablePdf('application/pdf')).toBe(true)
    expect(isPreviewablePdf('image/png')).toBe(false)
  })

  it('normalizes every binary shape the IPC layer can return', () => {
    const expected = new Uint8Array([1, 2, 3])
    expect(toMediaBytes(expected)).toEqual(expected)
    expect(toMediaBytes([1, 2, 3])).toEqual(expected)
    expect(toMediaBytes(new Uint8Array([1, 2, 3]).buffer)).toEqual(expected)
  })

  it('formats sizes for the preview toolbar', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(2048)).toBe('2.0 KB')
    expect(formatBytes(20 * 1024)).toBe('20 KB')
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.0 MB')
  })
})
