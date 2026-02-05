import { JsonEditor } from '@/components/JsonEditor'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn, copyToClipboard, downloadAsFile, formatDate, formatDuration } from '@/lib/utils'
import {
    useLogsStore,
    type LogEntry,
    type LogFilter,
} from '@/stores/logsStore'
import { useServersStore } from '@/stores/serversStore'
import {
    Activity,
    AlertTriangle,
    ArrowDownLeft,
    ArrowUpRight,
    Bell,
    ChevronRight,
    Clock,
    Code,
    Copy,
    Download,
    Filter,
    Hash,
    Search,
    Server,
    Terminal,
    Trash2,
    X,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'

const filterOptions: Array<{ value: LogFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'request', label: 'Requests' },
  { value: 'response', label: 'Responses' },
  { value: 'notification', label: 'Notifications' },
  { value: 'error', label: 'Errors' },
]

interface LogsTabProps {
  onClearLogs?: () => void
}

export function LogsTab({ onClearLogs }: LogsTabProps) {
  const {
    logs,
    filter,
    searchQuery,
    selectedLogId,
    setFilter,
    setSearchQuery,
    setSelectedLogId,
    clearLogs,
  } = useLogsStore()

  const { activeServerId, getActiveServer, servers } = useServersStore()
  const activeServer = getActiveServer()

  const [detailTab, setDetailTab] = useState<'overview' | 'request' | 'response' | 'headers'>('overview')
  const [showAllServers, setShowAllServers] = useState(false)

  const filteredLogs = useMemo(() => {
    let filtered = logs

    // Apply server filter (filter by active server unless "show all" is enabled)
    if (!showAllServers && activeServerId) {
      filtered = filtered.filter((log) => log.serverId === activeServerId)
    }

    // Apply direction filter
    if (filter !== 'all') {
      filtered = filtered.filter((log) => log.direction === filter)
    }

    // Apply search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase()
      filtered = filtered.filter(
        (log) =>
          log.method.toLowerCase().includes(query) ||
          JSON.stringify(log.params).toLowerCase().includes(query) ||
          JSON.stringify(log.result).toLowerCase().includes(query)
      )
    }

    return filtered
  }, [logs, filter, searchQuery, activeServerId, showAllServers])

  const scrollRef = useRef<HTMLDivElement>(null)
  const selectedLog = logs.find((log) => log.id === selectedLogId)

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (scrollRef.current && !selectedLogId) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [logs.length, selectedLogId])

  const handleClearLogs = () => {
    clearLogs()
    onClearLogs?.()
  }

  const handleExportLogs = () => {
    const content = JSON.stringify(filteredLogs, null, 2)
    downloadAsFile(content, `mcp-logs-${Date.now()}.json`)
  }

  const handleCopyLog = (log: LogEntry) => {
    copyToClipboard(JSON.stringify(log, null, 2))
  }

  const handleCopyAsCurl = (log: LogEntry) => {
    const curlCommand = generateCurlCommand(log)
    copyToClipboard(curlCommand)
  }

  const handleCopyAsCode = (log: LogEntry, language: 'javascript' | 'python') => {
    const code = generateCodeSnippet(log, language)
    copyToClipboard(code)
  }

  const getDirectionIcon = (direction: LogEntry['direction']) => {
    switch (direction) {
      case 'request':
        return <ArrowUpRight className="h-3.5 w-3.5 text-blue-500" />
      case 'response':
        return <ArrowDownLeft className="h-3.5 w-3.5 text-green-500" />
      case 'notification':
        return <Bell className="h-3.5 w-3.5 text-yellow-500" />
      case 'error':
        return <AlertTriangle className="h-3.5 w-3.5 text-red-500" />
    }
  }

  const getDirectionBadge = (direction: LogEntry['direction']) => {
    const variants: Record<LogEntry['direction'], 'info' | 'success' | 'warning' | 'destructive'> = {
      request: 'info',
      response: 'success',
      notification: 'warning',
      error: 'destructive',
    }
    return (
      <Badge variant={variants[direction]} className="text-xs uppercase px-1.5 py-0">
        {direction}
      </Badge>
    )
  }

  return (
    <div className="h-full flex flex-col">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border flex-shrink-0">
        <div className="flex items-center gap-3">
          <Activity className="h-4 w-4 text-muted-foreground" />
          <span className="font-medium text-sm">HTTP Logs</span>
          <Badge variant="secondary" className="text-xs">
            {filteredLogs.length} / {logs.length}
          </Badge>
          
          {/* Server filter indicator */}
          {activeServer && !showAllServers && (
            <Badge variant="outline" className="text-xs gap-1">
              <Server className="h-3 w-3" />
              {activeServer.name}
            </Badge>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Server Filter Toggle */}
          {servers.length > 1 && (
            <div className="flex items-center gap-1 border rounded-md p-0.5">
              <Server className="h-3.5 w-3.5 ml-1.5 text-muted-foreground" />
              <button
                className={cn(
                  'px-2 py-1 text-xs rounded transition-colors',
                  !showAllServers
                    ? 'bg-primary text-primary-foreground'
                    : 'hover:bg-muted'
                )}
                onClick={() => setShowAllServers(false)}
                title={activeServer ? `Show logs for ${activeServer.name}` : 'Show active server logs'}
              >
                Active
              </button>
              <button
                className={cn(
                  'px-2 py-1 text-xs rounded transition-colors',
                  showAllServers
                    ? 'bg-primary text-primary-foreground'
                    : 'hover:bg-muted'
                )}
                onClick={() => setShowAllServers(true)}
                title="Show logs from all servers"
              >
                All Servers
              </button>
            </div>
          )}

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Search logs..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-8 w-48 pl-8 text-sm"
            />
            {searchQuery && (
              <button
                className="absolute right-2.5 top-1/2 -translate-y-1/2"
                onClick={() => setSearchQuery('')}
              >
                <X className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" />
              </button>
            )}
          </div>

          {/* Filter */}
          <div className="flex items-center gap-1 border rounded-md p-0.5">
            <Filter className="h-3.5 w-3.5 ml-1.5 text-muted-foreground" />
            {filterOptions.map((option) => (
              <button
                key={option.value}
                className={cn(
                  'px-2 py-1 text-xs rounded transition-colors',
                  filter === option.value
                    ? 'bg-primary text-primary-foreground'
                    : 'hover:bg-muted'
                )}
                onClick={() => setFilter(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>

          {/* Actions */}
          <Button variant="outline" size="sm" onClick={handleExportLogs} className="h-8 gap-1.5">
            <Download className="h-3.5 w-3.5" />
            Export
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleClearLogs}
            className="h-8 gap-1.5 text-destructive hover:text-destructive"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Clear
          </Button>
        </div>
      </div>

      {/* Content - Split View */}
      <div className="flex-1 overflow-hidden">
        <PanelGroup direction="horizontal">
          {/* Logs List */}
          <Panel defaultSize={selectedLogId ? 40 : 100} minSize={30}>
            <ScrollArea ref={scrollRef} className="h-full">
              <div className="p-2">
                {filteredLogs.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                    <Activity className="h-12 w-12 mb-4 opacity-30" />
                    <p className="text-sm font-medium">No logs yet</p>
                    <p className="text-xs mt-1">
                      Logs will appear here when you make requests
                    </p>
                  </div>
                ) : (
                  <div className="space-y-1">
                    {filteredLogs.map((log) => (
                      <div
                        key={log.id}
                        className={cn(
                          'flex items-center gap-3 px-3 py-2 rounded-md cursor-pointer transition-colors',
                          selectedLogId === log.id
                            ? 'bg-primary/10 border border-primary/30'
                            : 'hover:bg-muted/50'
                        )}
                        onClick={() =>
                          setSelectedLogId(selectedLogId === log.id ? null : log.id)
                        }
                      >
                        {getDirectionIcon(log.direction)}
                        
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-sm font-medium truncate">
                              {log.method}
                            </span>
                            {getDirectionBadge(log.direction)}
                          </div>
                          <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground">
                            <span className="font-mono">{formatDate(log.timestamp)}</span>
                            {log.duration !== undefined && (
                              <span className="flex items-center gap-1">
                                <Clock className="h-3 w-3" />
                                {formatDuration(log.duration)}
                              </span>
                            )}
                            {log.requestId !== undefined && (
                              <span className="flex items-center gap-1">
                                <Hash className="h-3 w-3" />
                                {log.requestId}
                              </span>
                            )}
                            {/* Show server name when viewing all servers */}
                            {showAllServers && log.serverName && (
                              <span className="flex items-center gap-1">
                                <Server className="h-3 w-3" />
                                {log.serverName}
                              </span>
                            )}
                          </div>
                        </div>

                        <ChevronRight className={cn(
                          'h-4 w-4 text-muted-foreground transition-transform',
                          selectedLogId === log.id && 'rotate-90'
                        )} />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </ScrollArea>
          </Panel>

          {/* Log Detail Panel */}
          {selectedLogId && selectedLog && (
            <>
              <PanelResizeHandle className="w-1 bg-border hover:bg-primary/50 transition-colors" />
              <Panel defaultSize={60} minSize={40}>
                <div className="h-full flex flex-col border-l border-border">
                  {/* Detail Header */}
                  <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                    <div className="flex items-center gap-3">
                      {getDirectionIcon(selectedLog.direction)}
                      <span className="font-mono font-medium">{selectedLog.method}</span>
                      {getDirectionBadge(selectedLog.direction)}
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleCopyLog(selectedLog)}
                        className="h-7 text-xs gap-1"
                      >
                        <Copy className="h-3 w-3" />
                        Copy JSON
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleCopyAsCurl(selectedLog)}
                        className="h-7 text-xs gap-1"
                      >
                        <Terminal className="h-3 w-3" />
                        cURL
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleCopyAsCode(selectedLog, 'javascript')}
                        className="h-7 text-xs gap-1"
                      >
                        <Code className="h-3 w-3" />
                        JS
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleCopyAsCode(selectedLog, 'python')}
                        className="h-7 text-xs gap-1"
                      >
                        <Code className="h-3 w-3" />
                        Python
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setSelectedLogId(null)}
                        className="h-7"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>

                  {/* Detail Tabs */}
                  <div className="flex items-center gap-1 px-4 py-2 border-b border-border bg-muted/30">
                    {(['overview', 'request', 'response', 'headers'] as const).map((tab) => (
                      <button
                        key={tab}
                        className={cn(
                          'px-3 py-1.5 text-xs font-medium rounded-md transition-colors capitalize',
                          detailTab === tab
                            ? 'bg-background shadow-sm'
                            : 'hover:bg-background/50'
                        )}
                        onClick={() => setDetailTab(tab)}
                      >
                        {tab}
                      </button>
                    ))}
                  </div>

                  {/* Detail Content */}
                  <div className="flex-1 overflow-hidden flex flex-col p-4">
                    {detailTab === 'overview' && (
                      <LogOverview log={selectedLog} />
                    )}
                    {detailTab === 'request' && (
                      <LogRequestDetail log={selectedLog} />
                    )}
                    {detailTab === 'response' && (
                      <LogResponseDetail log={selectedLog} />
                    )}
                    {detailTab === 'headers' && (
                      <LogHeadersDetail log={selectedLog} />
                    )}
                  </div>
                </div>
              </Panel>
            </>
          )}
        </PanelGroup>
      </div>
    </div>
  )
}

// Sub-components for detail tabs

function LogOverview({ log }: { log: LogEntry }) {
  return (
    <div className="flex flex-col h-full gap-4 overflow-auto">
      <DetailSection title="General">
        <DetailRow label="Method" value={log.method} mono />
        <DetailRow label="Direction" value={log.direction} />
        <DetailRow label="Timestamp" value={log.timestamp} mono />
        {log.requestId !== undefined && (
          <DetailRow label="Request ID" value={String(log.requestId)} mono />
        )}
        {log.duration !== undefined && (
          <DetailRow label="Duration" value={formatDuration(log.duration)} />
        )}
        {log.serverName && (
          <DetailRow label="Server" value={log.serverName} />
        )}
      </DetailSection>

      {/* HTTP Status for HTTP-based requests */}
      {log.http?.statusCode !== undefined && (
        <DetailSection title="HTTP Status">
          <DetailRow 
            label="Status Code" 
            value={`${log.http.statusCode}${log.http.statusText ? ` ${log.http.statusText}` : ''}`} 
            mono 
          />
          {log.http.url && (
            <DetailRow label="URL" value={log.http.url} mono />
          )}
        </DetailSection>
      )}

      {log.params !== undefined && (
        <DetailSection title="Parameters">
          <JsonBlock data={log.params} />
        </DetailSection>
      )}

      {log.result !== undefined && (
        <DetailSection title="Result" className="flex-1 min-h-0 flex flex-col">
          <JsonBlock data={log.result} fullHeight />
        </DetailSection>
      )}

      {log.error !== undefined && (
        <DetailSection title="Error" variant="error" className="flex-1 min-h-0 flex flex-col">
          <JsonBlock data={log.error} variant="error" fullHeight />
        </DetailSection>
      )}
    </div>
  )
}

function LogRequestDetail({ log }: { log: LogEntry }) {
  const requestBody = {
    jsonrpc: '2.0',
    method: log.method,
    params: log.params,
    id: log.requestId || 1,
  }

  return (
    <div className="flex flex-col h-full gap-4">
      <DetailSection title="Request Body" className="flex-1 min-h-0 flex flex-col">
        <JsonBlock data={requestBody} fullHeight />
      </DetailSection>

      {log.params !== undefined && (
        <DetailSection title="Parameters Breakdown">
          <ParametersTable params={log.params} />
        </DetailSection>
      )}
    </div>
  )
}

function LogResponseDetail({ log }: { log: LogEntry }) {
  const responseBody = log.error
    ? {
        jsonrpc: '2.0',
        error: log.error,
        id: log.requestId || 1,
      }
    : {
        jsonrpc: '2.0',
        result: log.result,
        id: log.requestId || 1,
      }

  return (
    <div className="flex flex-col h-full gap-4">
      <DetailSection title="Response Body" className="flex-1 min-h-0 flex flex-col">
        <JsonBlock data={responseBody} variant={log.error ? 'error' : 'default'} fullHeight />
      </DetailSection>

      {log.result !== undefined && !log.error && (
        <DetailSection title="Result Breakdown">
          <ParametersTable params={log.result} />
        </DetailSection>
      )}
    </div>
  )
}

function LogHeadersDetail({ log }: { log: LogEntry }) {
  // Use actual HTTP headers if available, otherwise show defaults
  const hasHttpInfo = log.http && (log.http.requestHeaders || log.http.responseHeaders)
  
  const requestHeaders = log.http?.requestHeaders || {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  }

  const responseHeaders = log.http?.responseHeaders || {
    'Content-Type': 'application/json',
  }

  return (
    <div className="flex flex-col h-full gap-4 overflow-auto">
      {/* HTTP Info Summary */}
      {log.http && (
        <DetailSection title="HTTP Info">
          {log.http.method && log.http.url && (
            <DetailRow label="Request" value={`${log.http.method} ${log.http.url}`} mono />
          )}
          {log.http.statusCode !== undefined && (
            <DetailRow 
              label="Status" 
              value={`${log.http.statusCode}${log.http.statusText ? ` ${log.http.statusText}` : ''}`} 
              mono 
            />
          )}
        </DetailSection>
      )}

      {/* Server Info */}
      {(log.serverId || log.serverName) && (
        <DetailSection title="Server">
          {log.serverName && <DetailRow label="Name" value={log.serverName} />}
          {log.serverId && <DetailRow label="ID" value={log.serverId} mono />}
        </DetailSection>
      )}

      <DetailSection title="Request Headers">
        <HeadersTable headers={requestHeaders} />
      </DetailSection>

      <DetailSection title="Response Headers">
        <HeadersTable headers={responseHeaders} />
      </DetailSection>

      {/* Raw Bodies */}
      {log.http?.requestBody && (
        <DetailSection title="Raw Request Body" className="flex-1 min-h-[200px] flex flex-col">
          <JsonBlock data={log.http.requestBody} fullHeight />
        </DetailSection>
      )}

      {log.http?.responseBody && (
        <DetailSection title="Raw Response Body" className="flex-1 min-h-[200px] flex flex-col">
          <JsonBlock data={log.http.responseBody} fullHeight />
        </DetailSection>
      )}

      {!hasHttpInfo && (
        <div className="text-xs text-muted-foreground bg-muted/50 p-3 rounded-md">
          <p>
            Note: Detailed HTTP headers are available for HTTP-based transports.
            STDIO transports show default JSON-RPC headers.
          </p>
        </div>
      )}
    </div>
  )
}

// Helper components

function DetailSection({
  title,
  children,
  variant = 'default',
  className,
}: {
  title: string
  children: React.ReactNode
  variant?: 'default' | 'error'
  className?: string
}) {
  return (
    <div className={cn('space-y-2', className)}>
      <h4 className={cn(
        'text-xs font-medium uppercase tracking-wider flex-shrink-0',
        variant === 'error' ? 'text-destructive' : 'text-muted-foreground'
      )}>
        {title}
      </h4>
      {children}
    </div>
  )
}

function DetailRow({
  label,
  value,
  mono = false,
}: {
  label: string
  value: string
  mono?: boolean
}) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-border/50 last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className={cn('text-sm', mono && 'font-mono')}>{value}</span>
    </div>
  )
}

function JsonBlock({
  data,
  variant = 'default',
  fullHeight = false,
}: {
  data: unknown
  variant?: 'default' | 'error'
  fullHeight?: boolean
}) {
  const [copied, setCopied] = useState(false)
  const jsonString = JSON.stringify(data, null, 2)
  
  // Calculate height based on content (roughly 18px per line) with min 150px
  const lineCount = jsonString.split('\n').length
  const contentHeight = Math.max(lineCount * 18 + 20, 150)

  const handleCopy = () => {
    copyToClipboard(jsonString)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className={cn(
      'relative group',
      fullHeight && 'flex-1 min-h-0'
    )}>
      <div 
        className={cn(
          'rounded-md overflow-hidden border',
          variant === 'error' ? 'border-destructive/30' : 'border-border',
          fullHeight && 'h-full'
        )}
        style={fullHeight ? undefined : { height: `${contentHeight}px` }}
      >
        <JsonEditor
          value={jsonString}
          readOnly
          height="100%"
        />
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="absolute top-2 right-2 h-6 z-10 opacity-0 group-hover:opacity-100 transition-opacity bg-background/80"
        onClick={handleCopy}
      >
        {copied ? (
          <span className="text-xs text-green-500">Copied!</span>
        ) : (
          <Copy className="h-3 w-3" />
        )}
      </Button>
    </div>
  )
}

function ParametersTable({ params }: { params: unknown }) {
  if (typeof params !== 'object' || params === null) {
    return (
      <div className="text-sm text-muted-foreground">
        {String(params)}
      </div>
    )
  }

  const entries = Object.entries(params as Record<string, unknown>)

  if (entries.length === 0) {
    return (
      <div className="text-sm text-muted-foreground italic">
        No parameters
      </div>
    )
  }

  return (
    <div className="border rounded-md overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-muted/50">
            <th className="text-left px-3 py-2 font-medium text-muted-foreground">Key</th>
            <th className="text-left px-3 py-2 font-medium text-muted-foreground">Type</th>
            <th className="text-left px-3 py-2 font-medium text-muted-foreground">Value</th>
          </tr>
        </thead>
        <tbody>
          {entries.map(([key, value]) => (
            <tr key={key} className="border-t border-border/50">
              <td className="px-3 py-2 font-mono text-xs">{key}</td>
              <td className="px-3 py-2 text-muted-foreground text-xs">
                {Array.isArray(value) ? 'array' : typeof value}
              </td>
              <td className="px-3 py-2 font-mono text-xs truncate max-w-xs">
                {typeof value === 'object'
                  ? JSON.stringify(value)
                  : String(value)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function HeadersTable({ headers }: { headers: Record<string, string> }) {
  const entries = Object.entries(headers)

  return (
    <div className="border rounded-md overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-muted/50">
            <th className="text-left px-3 py-2 font-medium text-muted-foreground">Header</th>
            <th className="text-left px-3 py-2 font-medium text-muted-foreground">Value</th>
          </tr>
        </thead>
        <tbody>
          {entries.map(([key, value]) => (
            <tr key={key} className="border-t border-border/50">
              <td className="px-3 py-2 font-mono text-xs font-medium">{key}</td>
              <td className="px-3 py-2 font-mono text-xs">{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// Helper functions

function generateCurlCommand(log: LogEntry): string {
  // Use actual MCP server URL from HTTP info
  const mcpServerUrl = log.http?.url || '<MCP_SERVER_URL>'
  const method = log.http?.method || 'POST'
  
  // Build JSON-RPC payload for MCP server
  const payload = {
    jsonrpc: '2.0',
    method: log.method,
    params: log.params || {},
    id: log.requestId || 1,
  }

  // Use actual request headers if available, include Authorization if present
  const headers: Record<string, string> = { ...(log.http?.requestHeaders || {}) }
  
  // Ensure required headers for MCP Streamable HTTP transport
  if (!headers['Content-Type']) {
    headers['Content-Type'] = 'application/json'
  }
  // MCP servers require Accept header with both application/json and text/event-stream
  headers['Accept'] = 'application/json, text/event-stream'
  
  // Build header arguments - escape any double quotes in values
  const headerArgs = Object.entries(headers)
    .filter(([key]) => key.toLowerCase() !== 'content-length') // Skip content-length
    .map(([key, value]) => `-H '${key}: ${value.replace(/'/g, "'\\''")}'`)
    .join(' ')

  // Escape single quotes in JSON payload for shell
  const jsonPayload = JSON.stringify(payload).replace(/'/g, "'\\''")

  // Return clean single-line curl command (no comments, directly executable)
  return `curl -X ${method} ${headerArgs} -d '${jsonPayload}' '${mcpServerUrl}'`
}

function generateCodeSnippet(log: LogEntry, language: 'javascript' | 'python'): string {
  // Use actual MCP server URL from HTTP info
  const mcpServerUrl = log.http?.url || '<MCP_SERVER_URL>'
  
  // Build JSON-RPC payload for MCP server
  const payload = {
    jsonrpc: '2.0',
    method: log.method,
    params: log.params || {},
    id: log.requestId || 1,
  }

  // Get headers, include Authorization if present
  const headers = log.http?.requestHeaders || {}
  const headersObj: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== 'content-length') {
      headersObj[key] = value
    }
  }
  
  // Ensure required headers for MCP Streamable HTTP transport
  if (!headersObj['Content-Type']) {
    headersObj['Content-Type'] = 'application/json'
  }
  // MCP servers require Accept header with both application/json and text/event-stream
  headersObj['Accept'] = 'application/json, text/event-stream'

  if (language === 'javascript') {
    const headersStr = JSON.stringify(headersObj, null, 4).replace(/\n/g, '\n    ')
    return `// MCP Server Request
const response = await fetch('${mcpServerUrl}', {
  method: 'POST',
  headers: ${headersStr},
  body: JSON.stringify(${JSON.stringify(payload, null, 4)}),
});

const data = await response.json();
console.log(data);`
  }

  // Python
  const pythonPayload = JSON.stringify(payload, null, 4)
    .replace(/"/g, "'")
    .replace(/: true/g, ': True')
    .replace(/: false/g, ': False')
    .replace(/: null/g, ': None')

  const pythonHeaders = JSON.stringify(headersObj, null, 4)
    .replace(/"/g, "'")

  return `# MCP Server Request
import requests

payload = ${pythonPayload}

headers = ${pythonHeaders}

response = requests.post(
    '${mcpServerUrl}',
    json=payload,
    headers=headers
)

print(response.json())`
}
