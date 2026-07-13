import type { AgentDetectionResult, AgentProvider, PaneAssignment, ShellProfile } from '../../native/types'
import { providerLabel } from '../../shared/layout'
import type { AgentDefinition, TerminalLaunchDefinition, WorkspaceLaunchPlan } from './setupTypes'

const CODING_PROVIDERS: AgentProvider[] = ['claude', 'codex', 'opencode']
export const SHELL_ID_PREFIX = 'shell:'

export function isCodingProvider(provider: AgentProvider): boolean {
  return CODING_PROVIDERS.includes(provider)
}

function shellProvider(shell: ShellProfile): AgentProvider {
  if (shell.name.startsWith('PowerShell') || shell.name === 'Windows PowerShell') return 'powershell'
  if (shell.name === 'Command Prompt') return 'command_prompt'
  if (shell.name.startsWith('WSL')) return 'wsl'
  return 'custom_shell'
}

/**
 * Build the canonical, ordered agent registry from async discovery results. Coding agents come
 * first (in a fixed order), then detected/custom shells. Availability is never hardcoded — an
 * uninstalled agent still appears, disabled, so the UI can prompt the user to configure it.
 */
export function buildRegistry(
  detections: AgentDetectionResult[],
  shells: ShellProfile[],
): AgentDefinition[] {
  const byProvider = new Map(detections.map((result) => [result.provider, result]))
  const codingAgents: AgentDefinition[] = CODING_PROVIDERS.map((provider) => {
    const detection = byProvider.get(provider)
    const installed = Boolean(detection?.available && detection?.executablePath)
    return {
      id: provider,
      name: providerLabel(provider),
      subtitle: provider === 'claude' ? 'Anthropic' : provider === 'codex' ? 'OpenAI' : 'OpenCode',
      category: 'coding-agent',
      provider,
      command: detection?.executablePath ?? '',
      args: [],
      installed,
      version: detection?.version,
      status: !detection ? 'checking' : installed ? 'ready' : detection.errorCode ? 'missing' : 'error',
      supportsMultipleInstances: true,
    }
  })
  const shellAgents: AgentDefinition[] = shells.map((shell) => ({
    id: `${SHELL_ID_PREFIX}${shell.id}`,
    name: shell.name,
    subtitle: 'Shell',
    category: 'shell',
    provider: shellProvider(shell),
    command: shell.executablePath,
    args: shell.args,
    shellProfileId: shell.id,
    installed: shell.available,
    status: shell.available ? 'ready' : 'missing',
    supportsMultipleInstances: true,
  }))
  return [...codingAgents, ...shellAgents]
}

export function registryOrder(registry: AgentDefinition[]): string[] {
  return registry.map((agent) => agent.id)
}

export function isShellId(registry: AgentDefinition[], id: string): boolean {
  return registry.find((agent) => agent.id === id)?.category === 'shell'
}

export function findAgent(registry: AgentDefinition[], id: string): AgentDefinition | undefined {
  return registry.find((agent) => agent.id === id)
}

export function readyAgents(registry: AgentDefinition[]): AgentDefinition[] {
  return registry.filter((agent) => agent.installed)
}

/**
 * Choose the default shell id (used to fill unassigned panes). Prefers the user's configured shell
 * profile, then the first ready shell, then any shell, so a plan can always fall back safely.
 */
export function pickDefaultShellId(registry: AgentDefinition[], preferredShellProfileId?: string): string {
  const shells = registry.filter((agent) => agent.category === 'shell')
  const configured = preferredShellProfileId
    ? shells.find((agent) => agent.shellProfileId === preferredShellProfileId)
    : undefined
  const chosen = configured ?? shells.find((agent) => agent.installed) ?? shells[0]
  return chosen?.id ?? ''
}

/** Shell-appropriate arguments to run a custom command inside the default shell. */
export function customCommandArgs(provider: AgentProvider, command: string): string[] {
  switch (provider) {
    case 'powershell':
      return ['-NoExit', '-Command', command]
    case 'command_prompt':
      return ['/K', command]
    default:
      return ['-c', command]
  }
}

/**
 * Runtime adapter: map a compiled launch plan onto concrete layout pane ids, resolving each
 * session against the registry to produce the PaneAssignment[] the existing persistence and
 * terminal-session runtime already understand. Pure and deterministic.
 */
export function planToPanes(
  plan: WorkspaceLaunchPlan,
  paneIds: string[],
  registry: AgentDefinition[],
  customLabels: Map<string, { label: string; command: string }>,
): PaneAssignment[] {
  return plan.sessions.map((session, index) => {
    const paneId = paneIds[index] ?? paneIds[paneIds.length - 1]
    return resolveSession(session, paneId, index, registry, customLabels)
  })
}

function resolveSession(
  session: TerminalLaunchDefinition,
  paneId: string,
  positionOrder: number,
  registry: AgentDefinition[],
  customLabels: Map<string, { label: string; command: string }>,
): PaneAssignment {
  const defaultShell = registry.find((agent) => agent.id === session.shellId)
  if (session.type === 'custom') {
    const custom = customLabels.get(session.agentId ?? '') ?? { label: 'Custom command', command: session.command ?? '' }
    const provider = defaultShell?.provider ?? 'custom_shell'
    return {
      id: paneId,
      title: custom.label,
      provider,
      executablePath: defaultShell?.command ?? '',
      args: customCommandArgs(provider, custom.command),
      shellProfileId: defaultShell?.shellProfileId,
      workingDirectory: session.workingDirectory,
      workingDirectoryMode: 'project_relative',
      positionOrder,
    }
  }
  const agent = registry.find((item) => item.id === session.agentId)
  const resolved = agent ?? defaultShell
  return {
    id: paneId,
    title: resolved?.name ?? 'Terminal',
    provider: resolved?.provider ?? 'custom_shell',
    executablePath: resolved?.command ?? '',
    args: resolved?.args ?? [],
    shellProfileId: resolved?.shellProfileId,
    workingDirectory: session.workingDirectory,
    workingDirectoryMode: 'project_relative',
    positionOrder,
  }
}
