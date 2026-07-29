import type { MonitorInfo, OpenProjectSession, WorkspacePlacement } from '../../native/types'

/** The single active Project in the main session, or undefined if none is active. */
export function activeProjectId(openProjects: OpenProjectSession[]): string | undefined {
  return openProjects.find((session) => session.isActive)?.projectId
}

/** Split a Project's Workspace placements into the two sidebar sections. */
export function partitionPlacements(placements: WorkspacePlacement[]): {
  attached: WorkspacePlacement[]
  detached: WorkspacePlacement[]
} {
  const attached: WorkspacePlacement[] = []
  const detached: WorkspacePlacement[] = []
  for (const placement of placements) {
    if (placement.mode === 'detached') detached.push(placement)
    else attached.push(placement)
  }
  return { attached, detached }
}

export function placementForWorkspace(
  placements: WorkspacePlacement[],
  workspaceId: string,
): WorkspacePlacement | undefined {
  return placements.find((placement) => placement.workspaceId === workspaceId)
}

/** Friendly monitor label: user alias when set, else the OS name, else a positional fallback. */
export function monitorLabel(monitor: MonitorInfo): string {
  return monitor.alias || monitor.name || `Display ${monitor.id}`
}

/** The monitor a detached Workspace is currently on, for the "Other Monitors" row subtitle. */
export function monitorForPlacement(
  placement: WorkspacePlacement,
  monitors: MonitorInfo[],
): MonitorInfo | undefined {
  if (!placement.monitorId) return undefined
  return monitors.find((monitor) => monitor.id === placement.monitorId)
}
