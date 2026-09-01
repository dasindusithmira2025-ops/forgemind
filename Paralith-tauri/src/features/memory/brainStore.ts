/**
 * Renderer state for Brain Ask and Brain Systems.
 *
 * A third store rather than more fields on `memoryStore` or `intelligenceStore`, for the same
 * reason those two are separate: Ask is a conversation with the project and Systems is a read-mostly
 * index, and folding either into the knowledge editor's store would re-render both on every
 * keystroke in a memory body.
 *
 * Loads are guarded by the same monotonic `loadToken` rule the other stores use: switching Projects,
 * or asking a new question while a slow one is in flight, must never let an older answer overwrite
 * a newer one.
 */
import { create } from 'zustand'
import { asNativeError } from '../../native/commands'
import { brainApi } from './api'
import type { BrainAnswer, BrainSystem } from './brainTypes'

/** How many previously asked questions this session keeps. Bounded: a transcript is not memory. */
const ASKED_HISTORY = 12

interface BrainState {
  projectId?: string
  loadToken: number

  /** What is currently typed in the Ask field. */
  question: string
  asking: boolean
  answer?: BrainAnswer
  error: string
  /**
   * Questions asked in this session, newest first.
   *
   * Session-scoped on purpose. An asked question is an *event*, not project knowledge, and
   * persisting every one of them would be exactly the transcript archive this system exists to
   * avoid. What Brain durably learns comes from evidence, not from what someone typed.
   */
  asked: BrainAnswer[]

  systems: BrainSystem[]
  systemsLoading: boolean
  /** Which system the Explore → Systems reader has open. */
  activeSystemId?: string

  load: (projectId: string) => Promise<void>
  setQuestion: (question: string) => void
  ask: (question?: string) => Promise<void>
  reopen: (answer: BrainAnswer) => void
  clearAnswer: () => void
  refreshSystems: () => Promise<void>
  selectSystem: (systemId?: string) => void
  clearError: () => void
  reset: () => void
}

const EMPTY = {
  question: '',
  asking: false,
  answer: undefined,
  error: '',
  asked: [] as BrainAnswer[],
  systems: [] as BrainSystem[],
  systemsLoading: false,
  activeSystemId: undefined,
}

export const useBrainStore = create<BrainState>((set, get) => ({
  loadToken: 0,
  ...EMPTY,

  load: async (projectId) => {
    const token = get().loadToken + 1
    set({ ...EMPTY, projectId, loadToken: token })
    await get().refreshSystems()
  },

  setQuestion: (question) => set({ question }),

  ask: async (question) => {
    const { projectId, loadToken } = get()
    const text = (question ?? get().question).trim()
    if (!projectId || !text) return
    set({ asking: true, question: text, error: '' })
    try {
      const answer = await brainApi.ask({ projectId, question: text })
      if (get().loadToken !== loadToken) return
      set((state) => ({
        answer,
        asking: false,
        // Re-asking the same question replaces its entry rather than stacking a duplicate.
        asked: [answer, ...state.asked.filter((prior) => prior.question !== answer.question)].slice(
          0,
          ASKED_HISTORY,
        ),
      }))
    } catch (caught) {
      if (get().loadToken !== loadToken) return
      set({ asking: false, error: asNativeError(caught).message })
    }
  },

  /** Show an answer already received this session, without asking the backend again. */
  reopen: (answer) => set({ answer, question: answer.question, error: '' }),

  clearAnswer: () => set({ answer: undefined, question: '' }),

  refreshSystems: async () => {
    const { projectId, loadToken } = get()
    if (!projectId) return
    set({ systemsLoading: true })
    try {
      const systems = await brainApi.systems(projectId)
      if (get().loadToken !== loadToken) return
      set({ systems, systemsLoading: false })
    } catch (caught) {
      if (get().loadToken !== loadToken) return
      set({ systemsLoading: false, error: asNativeError(caught).message })
    }
  },

  selectSystem: (systemId) => set({ activeSystemId: systemId }),

  clearError: () => set({ error: '' }),

  reset: () => set((state) => ({ ...EMPTY, projectId: undefined, loadToken: state.loadToken + 1 })),
}))
