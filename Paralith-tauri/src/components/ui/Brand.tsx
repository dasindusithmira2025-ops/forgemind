import icon from '../../assets/brand/paralith-icon-dark.png'
import monochrome from '../../assets/brand/paralith-monochrome-dark.png'
import primaryLogo from '../../assets/brand/paralith-primary-dark.png'
import wordmark from '../../assets/brand/paralith-wordmark-dark.png'

export function Brand({
  compact = false,
  primary = false,
  mono = false,
}: {
  compact?: boolean
  primary?: boolean
  mono?: boolean
}) {
  const source = compact ? icon : mono ? monochrome : primary ? primaryLogo : wordmark
  const variant = compact ? 'compact' : mono ? 'monochrome' : primary ? 'primary' : 'wordmark'

  return (
    <div className={`brand brand--${variant}`} aria-label="PARALITH">
      <img className="brand-logo" src={source} alt="" draggable={false} />
      <span className="sr-only">PARALITH</span>
    </div>
  )
}
