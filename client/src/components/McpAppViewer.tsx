import { useThemeStore } from '@/stores/themeStore'
import { Loader2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

interface ToolDef {
  name: string
  description?: string
  inputSchema: {
    type: string
    properties?: Record<string, unknown>
    required?: string[]
  }
}

interface McpAppViewerProps {
  html: string
  toolName: string
  tool?: ToolDef
  toolArgs?: Record<string, unknown>
  toolResult?: unknown
  onReadResource?: (uri: string) => Promise<unknown>
  onCallTool?: (name: string, args?: Record<string, unknown>) => Promise<unknown>
}

const PROTOCOL_VERSION = '2026-01-26'

const ESCAPE_FORWARDER_SCRIPT = `<script>document.addEventListener('keydown',function(e){if(e.key==='Escape'){window.parent.postMessage({type:'__mcp_escape__'},'*')}})</script>`

export function McpAppViewer({
  html,
  toolName,
  tool,
  toolArgs,
  toolResult,
  onReadResource,
  onCallTool,
}: McpAppViewerProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const { theme } = useThemeStore()
  const [initialized, setInitialized] = useState(false)
  const [loading, setLoading] = useState(true)
  const pendingToolInput = useRef<Record<string, unknown> | undefined>(undefined)
  const pendingToolResult = useRef<unknown>(undefined)

  const sendToIframe = useCallback((message: unknown) => {
    iframeRef.current?.contentWindow?.postMessage(message, '*')
  }, [])

  const sendNotification = useCallback((method: string, params: unknown) => {
    sendToIframe({
      jsonrpc: '2.0',
      method,
      params,
    })
  }, [sendToIframe])

  const sendResponse = useCallback((id: number | string, result: unknown) => {
    sendToIframe({
      jsonrpc: '2.0',
      id,
      result,
    })
  }, [sendToIframe])

  const sendErrorResponse = useCallback((id: number | string, code: number, message: string) => {
    sendToIframe({
      jsonrpc: '2.0',
      id,
      error: { code, message },
    })
  }, [sendToIframe])

  const getHostContext = useCallback(() => ({
    theme,
    displayMode: 'inline' as const,
    availableDisplayModes: ['inline' as const],
    platform: 'web' as const,
    toolInfo: {
      tool: tool
        ? { name: tool.name, description: tool.description, inputSchema: tool.inputSchema }
        : { name: toolName, inputSchema: { type: 'object' } },
    },
  }), [theme, toolName, tool])

  const handleInitialize = useCallback((id: number | string) => {
    sendResponse(id, {
      protocolVersion: PROTOCOL_VERSION,
      hostInfo: { name: 'MCP Inspector', version: '1.0.0' },
      hostCapabilities: {
        serverTools: {},
        serverResources: {},
        logging: {},
        openLinks: {},
      },
      hostContext: getHostContext(),
    })
  }, [sendResponse, getHostContext])

  const handleMessage = useCallback(async (event: MessageEvent) => {
    if (event.source !== iframeRef.current?.contentWindow) return

    const data = event.data
    if (data?.type === '__mcp_escape__') {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      return
    }
    if (!data || data.jsonrpc !== '2.0') return

    if (data.method) {
      switch (data.method) {
        case 'ui/initialize':
          handleInitialize(data.id)
          break

        case 'ui/notifications/initialized':
          setInitialized(true)
          setLoading(false)
          if (pendingToolInput.current !== undefined) {
            sendNotification('ui/notifications/tool-input', {
              arguments: pendingToolInput.current,
            })
            pendingToolInput.current = undefined
          }
          if (pendingToolResult.current !== undefined) {
            sendNotification('ui/notifications/tool-result', pendingToolResult.current)
            pendingToolResult.current = undefined
          }
          break

        case 'ui/notifications/size-changed':
          break

        case 'notifications/message':
          break

        case 'ui/open-link':
          if (data.params?.url) {
            window.open(data.params.url, '_blank', 'noopener,noreferrer')
            sendResponse(data.id, {})
          } else {
            sendErrorResponse(data.id, -32602, 'Missing url parameter')
          }
          break

        case 'ui/message':
          sendResponse(data.id, {})
          break

        case 'ui/update-model-context':
          sendResponse(data.id, {})
          break

        case 'ui/request-display-mode':
          sendResponse(data.id, { mode: 'inline' })
          break

        case 'ui/download-file':
          if (data.params?.contents) {
            for (const item of data.params.contents) {
              if (item.type === 'resource' && item.resource) {
                const res = item.resource
                const blob = res.blob
                  ? new Blob(
                      [Uint8Array.from(atob(res.blob), (c: string) => c.charCodeAt(0))],
                      { type: res.mimeType }
                    )
                  : new Blob([res.text ?? ''], { type: res.mimeType })
                const url = URL.createObjectURL(blob)
                const link = document.createElement('a')
                link.href = url
                link.download = res.uri?.split('/').pop() ?? 'download'
                link.click()
                URL.revokeObjectURL(url)
              }
            }
            sendResponse(data.id, {})
          } else {
            sendResponse(data.id, { isError: true })
          }
          break

        case 'tools/call':
          if (onCallTool && data.params?.name) {
            try {
              const result = await onCallTool(data.params.name, data.params.arguments)
              sendResponse(data.id, result)
            } catch (err) {
              sendErrorResponse(
                data.id,
                -32603,
                err instanceof Error ? err.message : 'Tool call failed'
              )
            }
          } else {
            sendErrorResponse(data.id, -32601, 'Tool calls not supported')
          }
          break

        case 'resources/read':
          if (onReadResource && data.params?.uri) {
            try {
              const result = await onReadResource(data.params.uri)
              sendResponse(data.id, result)
            } catch (err) {
              sendErrorResponse(
                data.id,
                -32603,
                err instanceof Error ? err.message : 'Resource read failed'
              )
            }
          } else {
            sendErrorResponse(data.id, -32601, 'Resource reads not supported')
          }
          break

        case 'resources/list':
          sendResponse(data.id, { resources: [] })
          break

        case 'ui/resource-teardown':
          sendResponse(data.id, {})
          break

        default:
          if (data.id !== undefined) {
            sendErrorResponse(data.id, -32601, `Method not found: ${data.method}`)
          }
          break
      }
    }
  }, [handleInitialize, sendNotification, sendResponse, sendErrorResponse, onCallTool, onReadResource])

  useEffect(() => {
    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [handleMessage])

  useEffect(() => {
    if (initialized) {
      sendNotification('ui/notifications/tool-input', {
        arguments: toolArgs,
      })
    } else {
      pendingToolInput.current = toolArgs
    }
  }, [toolArgs, initialized, sendNotification])

  useEffect(() => {
    if (!toolResult) return

    if (initialized) {
      sendNotification('ui/notifications/tool-result', toolResult)
    } else {
      pendingToolResult.current = toolResult
    }
  }, [toolResult, initialized, sendNotification])

  useEffect(() => {
    if (initialized) {
      sendNotification('ui/notifications/host-context-changed', getHostContext())
    }
  }, [theme, initialized, sendNotification, getHostContext])

  useEffect(() => {
    setInitialized(false)
    setLoading(true)
    pendingToolInput.current = toolArgs
    pendingToolResult.current = toolResult
  }, [html])

  const enhancedHtml = useMemo(() => {
    if (!html) return html
    if (html.includes('</body>')) {
      return html.replace('</body>', ESCAPE_FORWARDER_SCRIPT + '</body>')
    }
    if (html.includes('</html>')) {
      return html.replace('</html>', ESCAPE_FORWARDER_SCRIPT + '</html>')
    }
    return html + ESCAPE_FORWARDER_SCRIPT
  }, [html])

  return (
    <div className="relative h-full w-full">
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/50 z-10">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}
      <iframe
        ref={iframeRef}
        srcDoc={enhancedHtml}
        sandbox="allow-scripts allow-forms allow-popups allow-modals"
        className="h-full w-full border-0 rounded"
        title={`MCP App: ${toolName}`}
        onLoad={() => setLoading(false)}
      />
    </div>
  )
}
