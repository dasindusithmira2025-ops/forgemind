/**
 * Pure presentation rules for the Context Fabric surfaces.
 *
 * These live apart from the components so the decisions that actually carry meaning — what
 * "verified" looks like, when a memory reads as stale, how evidence is labelled — are testable
 * without rendering anything.
 */
import type { ClaimStatus, MemoryQuality, MemorySource } from './memoryTypes'

/**
 * Quality maps onto the existing `--proof-*` family rather than a new palette: this is the same
 * question the Proof Ledger answers ("how much do we trust this?"), so it must not acquire a
 * second visual language.
 */
export type QualityTone = 'verified' | 'partial' | 'missing' | 'failed'

const QUALITY_TONES: Record<MemoryQuality, QualityTone> = {
  working: 'missing',
  observed: 'missing',
  supported: 'partial',
  verified: 'verified',
  canonical: 'verified',
  deprecated: 'failed',
  superseded: 'failed',
}

const QUALITY_LABELS: Record<MemoryQuality, string> = {
  working: 'Working',
  observed: 'Observed',
  supported: 'Supported',
  verified: 'Verified',
  canonical: 'Canonical',
  deprecated: 'Deprecated',
  superseded: 'Superseded',
}

/**
 * One sentence explaining what a quality level asserts. Shown as the tooltip on the badge, so the
 * ladder is discoverable without documentation.
 */
const QUALITY_HINTS: Record<MemoryQuality, string> = {
  working: 'Captured but not reviewed.',
  observed: 'Seen directly in a source, not yet corroborated.',
  supported: 'Backed by at least one piece of evidence.',
  verified: 'Confirmed against evidence.',
  canonical: 'The project’s authoritative answer on this subject.',
  deprecated: 'True historically, but no longer how the project works.',
  superseded: 'Replaced by another memory.',
}

export function qualityTone(quality: MemoryQuality): QualityTone {
  return QUALITY_TONES[quality] ?? 'missing'
}

export function qualityLabel(quality: MemoryQuality): string {
  return QUALITY_LABELS[quality] ?? quality
}

export function qualityHint(quality: MemoryQuality): string {
  return QUALITY_HINTS[quality] ?? ''
}

const CLAIM_TONES: Record<ClaimStatus, QualityTone> = {
  open: 'missing',
  supported: 'partial',
  verified: 'verified',
  contradicted: 'failed',
  superseded: 'failed',
  retracted: 'failed',
}

export function claimTone(status: ClaimStatus): QualityTone {
  return CLAIM_TONES[status] ?? 'missing'
}

export function claimLabel(status: ClaimStatus): string {
  return status.charAt(0).toUpperCase() + status.slice(1)
}

/**
 * A short, readable label for one piece of evidence.
 *
 * File sources are shown as `path:line`, which is the form the rest of Paralith uses and which a
 * developer can act on. Everything else falls back to its URI with the scheme stripped, so a
 * commit or a command reads as itself rather than as a URL.
 */
export function sourceLabel(source: MemorySource): string {
  if (source.filePath) {
    if (source.lineStart && source.lineEnd && source.lineEnd !== source.lineStart) {
      return `${source.filePath}:${source.lineStart}-${source.lineEnd}`
    }
    if (source.lineStart) return `${source.filePath}:${source.lineStart}`
    return source.filePath
  }
  const withoutScheme = source.uri.replace(/^[a-z]+:(\/\/)?/i, '')
  return withoutScheme || source.uri
}

/**
 * Relative age, for list rows where an absolute timestamp would be noise. Falls back to the raw
 * value rather than rendering "Invalid Date" if the backend ever hands over something unparseable.
 */
export function relativeAge(iso: string, now: number = Date.now()): string {
  const parsed = Date.parse(iso)
  if (Number.isNaN(parsed)) return iso
  const seconds = Math.max(0, Math.round((now - parsed) / 1000))
  if (seconds < 60) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days < 30) return `${days}d ago`
  const months = Math.round(days / 30)
  if (months < 12) return `${months}mo ago`
  return `${Math.round(months / 12)}y ago`
}

/**
 * The single most important thing to say about a memory's health, or null when there is nothing
 * to warn about. Ordered by severity so one line can stand in for the whole inspector.
 */
export function healthWarning(input: {
  staleReason: string | null
  claims: { status: ClaimStatus }[]
  sourceCount: number
  quality: MemoryQuality
}): string | null {
  if (input.staleReason) return input.staleReason
  const contradicted = input.claims.filter((claim) => claim.status === 'contradicted').length
  if (contradicted > 0) {
    return `${contradicted} contradicted claim${contradicted === 1 ? '' : 's'}`
  }
  // A memory promoted to a trusted level with nothing behind it is the failure mode this whole
  // subsystem exists to prevent, so it is called out explicitly rather than shown as a clean badge.
  if ((input.quality === 'verified' || input.quality === 'canonical') && input.sourceCount === 0) {
    return 'Marked trusted with no evidence attached'
  }
  return null
}
