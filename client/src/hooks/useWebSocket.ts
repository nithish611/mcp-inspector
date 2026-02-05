import { useConnectionStore } from '@/stores/connectionStore'
import { useLogsStore, type LogEntry } from '@/stores/logsStore'
import { useServersStore } from '@/stores/serversStore'
import { useCallback, useEffect, useRef } from 'react'

interface WSMessage {
  type: string
  payload?: unknown
}

interface ConnectionStatusPayload {
  status: {
    connected: boolean
    serverInfo?: { name: string; version: string }
    capabilities?: { tools?: boolean; resources?: boolean; prompts?: boolean }
    error?: string
  }
  serverId?: string
}

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimeoutRef = useRef<number | null>(null)
  const addLog = useLogsStore((state) => state.addLog)
  const setLogs = useLogsStore((state) => state.setLogs)
  const clearLogs = useLogsStore((state) => state.clearLogs)
  const setStatus = useConnectionStore((state) => state.setStatus)
  const setServerStatus = useServersStore((state) => state.setServerStatus)
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
        case 'log:new':
          addLog(message.payload as LogEntry)
          break
        case 'logs:initial':
          setLogs(message.payload as LogEntry[])
          break
        case 'logs:cleared':
          clearLogs()
          break
        case 'connection:status': {
          const payload = message.payload as ConnectionStatusPayload
          // Update the servers store if serverId is provided
          if (payload.serverId) {
            setServerStatus(payload.serverId, payload.status)
            // Only update legacy store if this is the active server
            if (payload.serverId === activeServerId) {
              setStatus(payload.status)
            }
          } else {
            // Fallback for legacy messages without serverId
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
    [addLog, setLogs, clearLogs, setStatus, setServerStatus, activeServerId]
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
