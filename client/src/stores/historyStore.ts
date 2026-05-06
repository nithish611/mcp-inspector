import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { generateId, type ParsedMcpResult } from '@/lib/utils'

const MAX_ENTRIES_PER_SERVER = 200
const MAX_RAW_TEXT_LENGTH = 50000

export interface HistoryEntry {
  id: string
  serverId: string
  toolName: string
  args: Record<string, unknown>
  result: ParsedMcpResult
  timestamp: number
  durationMs: number
  isError: boolean
}

interface HistoryState {
  entries: Record<string, HistoryEntry[]>
  addEntry: (entry: Omit<HistoryEntry, 'id'>) => void
  clearHistory: (serverId: string) => void
  clearToolHistory: (serverId: string, toolName: string) => void
  getToolHistory: (serverId: string, toolName: string) => HistoryEntry[]
}

export const useHistoryStore = create<HistoryState>()(
  persist(
    (set, get) => ({
      entries: {},

      addEntry: (entry) => set((state) => {
        const truncatedResult: ParsedMcpResult = {
          ...entry.result,
          rawText: entry.result.rawText.length > MAX_RAW_TEXT_LENGTH
            ? entry.result.rawText.slice(0, MAX_RAW_TEXT_LENGTH)
            : entry.result.rawText,
        }

        const newEntry: HistoryEntry = {
          ...entry,
          id: generateId(),
          result: truncatedResult,
        }

        const serverEntries = [...(state.entries[entry.serverId] || []), newEntry]
          .slice(-MAX_ENTRIES_PER_SERVER)

        return {
          entries: {
            ...state.entries,
            [entry.serverId]: serverEntries,
          },
        }
      }),

      clearHistory: (serverId) => set((state) => {
        const { [serverId]: _, ...rest } = state.entries
        return { entries: rest }
      }),

      clearToolHistory: (serverId, toolName) => set((state) => ({
        entries: {
          ...state.entries,
          [serverId]: (state.entries[serverId] || []).filter(e => e.toolName !== toolName),
        },
      })),

      getToolHistory: (serverId, toolName) => {
        return (get().entries[serverId] || []).filter(e => e.toolName === toolName)
      },
    }),
    { name: 'mcp-tool-history' }
  )
)
