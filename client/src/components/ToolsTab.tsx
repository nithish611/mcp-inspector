import { JsonEditor } from '@/components/JsonEditor'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useCallTool, useTools, type Tool } from '@/hooks/useApi'
import { cn, copyToClipboard, parseMcpResult, type ParsedMcpResult } from '@/lib/utils'
import { useServersStore } from '@/stores/serversStore'
import {
    AlertCircle,
    ChevronDown,
    ChevronRight,
    Code,
    Copy,
    FormInput,
    GripHorizontal,
    Loader2,
    Play,
    RefreshCw,
    Search,
    Wrench,
    X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'

// Local storage key for tool arguments
const TOOL_ARGS_STORAGE_KEY = 'mcp-tool-args'

// Get stored tool arguments
function getStoredToolArgs(serverId: string, toolName: string): string | null {
  try {
    const stored = localStorage.getItem(TOOL_ARGS_STORAGE_KEY)
    if (stored) {
      const data = JSON.parse(stored)
      return data[serverId]?.[toolName] || null
    }
  } catch {
    // Ignore errors
  }
  return null
}

// Store tool arguments
function storeToolArgs(serverId: string, toolName: string, args: string): void {
  try {
    const stored = localStorage.getItem(TOOL_ARGS_STORAGE_KEY)
    const data = stored ? JSON.parse(stored) : {}
    if (!data[serverId]) {
      data[serverId] = {}
    }
    data[serverId][toolName] = args
    localStorage.setItem(TOOL_ARGS_STORAGE_KEY, JSON.stringify(data))
  } catch {
    // Ignore errors
  }
}

// Local storage key for tool results cache
const TOOL_RESULTS_CACHE_KEY = 'mcp-tool-results-cache'

// Get cached tool result
function getCachedToolResult(serverId: string, toolName: string): ParsedMcpResult | null {
  try {
    const stored = localStorage.getItem(TOOL_RESULTS_CACHE_KEY)
    if (stored) {
      const data = JSON.parse(stored)
      return data[serverId]?.[toolName] || null
    }
  } catch {
    // Ignore errors
  }
  return null
}

// Store tool result in cache
function storeCachedToolResult(serverId: string, toolName: string, result: ParsedMcpResult): void {
  try {
    const stored = localStorage.getItem(TOOL_RESULTS_CACHE_KEY)
    const data = stored ? JSON.parse(stored) : {}
    if (!data[serverId]) {
      data[serverId] = {}
    }
    data[serverId][toolName] = result
    localStorage.setItem(TOOL_RESULTS_CACHE_KEY, JSON.stringify(data))
  } catch {
    // Ignore errors
  }
}

export function ToolsTab() {
  const { activeServerId, servers } = useServersStore()
  const activeServer = servers.find((s) => s.id === activeServerId)
  const isConnected = activeServer?.status?.connected === true
  
  const { data: tools, isLoading, refetch, error } = useTools(activeServerId || '')
  const callToolMutation = useCallTool()

  const [selectedTool, setSelectedTool] = useState<Tool | null>(null)
  const [toolArgs, setToolArgs] = useState<string>('{}')
  const [toolResult, setToolResult] = useState<unknown>(null)
  const [parsedResult, setParsedResult] = useState<ParsedMcpResult | null>(null)
  const [expandedSchemas, setExpandedSchemas] = useState<Set<string>>(new Set())
  const [inputMode, setInputMode] = useState<'json' | 'form'>('form')
  const [formValues, setFormValues] = useState<Record<string, string>>({})
  const [toolSearchQuery, setToolSearchQuery] = useState('')

  // Filter tools based on search query
  const filteredTools = useMemo(() => {
    if (!tools || !toolSearchQuery.trim()) return tools
    const query = toolSearchQuery.toLowerCase()
    return tools.filter(tool =>
      tool.name.toLowerCase().includes(query) ||
      tool.description?.toLowerCase().includes(query)
    )
  }, [tools, toolSearchQuery])

  // Reset selected tool when server changes
  useEffect(() => {
    setSelectedTool(null)
    setToolResult(null)
    setParsedResult(null)
    setToolSearchQuery('')
  }, [activeServerId])

  // Refetch tools when connected
  useEffect(() => {
    if (isConnected && activeServerId) {
      refetch()
    }
  }, [isConnected, activeServerId, refetch])

  // Initialize tool arguments when tool is selected
  useEffect(() => {
    if (selectedTool && activeServerId) {
      // Try to get stored arguments first
      const storedArgs = getStoredToolArgs(activeServerId, selectedTool.name)
      if (storedArgs) {
        setToolArgs(storedArgs)
        try {
          const parsed = JSON.parse(storedArgs)
          setFormValues(
            Object.fromEntries(
              Object.entries(parsed).map(([k, v]) => [k, String(v)])
            )
          )
        } catch {
          setFormValues({})
        }
      } else {
        // Generate default arguments from schema
        const defaultArgs: Record<string, unknown> = {}
        const props = selectedTool.inputSchema.properties || {}
        
        Object.entries(props).forEach(([key, value]) => {
          const prop = value as { type?: string; default?: unknown }
          if (prop.default !== undefined) {
            defaultArgs[key] = prop.default
          } else if (prop.type === 'string') {
            defaultArgs[key] = ''
          } else if (prop.type === 'number' || prop.type === 'integer') {
            defaultArgs[key] = 0
          } else if (prop.type === 'boolean') {
            defaultArgs[key] = false
          } else if (prop.type === 'array') {
            defaultArgs[key] = []
          } else if (prop.type === 'object') {
            defaultArgs[key] = {}
          }
        })

        const argsStr = JSON.stringify(defaultArgs, null, 2)
        setToolArgs(argsStr)
        setFormValues(
          Object.fromEntries(
            Object.entries(defaultArgs).map(([k, v]) => [k, String(v)])
          )
        )
      }

      // Try to get cached result
      const cachedResult = getCachedToolResult(activeServerId, selectedTool.name)
      if (cachedResult) {
        setParsedResult(cachedResult)
        setToolResult(cachedResult.data)
      } else {
        setToolResult(null)
        setParsedResult(null)
      }
    }
  }, [selectedTool, activeServerId])

  // Store tool arguments when they change
  useEffect(() => {
    if (selectedTool && activeServerId && toolArgs) {
      storeToolArgs(activeServerId, selectedTool.name, toolArgs)
    }
  }, [toolArgs, selectedTool, activeServerId])

  const handleExecuteTool = useCallback(async () => {
    if (!selectedTool || !activeServerId) return

    try {
      const args = inputMode === 'json' ? JSON.parse(toolArgs) : formValues
      const result = await callToolMutation.mutateAsync({
        serverId: activeServerId,
        name: selectedTool.name,
        arguments: Object.keys(args).length > 0 ? args : undefined,
      })
      setToolResult(result)
      const parsed = parseMcpResult(result)
      setParsedResult(parsed)
      // Cache the result
      storeCachedToolResult(activeServerId, selectedTool.name, parsed)
    } catch (error) {
      if (error instanceof SyntaxError) {
        const errorResult = { error: 'Invalid JSON in arguments' }
        setToolResult(errorResult)
        setParsedResult({ 
          data: errorResult, 
          rawText: JSON.stringify(errorResult, null, 2), 
          isJson: true, 
          isError: true, 
          contentType: 'text' 
        })
      } else {
        const errorResult = {
          error: error instanceof Error ? error.message : 'Tool execution failed',
        }
        setToolResult(errorResult)
        setParsedResult({ 
          data: errorResult, 
          rawText: JSON.stringify(errorResult, null, 2), 
          isJson: true, 
          isError: true, 
          contentType: 'text' 
        })
      }
    }
  }, [selectedTool, activeServerId, inputMode, toolArgs, formValues, callToolMutation])

  // Keyboard shortcut: Cmd/Ctrl + Enter to execute
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        if (selectedTool && !callToolMutation.isPending) {
          e.preventDefault()
          handleExecuteTool()
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedTool, callToolMutation.isPending, handleExecuteTool])

  const handleCopyResult = () => {
    if (parsedResult) {
      copyToClipboard(parsedResult.isJson ? JSON.stringify(parsedResult.data, null, 2) : parsedResult.rawText)
    } else if (toolResult) {
      copyToClipboard(JSON.stringify(toolResult, null, 2))
    }
  }

  const toggleSchemaExpanded = (toolName: string) => {
    const newExpanded = new Set(expandedSchemas)
    if (newExpanded.has(toolName)) {
      newExpanded.delete(toolName)
    } else {
      newExpanded.add(toolName)
    }
    setExpandedSchemas(newExpanded)
  }

  const updateFormValue = (key: string, value: string) => {
    const newValues = { ...formValues, [key]: value }
    setFormValues(newValues)
    // Sync to JSON
    try {
      const jsonObj: Record<string, unknown> = {}
      const props = selectedTool?.inputSchema.properties || {}
      Object.entries(newValues).forEach(([k, v]) => {
        const prop = props[k] as { type?: string } | undefined
        if (prop?.type === 'number' || prop?.type === 'integer') {
          jsonObj[k] = Number(v) || 0
        } else if (prop?.type === 'boolean') {
          jsonObj[k] = v === 'true'
        } else {
          jsonObj[k] = v
        }
      })
      setToolArgs(JSON.stringify(jsonObj, null, 2))
    } catch {
      // Ignore sync errors
    }
  }

  if (!activeServerId) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground p-8">
        <Wrench className="h-12 w-12 mb-4 opacity-50" />
        <p className="text-lg font-medium">No Server Selected</p>
        <p className="text-sm">Select a server from the sidebar to view tools</p>
      </div>
    )
  }

  if (!isConnected) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground p-8">
        <Wrench className="h-12 w-12 mb-4 opacity-50" />
        <p className="text-lg font-medium">Not Connected</p>
        <p className="text-sm">Connect to the server to view tools</p>
      </div>
    )
  }

  return (
    <div className="h-full p-4">
      <PanelGroup direction="horizontal" className="h-full">
        {/* Tools List Panel */}
        <Panel defaultSize={25} minSize={15} maxSize={40}>
          <Card className="h-full flex flex-col">
            <CardHeader className="pb-3 flex-shrink-0">
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Wrench className="h-5 w-5" />
                  Tools
                  {tools && (
                    <Badge variant="secondary" className="ml-2">
                      {filteredTools?.length}{toolSearchQuery && `/${tools.length}`}
                    </Badge>
                  )}
                </CardTitle>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => refetch()}
                  disabled={isLoading}
                >
                  <RefreshCw
                    className={cn('h-4 w-4', isLoading && 'animate-spin')}
                  />
                </Button>
              </div>
              {/* Search Input */}
              {tools && tools.length > 0 && (
                <div className="relative mt-2">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    placeholder="Search tools..."
                    value={toolSearchQuery}
                    onChange={(e) => setToolSearchQuery(e.target.value)}
                    className="h-8 pl-8 pr-8 text-sm"
                  />
                  {toolSearchQuery && (
                    <button
                      className="absolute right-2.5 top-1/2 -translate-y-1/2"
                      onClick={() => setToolSearchQuery('')}
                    >
                      <X className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" />
                    </button>
                  )}
                </div>
              )}
            </CardHeader>
            <CardContent className="flex-1 overflow-hidden p-0">
              <ScrollArea className="h-full px-6 pb-6">
                {isLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                ) : error ? (
                  <div className="text-center py-8 text-destructive">
                    <AlertCircle className="h-6 w-6 mx-auto mb-2" />
                    <p className="text-sm">Failed to load tools</p>
                  </div>
                ) : tools?.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <Wrench className="h-6 w-6 mx-auto mb-2 opacity-50" />
                    <p className="text-sm">No tools available</p>
                  </div>
                ) : filteredTools?.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <Search className="h-6 w-6 mx-auto mb-2 opacity-50" />
                    <p className="text-sm">No tools match "{toolSearchQuery}"</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {filteredTools?.map((tool) => (
                      <div
                        key={tool.name}
                        className={cn(
                          'p-3 rounded-lg border cursor-pointer transition-colors',
                          selectedTool?.name === tool.name
                            ? 'border-primary bg-primary/5'
                            : 'border-border hover:border-primary/50 hover:bg-muted/50'
                        )}
                        onClick={() => setSelectedTool(tool)}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <p className="font-medium font-mono text-sm truncate">
                              {tool.name}
                            </p>
                            {tool.description && (
                              <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                                {tool.description}
                              </p>
                            )}
                          </div>
                        </div>
                        
                        {/* Schema toggle */}
                        <button
                          className="flex items-center gap-1 text-xs text-muted-foreground mt-2 hover:text-foreground"
                          onClick={(e) => {
                            e.stopPropagation()
                            toggleSchemaExpanded(tool.name)
                          }}
                        >
                          {expandedSchemas.has(tool.name) ? (
                            <ChevronDown className="h-3 w-3" />
                          ) : (
                            <ChevronRight className="h-3 w-3" />
                          )}
                          Schema
                        </button>
                        
                        {expandedSchemas.has(tool.name) && (
                          <pre className="text-xs bg-muted p-2 rounded mt-2 overflow-auto max-h-32">
                            {JSON.stringify(tool.inputSchema, null, 2)}
                          </pre>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </CardContent>
          </Card>
        </Panel>

        {/* Horizontal Resize Handle */}
        <PanelResizeHandle className="w-2 mx-1 flex items-center justify-center group">
          <div className="w-1 h-8 rounded-full bg-border group-hover:bg-primary/50 transition-colors" />
        </PanelResizeHandle>

        {/* Tool Execution Panel */}
        <Panel defaultSize={75} minSize={40}>
          <div className="h-full flex flex-col">
            <PanelGroup direction="vertical" className="h-full">
              {/* Arguments Editor */}
              <Panel defaultSize={50} minSize={20}>
                <Card className="h-full flex flex-col">
                  <CardHeader className="pb-3 flex-shrink-0">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-lg">
                        {selectedTool ? (
                          <span className="flex items-center gap-2">
                            <span className="font-mono">{selectedTool.name}</span>
                            <Badge variant="outline">Arguments</Badge>
                          </span>
                        ) : (
                          'Tool Arguments'
                        )}
                      </CardTitle>
                      <div className="flex items-center gap-2">
                        {selectedTool && (
                          <div className="flex items-center border rounded-md p-0.5">
                            <button
                              className={cn(
                                'px-2 py-1 text-xs rounded transition-colors flex items-center gap-1',
                                inputMode === 'json'
                                  ? 'bg-primary text-primary-foreground'
                                  : 'hover:bg-muted'
                              )}
                              onClick={() => setInputMode('json')}
                            >
                              <Code className="h-3 w-3" />
                              JSON
                            </button>
                            <button
                              className={cn(
                                'px-2 py-1 text-xs rounded transition-colors flex items-center gap-1',
                                inputMode === 'form'
                                  ? 'bg-primary text-primary-foreground'
                                  : 'hover:bg-muted'
                              )}
                              onClick={() => setInputMode('form')}
                            >
                              <FormInput className="h-3 w-3" />
                              Form
                            </button>
                          </div>
                        )}
                        <Button
                          onClick={handleExecuteTool}
                          disabled={!selectedTool || callToolMutation.isPending}
                          title="Execute (⌘+Enter)"
                        >
                          {callToolMutation.isPending ? (
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          ) : (
                            <Play className="h-4 w-4 mr-2" />
                          )}
                          Execute
                        </Button>
                      </div>
                    </div>
                    {selectedTool?.description && (
                      <p className="text-sm text-muted-foreground">
                        {selectedTool.description}
                      </p>
                    )}
                  </CardHeader>
                  <CardContent className="flex-1 overflow-hidden min-h-0">
                    {selectedTool ? (
                      inputMode === 'json' ? (
                        <div className="h-full">
                          <JsonEditor
                            value={toolArgs}
                            onChange={setToolArgs}
                            height="100%"
                            schema={selectedTool.inputSchema}
                          />
                        </div>
                      ) : (
                        <ScrollArea className="h-full">
                          <div className="space-y-4 pr-4">
                            {Object.entries(selectedTool.inputSchema.properties || {}).map(
                              ([key, value]) => {
                                const prop = value as {
                                  type?: string
                                  description?: string
                                }
                                const isRequired = (
                                  selectedTool.inputSchema.required || []
                                ).includes(key)
                                return (
                                  <div key={key} className="space-y-2">
                                    <Label className="flex items-center gap-2">
                                      {key}
                                      {isRequired && (
                                        <span className="text-destructive">*</span>
                                      )}
                                      <Badge variant="outline" className="text-xs">
                                        {prop.type}
                                      </Badge>
                                    </Label>
                                    {prop.description && (
                                      <p className="text-xs text-muted-foreground">
                                        {prop.description}
                                      </p>
                                    )}
                                    <Input
                                      value={formValues[key] || ''}
                                      onChange={(e) =>
                                        updateFormValue(key, e.target.value)
                                      }
                                      placeholder={`Enter ${key}`}
                                    />
                                  </div>
                                )
                              }
                            )}
                          </div>
                        </ScrollArea>
                      )
                    ) : (
                      <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                        <Wrench className="h-8 w-8 mb-2 opacity-50" />
                        <p className="text-sm">Select a tool to configure arguments</p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </Panel>

              {/* Vertical Resize Handle */}
              <PanelResizeHandle className="h-2 my-1 flex items-center justify-center group">
                <GripHorizontal className="h-4 w-4 text-muted-foreground group-hover:text-primary/50 transition-colors" />
              </PanelResizeHandle>

              {/* Results Panel */}
              <Panel defaultSize={50} minSize={20}>
                <Card className="h-full flex flex-col">
                  <CardHeader className="pb-3 flex-shrink-0">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-lg flex items-center gap-2">
                        Result
                        {callToolMutation.isPending && (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        )}
                      </CardTitle>
                      {parsedResult && (
                        <Button variant="ghost" size="sm" onClick={handleCopyResult}>
                          <Copy className="h-4 w-4 mr-1" />
                          Copy
                        </Button>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent className="flex-1 overflow-hidden min-h-0">
                    {parsedResult ? (
                      <div className="h-full">
                        <JsonEditor
                          value={parsedResult.isJson ? JSON.stringify(parsedResult.data, null, 2) : parsedResult.rawText}
                          onChange={() => {}}
                          height="100%"
                          readOnly
                        />
                      </div>
                    ) : (
                      <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                        <Play className="h-8 w-8 mb-2 opacity-50" />
                        <p className="text-sm">Execute a tool to see results</p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </Panel>
            </PanelGroup>
          </div>
        </Panel>
      </PanelGroup>
    </div>
  )
}
