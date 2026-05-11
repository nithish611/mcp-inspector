import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface EnvironmentVariable {
  key: string
  value: string
  enabled: boolean
}

export interface Environment {
  id: string
  name: string
  variables: EnvironmentVariable[]
}

interface EnvironmentState {
  environments: Environment[]
  activeEnvironmentId: string | null
  addEnvironment: (name: string) => string
  removeEnvironment: (id: string) => void
  renameEnvironment: (id: string, name: string) => void
  setActiveEnvironment: (id: string | null) => void
  addVariable: (envId: string, key: string, value: string) => void
  updateVariable: (envId: string, index: number, variable: Partial<EnvironmentVariable>) => void
  removeVariable: (envId: string, index: number) => void
  getActiveVariables: () => Record<string, string>
  substituteVariables: (text: string) => string
}

function generateId() {
  return Math.random().toString(36).substring(2, 15)
}

export const useEnvironmentStore = create<EnvironmentState>()(
  persist(
    (set, get) => ({
      environments: [],
      activeEnvironmentId: null,

      addEnvironment: (name: string) => {
        const id = generateId()
        set((state) => ({
          environments: [...state.environments, { id, name, variables: [] }],
        }))
        return id
      },

      removeEnvironment: (id: string) => set((state) => ({
        environments: state.environments.filter((e) => e.id !== id),
        activeEnvironmentId: state.activeEnvironmentId === id ? null : state.activeEnvironmentId,
      })),

      renameEnvironment: (id: string, name: string) => set((state) => ({
        environments: state.environments.map((e) => e.id === id ? { ...e, name } : e),
      })),

      setActiveEnvironment: (id: string | null) => set({ activeEnvironmentId: id }),

      addVariable: (envId: string, key: string, value: string) => set((state) => ({
        environments: state.environments.map((e) =>
          e.id === envId
            ? { ...e, variables: [...e.variables, { key, value, enabled: true }] }
            : e
        ),
      })),

      updateVariable: (envId: string, index: number, variable: Partial<EnvironmentVariable>) => set((state) => ({
        environments: state.environments.map((e) =>
          e.id === envId
            ? {
                ...e,
                variables: e.variables.map((v, i) => i === index ? { ...v, ...variable } : v),
              }
            : e
        ),
      })),

      removeVariable: (envId: string, index: number) => set((state) => ({
        environments: state.environments.map((e) =>
          e.id === envId
            ? { ...e, variables: e.variables.filter((_, i) => i !== index) }
            : e
        ),
      })),

      getActiveVariables: () => {
        const state = get()
        const env = state.environments.find((e) => e.id === state.activeEnvironmentId)
        if (!env) return {}
        const vars: Record<string, string> = {}
        for (const v of env.variables) {
          if (v.enabled && v.key) {
            vars[v.key] = v.value
          }
        }
        return vars
      },

      substituteVariables: (text: string) => {
        const vars = get().getActiveVariables()
        return text.replace(/\{\{(\w+)\}\}/g, (match, key) => {
          return key in vars ? vars[key] : match
        })
      },
    }),
    { name: 'mcp-environments' }
  )
)
