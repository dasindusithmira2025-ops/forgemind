import { useMemo } from 'react'
import type { OrganizationalAgent } from '../../native/types'

/**
 * Agent identity marks.
 *
 * A teammate needs a stable face, not a letter in a box — but a desktop rail renders dozens of
 * them at 22px while a conversation streams, so the mark has to be cheap. This draws a small
 * deterministic sigil from the Agent's persisted `avatarSeed`: two muted hues from one hash, a
 * restrained geometric figure, and the monogram kept as the legible core. No image decoding, no
 * network, no per-frame work, and nothing that reads as a glowing robot.
 *
 * An uploaded portrait replaces this by rendering an `<img>` in the same box; the seeded sigil is
 * the fallback, which is why it is a component rather than a CSS class.
 */

function hash(seed: string) {
  let value = 2166136261
  for (let index = 0; index < seed.length; index += 1) {
    value ^= seed.charCodeAt(index)
    value = Math.imul(value, 16777619)
  }
  return Math.abs(value)
}

function initials(agent: Pick<OrganizationalAgent, 'name'>) {
  return agent.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase()
}

export function AgentAvatar({ agent, size = 22 }: { agent: Pick<OrganizationalAgent, 'name' | 'avatarSeed'>; size?: number }) {
  const mark = useMemo(() => {
    const seed = hash(agent.avatarSeed || agent.name)
    // Muted, desaturated hues only. The surface is dark-first and an identity mark must never
    // out-shout the conversation next to it.
    const hue = seed % 360
    const shift = 26 + (seed >> 9) % 44
    return {
      base: `hsl(${hue} 24% 26%)`,
      accent: `hsl(${(hue + shift) % 360} 30% 44%)`,
      figure: seed % 3,
    }
  }, [agent.avatarSeed, agent.name])
  const label = initials(agent)
  return (
    <span className="agent-avatar" style={{ width: size, height: size, fontSize: Math.max(9, Math.round(size * 0.4)) }} aria-hidden>
      <svg viewBox="0 0 40 40" focusable="false">
        <rect width="40" height="40" rx="12" fill={mark.base} />
        {mark.figure === 0 && <circle cx="28" cy="12" r="13" fill={mark.accent} opacity="0.55" />}
        {mark.figure === 1 && <rect x="16" y="-4" width="30" height="30" rx="8" transform="rotate(18 28 12)" fill={mark.accent} opacity="0.5" />}
        {mark.figure === 2 && <path d="M40 0 L40 26 L10 0 Z" fill={mark.accent} opacity="0.5" />}
      </svg>
      <b>{label}</b>
    </span>
  )
}
