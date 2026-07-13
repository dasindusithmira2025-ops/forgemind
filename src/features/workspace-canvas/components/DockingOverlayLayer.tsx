import type { DockDropTarget, MagneticGuide, PixelRect } from '../canvasTypes'

interface DockingOverlayLayerProps {
  dropTarget?: DockDropTarget
  sourceRect?: PixelRect
  guides: MagneticGuide[]
  dragging: boolean
}

/**
 * The visual feedback drawn above the pane windows during a drag: the destination snap / dock
 * rectangle, magnetic alignment guides, and the subtle placeholder left at the pane's origin.
 * Purely presentational — it reads resolved geometry and paints, holding no interaction state.
 */
export function DockingOverlayLayer({ dropTarget, sourceRect, guides, dragging }: DockingOverlayLayerProps) {
  if (!dragging) return null

  const destination = dropTarget && dropTarget.kind !== 'float' && dropTarget.kind !== 'return-home' ? dropTarget.rect : undefined
  const isSwap = dropTarget?.kind === 'pane-dock' && dropTarget.zone === 'center'

  return (
    <div className="docking-overlay-layer" aria-hidden>
      {sourceRect && (
        <div className="pane-source-placeholder" style={rectStyle(sourceRect)} />
      )}
      {destination && (
        <div className={`snap-preview ${isSwap ? 'swap' : ''}`} style={rectStyle(destination)}>
          {isSwap && <span className="snap-preview-label">Swap</span>}
        </div>
      )}
      {guides.map((guide, index) =>
        guide.orientation === 'vertical' ? (
          <div key={`v-${index}`} className="magnetic-guide vertical" style={{ left: guide.position }} />
        ) : (
          <div key={`h-${index}`} className="magnetic-guide horizontal" style={{ top: guide.position }} />
        ),
      )}
    </div>
  )
}

function rectStyle(rect: PixelRect): React.CSSProperties {
  return { position: 'absolute', left: rect.x, top: rect.y, width: rect.width, height: rect.height }
}
