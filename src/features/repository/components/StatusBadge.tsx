import type { ReactNode } from 'react'

export type BadgeTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'pending'

/**
 * A compact status pill. Tone maps to the shared semantic tokens; it never relies on colour
 * alone — every badge carries a text label (and an optional icon), so status is legible to
 * screen readers and in high-contrast modes.
 */
export function StatusBadge({ tone = 'neutral', icon, children, title }: {
  tone?: BadgeTone
  icon?: ReactNode
  children: ReactNode
  title?: string
}) {
  return (
    <span className={`repo-badge repo-badge-${tone}`} title={title}>
      {icon}
      <span>{children}</span>
    </span>
  )
}
