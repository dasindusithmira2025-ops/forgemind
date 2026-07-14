export interface MemorySource {
  id: string
  sourceType: string
  projectId: string
  uri: string
  filePath?: string
  lineStart?: number
  lineEnd?: number
  branchName?: string
  gitCommit?: string
  worktreeId?: string
  workspaceId?: string
  paneId?: string
  terminalSessionId?: string
  agentSessionId?: string
  eventId?: string
  capturedAt: string
  excerpt?: string
  mimeType?: string
  sensitivity: string
}

export interface MemoryItem {
  id: string
  projectId: string
  memoryType: string
  title: string
  state: string
  visibility: string
  workspaceId?: string
  branchName?: string
  pinned: boolean
  revisionId: string
  revisionNumber: number
  body: string
  summary: string
  confidence: number
  observedAt: string
  createdAt: string
  updatedAt: string
  sources: MemorySource[]
}

export interface MemorySearchResult {
  itemId: string
  projectId: string
  memoryType: string
  title: string
  summary: string
  excerpt: string
  workspaceId?: string
  branchName?: string
  pinned: boolean
  updatedAt: string
  source?: MemorySource
}

export interface MemorySearchResponse { projectId: string; query: string; results: MemorySearchResult[]; total: number }
export interface CaptureOutcome { eventId: string; itemId: string; revisionId: string; deduplicated: boolean; sensitivity: string }
export interface MemoryRebuildResult { projectId: string; indexedChunks: number }
export interface MemoryHealth { projectId: string; itemCount: number; revisionCount: number; sourceCount: number; chunkCount: number; indexedChunkCount: number; healthy: boolean; messages: string[] }
