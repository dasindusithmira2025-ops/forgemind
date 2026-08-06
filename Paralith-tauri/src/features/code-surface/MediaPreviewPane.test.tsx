import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

const readProjectMedia = vi.fn<(projectId: string, path: string) => Promise<Uint8Array>>()

vi.mock('../../native/commands', () => ({
  native: { readProjectMedia: (projectId: string, path: string) => readProjectMedia(projectId, path) },
  asNativeError: (error: unknown) => {
    const value = error as { code?: string; message?: string }
    return { code: value.code ?? 'unknown_error', message: value.message ?? 'error' }
  },
}))

const { MediaPreviewPane } = await import('./MediaPreviewPane')

// jsdom implements neither object URLs nor Blob byte inspection, so both are stubbed and the test
// asserts on the lifecycle instead (created once per file version, revoked when superseded).
const created: string[] = []
const revoked: string[] = []

beforeEach(() => {
  readProjectMedia.mockReset().mockResolvedValue(new Uint8Array([1, 2, 3]))
  created.length = 0
  revoked.length = 0
  URL.createObjectURL = vi.fn(() => {
    const url = `blob:mock-${created.length}`
    created.push(url)
    return url
  })
  URL.revokeObjectURL = vi.fn((url: string) => void revoked.push(url))
})

describe('MediaPreviewPane', () => {
  it('renders an image from the guarded backend read', async () => {
    render(<MediaPreviewPane projectId="p1" path="assets/logo.png" mediaType="image/png" sha256="sha1" size={2048} />)

    const image = await screen.findByAltText('assets/logo.png')
    expect(image).toHaveAttribute('src', 'blob:mock-0')
    expect(readProjectMedia).toHaveBeenCalledWith('p1', 'assets/logo.png')
    expect(screen.getByText(/image\/png/)).toBeInTheDocument()
    expect(screen.getByText(/2\.0 KB/)).toBeInTheDocument()
  })

  it('renders a PDF in a frame and offers the external opener', async () => {
    const onOpenExternally = vi.fn()
    render(
      <MediaPreviewPane projectId="p1" path="docs/spec.pdf" mediaType="application/pdf" sha256="sha1" size={1024} onOpenExternally={onOpenExternally} />,
    )

    const frame = await screen.findByTitle('PDF preview of docs/spec.pdf')
    expect(frame).toHaveAttribute('src', 'blob:mock-0')
    fireEvent.click(screen.getByLabelText('Open in the default application'))
    expect(onOpenExternally).toHaveBeenCalled()
  })

  it('refetches and releases the previous object URL when the file changes on disk', async () => {
    const view = render(
      <MediaPreviewPane projectId="p1" path="assets/logo.png" mediaType="image/png" sha256="sha1" size={10} />,
    )
    await screen.findByAltText('assets/logo.png')

    view.rerender(<MediaPreviewPane projectId="p1" path="assets/logo.png" mediaType="image/png" sha256="sha2" size={12} />)

    await waitFor(() => expect(readProjectMedia).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(revoked).toContain('blob:mock-0'))
    expect(await screen.findByAltText('assets/logo.png')).toHaveAttribute('src', 'blob:mock-1')
  })

  it('revokes the object URL on unmount so bytes are not held after the tab closes', async () => {
    const view = render(
      <MediaPreviewPane projectId="p1" path="assets/logo.png" mediaType="image/png" sha256="sha1" size={10} />,
    )
    await screen.findByAltText('assets/logo.png')
    view.unmount()
    expect(revoked).toContain('blob:mock-0')
  })

  it('surfaces a failed read with a retry that reads again', async () => {
    readProjectMedia.mockRejectedValueOnce({ code: 'file_too_large', message: 'This file is too large to preview in the editor.' })
    render(<MediaPreviewPane projectId="p1" path="huge.pdf" mediaType="application/pdf" sha256="sha1" size={99} />)

    expect(await screen.findByText('This file is too large to preview in the editor.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /retry/i }))
    await waitFor(() => expect(readProjectMedia).toHaveBeenCalledTimes(2))
    expect(await screen.findByTitle('PDF preview of huge.pdf')).toBeInTheDocument()
  })

  it('zooms an image away from fit and back', async () => {
    render(<MediaPreviewPane projectId="p1" path="a.png" mediaType="image/png" sha256="sha1" size={10} />)
    await screen.findByAltText('a.png')

    expect(screen.getByText('Fit')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Zoom in'))
    expect(screen.getByText('150%')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Actual size'))
    expect(screen.getByText('100%')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Fit to pane'))
    expect(screen.getByText('Fit')).toBeInTheDocument()
  })
})
