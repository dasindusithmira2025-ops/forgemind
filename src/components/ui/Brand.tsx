import { TerminalSquare } from 'lucide-react'

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className="brand" aria-label="ForgeMind">
      <span className="brand-mark"><TerminalSquare size={17} strokeWidth={1.7} /></span>
      {!compact && <span>ForgeMind</span>}
    </div>
  )
}
