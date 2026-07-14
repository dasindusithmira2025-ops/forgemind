import { create } from 'zustand'
import type { MonitorInfo, OpenProjectSession, Project, WorkspacePlacement } from '../native/types'

/**
 * Low-frequency UI cache for the multi-Project + multi-monitor session. The AUTHORITY for open
 * projects, placements, leases and monitors is the Rust `WindowRegistry`; this store only holds
 * cached summaries the sidebar renders. It never holds terminal output or raw runtime state —
 * see [[forgemind-domain-model-spec]] for the store-separation rules.
 */
interface SessionState {
  /** Open-Project session records (which Projects are open, active flag, last WS/Pane). */
  openProjects: OpenProjectSession[]
  /** Cached Project metadata keyed by id (name, branch, framework…). */
  projects: Record<string, Project>
  /** Cached Workspace placements keyed by projectId. */
  placementsByProject: Record<string, WorkspacePlacement[]>
  /** Cached monitor list for the Move-to-Monitor menu. */
  monitors: MonitorInfo[]
  setOpenProjects: (openProjects: OpenProjectSession[]) => void
  upsertProject: (project: Project) => void
  setPlacements: (projectId: string, placements: WorkspacePlacement[]) => void
  upsertPlacement: (projectId: string, placement: WorkspacePlacement) => void
  setMonitors: (monitors: MonitorInfo[]) => void
  reset: () => void
}

export const useSessionStore = create<SessionState>((set) => ({
  openProjects: [],
  projects: {},
  placementsByProject: {},
  monitors: [],
  setOpenProjects: (openProjects) => set({ openProjects }),
  upsertProject: (project) => set((state) => ({ projects: { ...state.projects, [project.id]: project } })),
  setPlacements: (projectId, placements) =>
    set((state) => ({ placementsByProject: { ...state.placementsByProject, [projectId]: placements } })),
  upsertPlacement: (projectId, placement) =>
    set((state) => {
      const current = state.placementsByProject[projectId] ?? []
      const next = current.some((item) => item.workspaceId === placement.workspaceId)
        ? current.map((item) => (item.workspaceId === placement.workspaceId ? placement : item))
        : [...current, placement]
      return { placementsByProject: { ...state.placementsByProject, [projectId]: next } }
    }),
  setMonitors: (monitors) => set({ monitors }),
  reset: () => set({ openProjects: [], projects: {}, placementsByProject: {}, monitors: [] }),
}))
