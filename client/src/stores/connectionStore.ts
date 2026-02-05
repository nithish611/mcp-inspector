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

interface ConnectionState {
  config: ServerConfig
  status: ConnectionStatus
  isConnecting: boolean
  isAuthorizing: boolean
  
  // Actions
  setConfig: (config: Partial<ServerConfig>) => void
  setOAuthConfig: (oauth: Partial<OAuthConfig>) => void
  setStatus: (status: ConnectionStatus) => void
  setIsConnecting: (isConnecting: boolean) => void
  setIsAuthorizing: (isAuthorizing: boolean) => void
  clearOAuthError: () => void
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

export const useConnectionStore = create<ConnectionState>()(
  persist(
    (set) => ({
      config: defaultConfig,
      status: defaultStatus,
      isConnecting: false,
      isAuthorizing: false,

      setConfig: (config) =>
        set((state) => ({
          config: { ...state.config, ...config },
        })),

      setOAuthConfig: (oauth) =>
        set((state) => ({
          config: {
            ...state.config,
            oauth: { ...state.config.oauth!, ...oauth },
          },
        })),

      setStatus: (status) => set({ status }),

      setIsConnecting: (isConnecting) => set({ isConnecting }),

      setIsAuthorizing: (isAuthorizing) => set({ isAuthorizing }),

      clearOAuthError: () =>
        set((state) => ({
          status: {
            ...state.status,
            error: undefined,
          },
        })),

      reset: () =>
        set({
          config: defaultConfig,
          status: defaultStatus,
          isConnecting: false,
          isAuthorizing: false,
        }),
    }),
    {
      name: 'mcp-connection-config',
      // Only persist the config, not the status or transient states
      partialize: (state) => ({ config: state.config }),
    }
  )
)
