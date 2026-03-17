import { useConnectionStore } from '@/stores/connectionStore'
import { useLogsStore, type LogEntry } from '@/stores/logsStore'
import { useServersStore, type ConnectionStatus, type ConnectionStep } from '@/stores/serversStore'
import { useCallback, useEffect, useRef } from 'react'

interface WSMessage {
  type: string
  payload?: unknown
}

interface ConnectionStatusPayload {
  status: ConnectionStatus
  serverId?: string
}

const CONNECTION_STEP_MAP: Record<string, { label: string; status: ConnectionStep['status'] }> = {
  'connection:start': { label: 'Starting connection', status: 'done' },
  'oauth:authorize_start': { label: 'Checking OAuth authorization', status: 'active' },
  'oauth:authorize_complete': { label: 'OAuth authorization verified', status: 'done' },
  'oauth:authorize_url_generated': { label: 'OAuth authorization URL generated', status: 'done' },
  'oauth:callback_received': { label: 'OAuth callback received', status: 'done' },
  'oauth:tokens_received': { label: 'OAuth tokens received', status: 'done' },
  'oauth:token_attached': { label: 'OAuth token attached to request', status: 'done' },
  'oauth:refresh_start': { label: 'Refreshing OAuth token', status: 'active' },
  'oauth:refresh_success': { label: 'OAuth token refreshed', status: 'done' },
  'transport:creating': { label: 'Creating transport', status: 'active' },
  'transport:created': { label: 'Transport ready', status: 'done' },
  'initialize': { label: 'Initializing MCP protocol handshake', status: 'active' },
  'capabilities:fetching': { label: 'Fetching server capabilities', status: 'active' },
  'connection:failed': { label: 'Connection failed', status: 'error' },
  'connection:close': { label: 'Connection closed', status: 'done' },
  'oauth:authorize_failed': { label: 'OAuth authorization failed', status: 'error' },
  'oauth:callback_failed': { label: 'OAuth callback failed', status: 'error' },
  'oauth:refresh_failed': { label: 'OAuth token refresh failed', status: 'error' },
  'oauth:revoke_start': { label: 'Revoking OAuth token', status: 'active' },
  'oauth:revoke_complete': { label: 'OAuth token revoked', status: 'done' },
  'oauth:revoke_failed': { label: 'OAuth revocation failed', status: 'error' },
  'oauth:cleared': { label: 'OAuth state cleared', status: 'done' },
}

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimeoutRef = useRef<number | null>(null)
  const addLog = useLogsStore((state) => state.addLog)
  const setLogs = useLogsStore((state) => state.setLogs)
  const clearLogs = useLogsStore((state) => state.clearLogs)
  const setStatus = useConnectionStore((state) => state.setStatus)
  const setServerStatus = useServersStore((state) => state.setServerStatus)
  const addConnectionStep = useServersStore((state) => state.addConnectionStep)
  const updateConnectionStep = useServersStore((state) => state.updateConnectionStep)
  const activeServerId = useServersStore((state) => state.activeServerId)

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      return
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = `${protocol}//${window.location.host}/ws`

    try {
      wsRef.current = new WebSocket(wsUrl)

      wsRef.current.onopen = () => {
        console.log('WebSocket connected')
        // Request existing logs
        wsRef.current?.send(JSON.stringify({ type: 'logs:get' }))
      }

      wsRef.current.onmessage = (event) => {
        try {
          const message: WSMessage = JSON.parse(event.data)
          handleMessage(message)
        } catch (error) {
          console.error('Failed to parse WebSocket message:', error)
        }
      }

      wsRef.current.onclose = () => {
        console.log('WebSocket disconnected')
        // Attempt to reconnect after 3 seconds
        reconnectTimeoutRef.current = window.setTimeout(() => {
          connect()
        }, 3000)
      }

      wsRef.current.onerror = (error) => {
        console.error('WebSocket error:', error)
      }
    } catch (error) {
      console.error('Failed to create WebSocket:', error)
    }
  }, [])

  const handleMessage = useCallback(
    (message: WSMessage) => {
      switch (message.type) {
        case 'log:new': {
          const logEntry = message.payload as LogEntry
          addLog(logEntry)

          if (logEntry.serverId) {
            const stepDef = CONNECTION_STEP_MAP[logEntry.method]
            if (stepDef) {
              const store = useServersStore.getState()
              const server = store.servers.find(s => s.id === logEntry.serverId)
              if (server) {
                const activeStep = server.connectionSteps.find(s => s.status === 'active')
                if (activeStep && stepDef.status !== 'error') {
                  updateConnectionStep(logEntry.serverId, activeStep.id, { status: 'done' })
                }
              }
              addConnectionStep(logEntry.serverId, {
                id: logEntry.method,
                label: stepDef.label,
                status: stepDef.status,
                timestamp: Date.now(),
                detail: logEntry.error ? String(logEntry.error) : undefined,
              })
            }
          }
          break
        }
        case 'logs:initial':
          setLogs(message.payload as LogEntry[])
          break
        case 'logs:cleared':
          clearLogs()
          break
        case 'connection:status': {
          const payload = message.payload as ConnectionStatusPayload
          if (payload.serverId) {
            setServerStatus(payload.serverId, payload.status)
            if (payload.serverId === activeServerId) {
              setStatus(payload.status)
            }

            if (payload.status.connected) {
              updateConnectionStep(payload.serverId, 'initialize', { status: 'done' })
              addConnectionStep(payload.serverId, {
                id: 'connected',
                label: `Connected to ${payload.status.serverInfo?.name || 'server'}`,
                status: 'done',
                timestamp: Date.now(),
              })
            } else if (payload.status.error) {
              addConnectionStep(payload.serverId, {
                id: 'error',
                label: 'Connection failed',
                status: 'error',
                timestamp: Date.now(),
                detail: payload.status.error,
              })
            } else if (payload.status.oauth?.authorizationRequired) {
              addConnectionStep(payload.serverId, {
                id: 'oauth_redirect',
                label: 'OAuth authorization required',
                status: 'active',
                timestamp: Date.now(),
                detail: 'Redirecting to authorization server...',
              })
            }
          } else {
            setStatus(payload.status)
          }
          break
        }
        case 'pong':
          // Heartbeat response
          break
        default:
          console.warn('Unknown WebSocket message type:', message.type)
      }
    },
    [addLog, setLogs, clearLogs, setStatus, setServerStatus, addConnectionStep, updateConnectionStep, activeServerId]
  )

  const send = useCallback((type: string, payload?: unknown) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type, payload }))
    }
  }, [])

  const clearServerLogs = useCallback(() => {
    send('logs:clear')
  }, [send])

  useEffect(() => {
    connect()

    // Heartbeat to keep connection alive
    const heartbeatInterval = setInterval(() => {
      send('ping')
    }, 30000)

    return () => {
      clearInterval(heartbeatInterval)
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current)
      }
      wsRef.current?.close()
    }
  }, [connect, send])

  return {
    send,
    clearServerLogs,
  }
}
