import type { ConnectionStatus, OAuthStatus, ServerConfig } from '@/stores/connectionStore'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

const API_BASE = '/api'

// OAuth types
export interface OAuthAuthorizeResponse {
  authorizationUrl: string
  state: string
}

export interface OAuthCallbackResponse {
  success: boolean
  expiresAt?: number
  scope?: string
}

export interface RegisteredClient {
  clientId: string
  issuer: string
  resourceUri: string
  registeredAt: number
  clientSecretExpiresAt?: number
}

async function fetchApi<T>(
  endpoint: string,
  options?: RequestInit
): Promise<T> {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    headers: {
      'Content-Type': 'application/json',
    },
    ...options,
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Request failed' }))
    throw new Error(error.error || 'Request failed')
  }

  return response.json()
}

// Connection hooks
export function useConnect() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (params: { serverId: string; config: ServerConfig }) => {
      return fetchApi<ConnectionStatus>('/connect', {
        method: 'POST',
        body: JSON.stringify({ serverId: params.serverId, ...params.config }),
      })
    },
    onSuccess: (_data, variables) => {
      const { serverId } = variables
      queryClient.invalidateQueries({ queryKey: ['status', serverId] })
      queryClient.invalidateQueries({ queryKey: ['tools', serverId] })
      queryClient.invalidateQueries({ queryKey: ['resources', serverId] })
      queryClient.invalidateQueries({ queryKey: ['prompts', serverId] })
    },
  })
}

export function useDisconnect() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (serverId: string) => {
      return fetchApi<{ success: boolean }>('/disconnect', {
        method: 'POST',
        body: JSON.stringify({ serverId }),
      })
    },
    onSuccess: (_data, serverId) => {
      queryClient.invalidateQueries({ queryKey: ['status', serverId] })
      queryClient.resetQueries({ queryKey: ['tools', serverId] })
      queryClient.resetQueries({ queryKey: ['resources', serverId] })
      queryClient.resetQueries({ queryKey: ['prompts', serverId] })
    },
  })
}

export function useStatus(serverId?: string) {
  return useQuery({
    queryKey: ['status', serverId],
    queryFn: () => fetchApi<ConnectionStatus>(`/status?serverId=${encodeURIComponent(serverId || 'default')}`),
    enabled: !!serverId,
    refetchInterval: 5000,
  })
}

// Get list of connected server IDs from backend
export function useConnectedServers() {
  return useQuery({
    queryKey: ['connected-servers'],
    queryFn: () => fetchApi<{ serverIds: string[] }>('/servers/connected'),
    refetchInterval: 3000, // Refresh every 3 seconds to stay in sync
  })
}

// Tools hooks
export interface Tool {
  name: string
  description?: string
  inputSchema: {
    type: string
    properties?: Record<string, unknown>
    required?: string[]
  }
}

export function useTools(serverId?: string) {
  return useQuery({
    queryKey: ['tools', serverId],
    queryFn: async () => {
      const data = await fetchApi<{ tools: Tool[] }>(`/tools?serverId=${encodeURIComponent(serverId || 'default')}`)
      return data.tools
    },
    enabled: !!serverId, // Only fetch when serverId is provided
  })
}

export function useCallTool() {
  return useMutation({
    mutationFn: async (params: { serverId: string; name: string; arguments?: Record<string, unknown> }) => {
      return fetchApi<unknown>('/tools/call', {
        method: 'POST',
        body: JSON.stringify(params),
      })
    },
  })
}

// Resources hooks
export interface Resource {
  uri: string
  name: string
  description?: string
  mimeType?: string
}

export function useResources(serverId?: string) {
  return useQuery({
    queryKey: ['resources', serverId],
    queryFn: async () => {
      const data = await fetchApi<{ resources: Resource[] }>(`/resources?serverId=${encodeURIComponent(serverId || 'default')}`)
      return data.resources
    },
    enabled: !!serverId,
  })
}

export function useReadResource() {
  return useMutation({
    mutationFn: async (params: { serverId: string; uri: string }) => {
      return fetchApi<unknown>('/resources/read', {
        method: 'POST',
        body: JSON.stringify(params),
      })
    },
  })
}

// Prompts hooks
export interface Prompt {
  name: string
  description?: string
  arguments?: Array<{
    name: string
    description?: string
    required?: boolean
  }>
}

export function usePrompts(serverId?: string) {
  return useQuery({
    queryKey: ['prompts', serverId],
    queryFn: async () => {
      const data = await fetchApi<{ prompts: Prompt[] }>(`/prompts?serverId=${encodeURIComponent(serverId || 'default')}`)
      return data.prompts
    },
    enabled: !!serverId,
  })
}

export function useGetPrompt() {
  return useMutation({
    mutationFn: async (params: { serverId: string; name: string; arguments?: Record<string, string> }) => {
      return fetchApi<unknown>('/prompts/get', {
        method: 'POST',
        body: JSON.stringify(params),
      })
    },
  })
}

// ============================================================================
// OAuth hooks
// ============================================================================

/**
 * Initiate OAuth authorization flow
 */
export function useOAuthAuthorize() {
  return useMutation({
    mutationFn: async (params: {
      serverUrl: string
      scopes?: string[]
      clientId?: string
      clientSecret?: string
      redirectUri?: string
    }) => {
      return fetchApi<OAuthAuthorizeResponse>('/oauth/authorize', {
        method: 'POST',
        body: JSON.stringify(params),
      })
    },
  })
}

/**
 * Handle OAuth callback (exchange code for tokens)
 */
export function useOAuthCallback() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (params: {
      code: string
      state: string
      redirectUri?: string
      clientId?: string
      clientSecret?: string
      scopes?: string[]
    }) => {
      return fetchApi<OAuthCallbackResponse>('/oauth/callback', {
        method: 'POST',
        body: JSON.stringify(params),
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['oauth-status'] })
      queryClient.invalidateQueries({ queryKey: ['status'] })
    },
  })
}

/**
 * Get OAuth status for a server
 */
export function useOAuthStatus(serverUrl?: string, serverId?: string) {
  return useQuery({
    queryKey: ['oauth-status', serverUrl, serverId],
    queryFn: async () => {
      if (!serverUrl) return null
      const params = new URLSearchParams({ serverUrl })
      if (serverId) params.append('serverId', serverId)
      return fetchApi<OAuthStatus>(`/oauth/status?${params.toString()}`)
    },
    enabled: !!serverUrl,
    refetchInterval: 30000, // Refresh every 30 seconds
  })
}

/**
 * Revoke OAuth authorization
 */
export function useOAuthRevoke() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (params: { serverUrl: string; serverId?: string }) => {
      return fetchApi<{ success: boolean }>('/oauth/revoke', {
        method: 'POST',
        body: JSON.stringify(params),
      })
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['oauth-status', variables.serverUrl, variables.serverId] })
      queryClient.invalidateQueries({ queryKey: ['status', variables.serverId] })
    },
  })
}

/**
 * Get registered OAuth clients
 */
export function useOAuthClients() {
  return useQuery({
    queryKey: ['oauth-clients'],
    queryFn: async () => {
      const data = await fetchApi<{ clients: RegisteredClient[] }>('/oauth/clients')
      return data.clients
    },
  })
}

/**
 * Clear all OAuth data
 */
export function useOAuthClear() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async () => {
      return fetchApi<{ success: boolean }>('/oauth/clear', {
        method: 'DELETE',
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['oauth-status'] })
      queryClient.invalidateQueries({ queryKey: ['oauth-clients'] })
      queryClient.invalidateQueries({ queryKey: ['status'] })
    },
  })
}
