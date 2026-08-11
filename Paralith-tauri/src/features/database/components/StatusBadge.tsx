import type { ReactNode } from 'react'

export type BadgeTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'pending'

/**
 * A compact status pill for Database Studio. Duplicated from `repository/components/StatusBadge`
 * rather than imported, matching the deliberate "no cross-feature reach-in" boundary UI-SPEC.md
 * §1 item 8 documents.
 */
export function StatusBadge({ tone = 'neutral', icon, children, title }: {
  tone?: BadgeTone
  icon?: ReactNode
  children: ReactNode
  title?: string
}) {
  return (
    <span className={`db-badge db-badge-${tone}`} title={title}>
      {icon}
      <span>{children}</span>
    </span>
  )
}
