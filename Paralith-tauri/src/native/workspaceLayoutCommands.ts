import { invoke } from '@tauri-apps/api/core'
import type { DockedLayoutNode, WorkspaceCanvasLayout } from '../features/workspace-canvas/canvasTypes'

/**
 * Narrow, typed persistence surface for the docking canvas. The docked tree is sent as a
 * strongly-typed {@link DockedLayoutNode} so the Rust side keeps `layout_json` valid for legacy
 * readers and restoration; the floating layer + metadata travel as an opaque JSON blob that the
 * backend stores verbatim. Optimistic concurrency is enforced through `expectedRevision`.
 */
export interface SaveWorkspaceCanvasLayoutRequest {
  workspaceId: string
  expectedRevision: number
  dockedRoot: DockedLayoutNode | null
  canvasJson: string
  activePaneId?: string
}

export interface SaveWorkspaceCanvasLayoutResult {
  workspaceId: string
  revision: number
  updatedAt: string
}

export interface WorkspaceCanvasLayoutRecord {
  revision: number
  /** Serialized {@link WorkspaceCanvasLayout}, or null for a workspace saved before the canvas. */
  canvasJson: string | null
}

export const workspaceLayoutCommands = {
  saveCanvasLayout: (request: SaveWorkspaceCanvasLayoutRequest) =>
    invoke<SaveWorkspaceCanvasLayoutResult>('save_workspace_canvas_layout', { request }),
  getCanvasLayout: (workspaceId: string) =>
    invoke<WorkspaceCanvasLayoutRecord>('get_workspace_canvas_layout', { workspaceId }),
}

/** Serialize an in-memory layout into the payload accepted by {@link saveCanvasLayout}. */
export function toSaveRequest(
  workspaceId: string,
  expectedRevision: number,
  layout: WorkspaceCanvasLayout,
): SaveWorkspaceCanvasLayoutRequest {
  return {
    workspaceId,
    expectedRevision,
    dockedRoot: layout.dockedRoot,
    canvasJson: JSON.stringify(layout),
    activePaneId: layout.activePaneId,
  }
}
