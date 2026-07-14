import { asNativeError, native } from '../../native/commands'
import type { WorkspacePlacement } from '../../native/types'
import { resolveWindowAction, type WorkspaceWindowIntent } from './windowIntent'

/**
 * Drives Workspace window movement (detach / attach / focus / move / close) against the Rust
 * handoff coordinator. The backend keeps PTYs alive and performs the atomic placement change
 * + lease transfer; this controller's job is the CLIENT-side safety: one in-flight operation
 * per Workspace (defeats double-clicks and duplicate handoffs) and clear error surfacing.
 *
 * It never stops or restarts terminals — moving a Workspace preserves its Terminal Sessions.
 */
class HandoffController {
  private inFlight = new Set<string>()

  isInFlight(workspaceId: string): boolean {
    return this.inFlight.has(workspaceId)
  }

  /**
   * Run the native action for an intent, guarded against concurrent handoffs of the same
   * Workspace. Returns the updated placement (or the unchanged one for focus/close/no-op).
   */
  async run(
    workspaceId: string,
    placement: WorkspacePlacement | undefined,
    intent: WorkspaceWindowIntent,
    options?: { monitorId?: string },
  ): Promise<WorkspacePlacement | undefined> {
    if (this.inFlight.has(workspaceId)) {
      throw asNativeError({ code: 'handoff_in_progress', message: 'This workspace is already being moved.' })
    }
    const action = resolveWindowAction(placement, intent)
    if (action.kind === 'noop') return placement

    this.inFlight.add(workspaceId)
    try {
      switch (action.kind) {
        case 'detach':
          try{await native.detachWorkspace(workspaceId)}catch(error){
            if(asNativeError(error).code==='workspace_already_detached'){await native.focusWorkspaceWindow(workspaceId);return await native.getWorkspacePlacement(workspaceId)}
            throw error
          }
          return await this.waitForPlacement(workspaceId, 'detached')
        case 'attach':
          await native.attachWorkspace(workspaceId)
          return await this.waitForPlacement(workspaceId, 'attached')
        case 'focus':
          await native.focusWorkspaceWindow(workspaceId)
          return placement
        case 'close':
          await native.closeWorkspaceWindow(workspaceId)
          return placement
        case 'move': {
          if (!options?.monitorId) {
            throw asNativeError({ code: 'monitor_required', message: 'Choose a target monitor first.' })
          }
          return await native.moveWorkspaceToMonitor(workspaceId, options.monitorId)
        }
        default:
          return placement
      }
    } finally {
      this.inFlight.delete(workspaceId)
    }
  }

  private async waitForPlacement(workspaceId:string, mode:WorkspacePlacement['mode']):Promise<WorkspacePlacement>{
    for(let attempt=0;attempt<150;attempt+=1){
      const placement=await native.getWorkspacePlacement(workspaceId)
      if(placement.mode===mode)return placement
      await new Promise((resolve)=>window.setTimeout(resolve,100))
    }
    throw asNativeError({code:'handoff_readiness_timeout',message:'The destination window did not become ready; the original workspace view was retained.'})
  }
}

export const handoffController = new HandoffController()
