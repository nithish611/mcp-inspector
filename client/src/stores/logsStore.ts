import { create } from 'zustand'

export interface HttpInfo {
  /** HTTP method (GET, POST, etc.) */
  method?: string
  /** Request URL */
  url?: string
  /** HTTP status code */
  statusCode?: number
  /** HTTP status text */
  statusText?: string
  /** Request headers */
  requestHeaders?: Record<string, string>
  /** Response headers */
  responseHeaders?: Record<string, string>
  /** Raw request body */
  requestBody?: string
  /** Raw response body */
  responseBody?: string
}

export interface LogEntry {
  id: string
  timestamp: string
  direction: 'request' | 'response' | 'notification' | 'error'
  method: string
  params?: unknown
  result?: unknown
  error?: unknown
  duration?: number
  requestId?: string | number
  /** Server identifier for multi-server support */
  serverId?: string
  /** Server name for display */
  serverName?: string
  /** HTTP-specific metadata */
  http?: HttpInfo
}

export type LogFilter = 'all' | 'request' | 'response' | 'notification' | 'error'

interface LogsState {
  logs: LogEntry[]
  filter: LogFilter
  searchQuery: string
  selectedLogId: string | null
  isExpanded: boolean
  
  // Actions
  addLog: (log: LogEntry) => void
  setLogs: (logs: LogEntry[]) => void
  clearLogs: () => void
  setFilter: (filter: LogFilter) => void
  setSearchQuery: (query: string) => void
  setSelectedLogId: (id: string | null) => void
  setIsExpanded: (expanded: boolean) => void
  toggleExpanded: () => void
}

export const useLogsStore = create<LogsState>((set) => ({
  logs: [],
  filter: 'all',
  searchQuery: '',
  selectedLogId: null,
  isExpanded: true,

  addLog: (log) =>
    set((state) => ({
      logs: [...state.logs, log].slice(-1000), // Keep last 1000 logs
    })),

  setLogs: (logs) => set({ logs }),

  clearLogs: () => set({ logs: [], selectedLogId: null }),

  setFilter: (filter) => set({ filter }),

  setSearchQuery: (searchQuery) => set({ searchQuery }),

  setSelectedLogId: (selectedLogId) => set({ selectedLogId }),

  setIsExpanded: (isExpanded) => set({ isExpanded }),

  toggleExpanded: () => set((state) => ({ isExpanded: !state.isExpanded })),
}))

// Selector for filtered logs
export const selectFilteredLogs = (state: LogsState): LogEntry[] => {
  let filtered = state.logs

  // Apply direction filter
  if (state.filter !== 'all') {
    filtered = filtered.filter((log) => log.direction === state.filter)
  }

  // Apply search filter
  if (state.searchQuery) {
    const query = state.searchQuery.toLowerCase()
    filtered = filtered.filter(
      (log) =>
        log.method.toLowerCase().includes(query) ||
        JSON.stringify(log.params).toLowerCase().includes(query) ||
        JSON.stringify(log.result).toLowerCase().includes(query)
    )
  }

  return filtered
}
