import { create } from 'zustand'

export interface ExecutionEntry {
  id: string
  toolName: string
  serverId: string
  status: 'running' | 'success' | 'error'
  startTime: number
  endTime?: number
  durationMs?: number
  error?: string
}

const MAX_ENTRIES = 20

interface ExecutionState {
  executions: ExecutionEntry[]
  addExecution: (entry: Omit<ExecutionEntry, 'id'>) => string
  updateExecution: (id: string, update: Partial<ExecutionEntry>) => void
  clearCompleted: () => void
  getRunning: () => ExecutionEntry[]
}

function generateId() {
  return Math.random().toString(36).substring(2, 10)
}

export const useExecutionStore = create<ExecutionState>()((set, get) => ({
  executions: [],

  addExecution: (entry) => {
    const id = generateId()
    set((state) => ({
      executions: [{ ...entry, id }, ...state.executions].slice(0, MAX_ENTRIES),
    }))
    return id
  },

  updateExecution: (id, update) => set((state) => ({
    executions: state.executions.map((e) => (e.id === id ? { ...e, ...update } : e)),
  })),

  clearCompleted: () => set((state) => ({
    executions: state.executions.filter((e) => e.status === 'running'),
  })),

  getRunning: () => get().executions.filter((e) => e.status === 'running'),
}))
