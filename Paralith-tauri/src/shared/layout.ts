import type { AgentProvider, LayoutNode, Workspace } from '../native/types'

type ShellChoice = {
  provider: AgentProvider
  shellProfileId?: string
}

export function paneIds(layout: LayoutNode): string[] {
  return layout.type === 'pane' ? [layout.paneId] : layout.children.flatMap(paneIds)
}

export function updateSplitSizes(layout: LayoutNode, path: string, sizesById: Record<string, number>): LayoutNode {
  if (layout.type === 'pane') return layout
  const id = layout.children.map((child) => paneIds(child).join(':')).join('|')
  const children = layout.children.map((child) => updateSplitSizes(child, `${path}/${id}`, sizesById))
  const sizes = layout.children.map((child, index) => sizesById[paneIds(child)[0]] ?? layout.sizes[index] ?? 100 / layout.children.length)
  return { ...layout, sizes, children }
}

export function providerLabel(provider: string): string {
  return {
    claude: 'Claude Code', codex: 'Codex CLI', opencode: 'OpenCode', powershell: 'PowerShell',
    command_prompt: 'Command Prompt', wsl: 'WSL', custom_shell: 'Custom shell',
  }[provider] ?? provider
}

export function preferredShell<T extends ShellChoice>(choices: T[], defaultShellId?: string): T | undefined {
  const shells = choices.filter((choice) => !['claude', 'codex', 'opencode'].includes(choice.provider))
  return shells.find((choice) => choice.shellProfileId === defaultShellId) ?? shells[0]
}

export function relativeTime(iso: string): string {
  const delta = Math.max(0, Date.now() - new Date(iso).getTime())
  const minutes = Math.floor(delta / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

export function newId(): string {
  return crypto.randomUUID()
}

/** One-line description of a saved Workspace: "4 terminals · Claude · Codex · Shell". */
export function workspaceSummary(workspace: Workspace): string {
  const count = workspace.panes.length
  const providers = workspace.panes.map((pane) =>
    ['claude', 'codex', 'opencode'].includes(pane.provider) ? providerLabel(pane.provider) : 'Shell',
  )
  const seen: string[] = []
  for (const label of providers) if (!seen.includes(label)) seen.push(label)
  const terminals = `${count} terminal${count === 1 ? '' : 's'}`
  return seen.length > 0 ? `${terminals} · ${seen.join(' · ')}` : terminals
}
