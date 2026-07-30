export const OPEN_AGENT_RESUME_CENTER = 'paralith:open-agent-resume-center'
export const WORKSPACE_CONFIGURATION_CHANGED = 'paralith:workspace-configuration-changed'

export function openAgentResumeCenter() {
  window.dispatchEvent(new Event(OPEN_AGENT_RESUME_CENTER))
}
