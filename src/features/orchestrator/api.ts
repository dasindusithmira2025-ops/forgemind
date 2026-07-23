import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import type {
  CapabilityDescriptor,
  CapabilityOutcome,
  CreateSessionRequest,
  ExecuteCapabilityRequest,
  OrchestrationEvent,
  OrchestrationSession,
  OrchestrationSessionView,
  OrchestrationTurn,
} from './types'

/** Typed IPC wrappers for the Paralith Orchestrator commands. Tauri maps camelCase JS keys to the
 *  snake_case Rust parameters. */
export const orchestratorApi = {
  createSession: (request: CreateSessionRequest) =>
    invoke<OrchestrationSessionView>('orchestrator_create_session', { request }),
  getSession: (sessionId: string) =>
    invoke<OrchestrationSessionView>('orchestrator_get_session', { sessionId }),
  listSessions: (projectId?: string | null) =>
    invoke<OrchestrationSession[]>('orchestrator_list_sessions', { projectId: projectId ?? null }),
  listInterrupted: () =>
    invoke<OrchestrationSession[]>('orchestrator_list_interrupted_sessions'),
  sendMessage: (
    sessionId: string,
    content: string,
    inputType?: 'text' | 'voice',
    transcriptConfidence?: number,
  ) =>
    invoke<OrchestrationTurn>('orchestrator_send_message', {
      sessionId,
      content,
      inputType,
      transcriptConfidence,
    }),
  listCapabilities: (sessionId: string) =>
    invoke<CapabilityDescriptor[]>('orchestrator_list_capabilities', { sessionId }),
  executeCapability: (request: ExecuteCapabilityRequest) =>
    invoke<CapabilityOutcome>('orchestrator_execute_capability', { request }),
  pauseSession: (sessionId: string) =>
    invoke<OrchestrationSession>('orchestrator_pause_session', { sessionId }),
  resumeSession: (sessionId: string) =>
    invoke<OrchestrationSession>('orchestrator_resume_session', { sessionId }),
  cancelSession: (sessionId: string) =>
    invoke<OrchestrationSession>('orchestrator_cancel_session', { sessionId }),
}

export const onOrchestratorSession = (
  handler: (session: OrchestrationSession) => void,
): Promise<UnlistenFn> =>
  listen<OrchestrationSession>('orchestrator-session', (event) => handler(event.payload))

export const onOrchestratorEvent = (
  handler: (event: OrchestrationEvent) => void,
): Promise<UnlistenFn> =>
  listen<OrchestrationEvent>('orchestrator-event', (event) => handler(event.payload))
