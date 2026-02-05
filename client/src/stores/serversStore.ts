import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type TransportType = 'stdio' | 'sse' | 'streamable-http'

export interface OAuthConfig {
  enabled: boolean
  issuer?: string
  clientId?: string
  clientSecret?: string
  scopes?: string[]
  redirectUri: string
}

export interface OAuthStatus {
  authenticated: boolean
  authorizationRequired?: boolean
  authorizationUrl?: string
  scopes?: string[]
  expiresAt?: number
  error?: string
}

export interface ServerConfig {
  type: TransportType
  command?: string
  args?: string[]
  env?: Record<string, string>
  url?: string
  headers?: Record<string, string>
  oauth?: OAuthConfig
}

export interface ConnectionStatus {
  connected: boolean
  serverInfo?: {
    name: string
    version: string
  }
  capabilities?: {
    tools?: boolean
    resources?: boolean
    prompts?: boolean
  }
  error?: string
  oauth?: OAuthStatus
}

export interface Server {
  id: string
  name: string
  config: ServerConfig
  status: ConnectionStatus
  isConnecting: boolean
  isAuthorizing: boolean
  createdAt: number
}

interface ServersState {
  servers: Server[]
  activeServerId: string | null
  
  // Actions
  addServer: (server: Omit<Server, 'id' | 'status' | 'isConnecting' | 'isAuthorizing' | 'createdAt'>) => string
  removeServer: (id: string) => void
  updateServer: (id: string, updates: Partial<Omit<Server, 'id' | 'createdAt'>>) => void
  updateServerConfig: (id: string, config: Partial<ServerConfig>) => void
  updateServerOAuthConfig: (id: string, oauth: Partial<OAuthConfig>) => void
  setServerStatus: (id: string, status: ConnectionStatus) => void
  setServerConnecting: (id: string, isConnecting: boolean) => void
  setServerAuthorizing: (id: string, isAuthorizing: boolean) => void
  setActiveServer: (id: string | null) => void
  getServer: (id: string) => Server | undefined
  getActiveServer: () => Server | undefined
  getConnectedServers: () => Server[]
  clearServerError: (id: string) => void
  reset: () => void
}

// Dynamic redirect URI based on current window location
const getDefaultRedirectUri = () => {
  if (typeof window !== 'undefined') {
    return `${window.location.origin}/oauth/callback`
  }
  return 'http://localhost:3000/oauth/callback'
}

const defaultOAuthConfig: OAuthConfig = {
  enabled: false,
  redirectUri: getDefaultRedirectUri(),
}

const defaultConfig: ServerConfig = {
  type: 'stdio',
  command: '',
  args: [],
  env: {},
  url: '',
  oauth: defaultOAuthConfig,
}

const defaultStatus: ConnectionStatus = {
  connected: false,
}

// Generate a unique ID
const generateId = () => {
  return `server_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
}

export const useServersStore = create<ServersState>()(
  persist(
    (set, get) => ({
      servers: [],
      activeServerId: null,

      addServer: (serverData) => {
        const id = generateId()
        const newServer: Server = {
          id,
          name: serverData.name,
          config: { ...defaultConfig, ...serverData.config },
          status: defaultStatus,
          isConnecting: false,
          isAuthorizing: false,
          createdAt: Date.now(),
        }
        
        set((state) => ({
          servers: [...state.servers, newServer],
          activeServerId: state.activeServerId || id, // Set as active if first server
        }))
        
        return id
      },

      removeServer: (id) => {
        set((state) => {
          const newServers = state.servers.filter((s) => s.id !== id)
          const newActiveId = state.activeServerId === id
            ? (newServers.length > 0 ? newServers[0].id : null)
            : state.activeServerId
          
          return {
            servers: newServers,
            activeServerId: newActiveId,
          }
        })
      },

      updateServer: (id, updates) => {
        set((state) => ({
          servers: state.servers.map((s) =>
            s.id === id ? { ...s, ...updates } : s
          ),
        }))
      },

      updateServerConfig: (id, config) => {
        set((state) => ({
          servers: state.servers.map((s) =>
            s.id === id
              ? { ...s, config: { ...s.config, ...config } }
              : s
          ),
        }))
      },

      updateServerOAuthConfig: (id, oauth) => {
        set((state) => ({
          servers: state.servers.map((s) =>
            s.id === id
              ? {
                  ...s,
                  config: {
                    ...s.config,
                    oauth: { ...s.config.oauth!, ...oauth },
                  },
                }
              : s
          ),
        }))
      },

      setServerStatus: (id, status) => {
        set((state) => ({
          servers: state.servers.map((s) =>
            s.id === id ? { ...s, status } : s
          ),
        }))
      },

      setServerConnecting: (id, isConnecting) => {
        set((state) => ({
          servers: state.servers.map((s) =>
            s.id === id ? { ...s, isConnecting } : s
          ),
        }))
      },

      setServerAuthorizing: (id, isAuthorizing) => {
        set((state) => ({
          servers: state.servers.map((s) =>
            s.id === id ? { ...s, isAuthorizing } : s
          ),
        }))
      },

      setActiveServer: (id) => {
        set({ activeServerId: id })
      },

      getServer: (id) => {
        return get().servers.find((s) => s.id === id)
      },

      getActiveServer: () => {
        const state = get()
        return state.servers.find((s) => s.id === state.activeServerId)
      },

      getConnectedServers: () => {
        return get().servers.filter((s) => s.status.connected)
      },

      clearServerError: (id) => {
        set((state) => ({
          servers: state.servers.map((s) =>
            s.id === id
              ? { ...s, status: { ...s.status, error: undefined } }
              : s
          ),
        }))
      },

      reset: () => {
        set({
          servers: [],
          activeServerId: null,
        })
      },
    }),
    {
      name: 'mcp-servers',
      // Persist servers but reset transient states on load
      partialize: (state) => ({
        servers: state.servers.map((s) => ({
          ...s,
          status: { connected: false }, // Reset connection status
          isConnecting: false,
          isAuthorizing: false,
        })),
        activeServerId: state.activeServerId,
      }),
    }
  )
)
