import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ExternalLink, Maximize2, Minus, Plus, RotateCcw } from 'lucide-react'
import { asNativeError, native } from '../../native/commands'
import { ErrorNotice } from '../../components/ui/ErrorNotice'
import { formatBytes, isPreviewableImage, isPreviewablePdf, toMediaBytes } from './media'

interface MediaPreviewPaneProps {
  projectId: string
  path: string
  /** MIME type reported by the backend, derived from the file extension. */
  mediaType: string
  /** Hash of the bytes currently on disk. Changing it reloads the preview after an edit on disk. */
  sha256: string
  size: number
  /** Opens the file in the operating system's default application, when the host offers it. */
  onOpenExternally?: () => void
}

/** Zoom steps for image previews, in multiples of the image's natural size. */
const ZOOM_STEPS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8]

/**
 * Renders an image or PDF that the text editor cannot show. The bytes are fetched through the
 * same project-scoped, path-guarded backend as every other file read and handed to the webview as
 * an object URL, so nothing outside the Project is ever reachable and no file path is exposed to
 * the page. The object URL is revoked whenever the file, its content, or the pane changes.
 */
export function MediaPreviewPane({ projectId, path, mediaType, sha256, size, onOpenExternally }: MediaPreviewPaneProps) {
  const [url, setUrl] = useState<string>()
  const [error, setError] = useState<{ message: string } | undefined>()
  const [loading, setLoading] = useState(true)
  const [zoom, setZoom] = useState<number | 'fit'>('fit')
  const [natural, setNatural] = useState<{ width: number; height: number }>()
  const [attempt, setAttempt] = useState(0)
  const [frameFailed, setFrameFailed] = useState(false)
  const objectUrlRef = useRef<string | undefined>(undefined)

  const isImage = isPreviewableImage(mediaType)
  const isPdf = isPreviewablePdf(mediaType)

  const releaseUrl = useCallback(() => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current)
      objectUrlRef.current = undefined
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(undefined)
    setNatural(undefined)
    setFrameFailed(false)
    void (async () => {
      try {
        const data = await native.readProjectMedia(projectId, path)
        if (cancelled) return
        const blob = new Blob([toMediaBytes(data)], { type: mediaType })
        const next = URL.createObjectURL(blob)
        releaseUrl()
        objectUrlRef.current = next
        setUrl(next)
      } catch (caught) {
        if (cancelled) return
        releaseUrl()
        setUrl(undefined)
        setError({ message: asNativeError(caught).message })
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
    // `sha256` is part of the identity of what is being shown: when the file changes on disk the
    // preview must refetch rather than keep displaying the previous bytes.
  }, [projectId, path, mediaType, sha256, attempt, releaseUrl])

  // Revoke on unmount only; the effect above hands ownership of each new URL to the ref.
  useEffect(() => releaseUrl, [releaseUrl])

  const zoomIndex = useMemo(
    () => (zoom === 'fit' ? -1 : ZOOM_STEPS.findIndex((step) => step >= zoom)),
    [zoom],
  )

  const stepZoom = useCallback(
    (direction: 1 | -1) => {
      setZoom((current) => {
        if (current === 'fit') return direction === 1 ? 1.5 : 0.75
        const index = ZOOM_STEPS.findIndex((step) => step >= current)
        const next = index < 0 ? ZOOM_STEPS.length - 1 : index + direction
        return ZOOM_STEPS[Math.min(Math.max(next, 0), ZOOM_STEPS.length - 1)]
      })
    },
    [],
  )

  const retry = useCallback(() => setAttempt((value) => value + 1), [])

  if (error) {
    return (
      <div className="code-editor-message">
        <ErrorNotice message={error.message} onRetry={retry} />
      </div>
    )
  }

  return (
    <div className="code-media" data-media={isImage ? 'image' : isPdf ? 'pdf' : 'other'}>
      <div className="code-media-toolbar">
        <span className="code-media-meta">
          {mediaType}
          <span className="code-media-dot">·</span>
          {formatBytes(size)}
          {natural && (
            <>
              <span className="code-media-dot">·</span>
              {natural.width} × {natural.height}
            </>
          )}
        </span>
        <span className="code-media-spacer" />
        {isImage && (
          <>
            <button title="Zoom out" aria-label="Zoom out" onClick={() => stepZoom(-1)} disabled={zoomIndex === 0}>
              <Minus size={14} />
            </button>
            <span className="code-media-zoom">{zoom === 'fit' ? 'Fit' : `${Math.round(zoom * 100)}%`}</span>
            <button
              title="Zoom in"
              aria-label="Zoom in"
              onClick={() => stepZoom(1)}
              disabled={zoomIndex === ZOOM_STEPS.length - 1}
            >
              <Plus size={14} />
            </button>
            <button title="Fit to pane" aria-label="Fit to pane" onClick={() => setZoom('fit')}>
              <Maximize2 size={14} />
            </button>
            <button title="Actual size" aria-label="Actual size" onClick={() => setZoom(1)}>
              <RotateCcw size={14} />
            </button>
          </>
        )}
        {onOpenExternally && (
          <button title="Open in the default application" aria-label="Open in the default application" onClick={onOpenExternally}>
            <ExternalLink size={14} />
          </button>
        )}
      </div>

      <div className="code-media-body">
        {loading && <div className="code-editor-loading" aria-label="Loading preview" />}
        {!loading && url && isImage && (
          <div className={`code-media-canvas ${zoom === 'fit' ? 'is-fit' : ''}`}>
            <img
              src={url}
              alt={path}
              style={zoom === 'fit' || !natural ? undefined : { width: natural.width * zoom, height: natural.height * zoom }}
              onLoad={(event) => {
                const image = event.currentTarget
                setNatural({ width: image.naturalWidth, height: image.naturalHeight })
              }}
              onError={() => setError({ message: 'This image could not be decoded for display.' })}
            />
          </div>
        )}
        {!loading && url && isPdf && (
          <>
            <iframe className="code-media-pdf" src={url} title={`PDF preview of ${path}`} onError={() => setFrameFailed(true)} />
            {frameFailed && (
              <div className="code-media-fallback">
                <p>This PDF could not be displayed inside PARALITH.</p>
                {onOpenExternally && <button onClick={onOpenExternally}>Open in the default application</button>}
              </div>
            )}
          </>
        )}
        {!loading && url && !isImage && !isPdf && (
          <div className="code-media-fallback">
            <p>This file type has no preview.</p>
          </div>
        )}
      </div>
    </div>
  )
}

export default MediaPreviewPane
