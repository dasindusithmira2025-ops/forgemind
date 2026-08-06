/** Pure helpers shared by the media preview and its host. Kept out of the lazily-loaded preview
 * module so the surface can label a preview tab without pulling the preview chunk in. */

export function isPreviewableImage(mediaType: string): boolean {
  return mediaType.startsWith('image/')
}

export function isPreviewablePdf(mediaType: string): boolean {
  return mediaType === 'application/pdf'
}

/** Normalize whichever binary shape the IPC layer produced into bytes the Blob constructor takes.
 * Tauri returns an ArrayBuffer over the custom-protocol IPC and a plain number array over the
 * postMessage fallback. */
export function toMediaBytes(data: ArrayBuffer | Uint8Array | number[]): Uint8Array<ArrayBuffer> {
  // Always constructed over a plain ArrayBuffer so the result is a valid BlobPart.
  if (data instanceof Uint8Array) return new Uint8Array(data)
  if (Array.isArray(data)) return new Uint8Array(data)
  return new Uint8Array(data)
}

export function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`
  const units = ['KB', 'MB', 'GB']
  let value = size / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`
}
