import { JsonEditor } from '@/components/JsonEditor'
import { McpAppViewer } from '@/components/McpAppViewer'
import { ToolHistoryPanel } from '@/components/ToolHistoryPanel'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useCallTool, useClearPersona, useDeletePersonaEmail, useGeneratePayload, usePersonaEmails, useReadResource, useTokenExchange, useTools, type Tool } from '@/hooks/useApi'
import { toast } from '@/lib/toast'
import { cn, copyToClipboard, parseMcpResult, type ParsedMcpResult } from '@/lib/utils'
import { useHistoryStore } from '@/stores/historyStore'
import { useServersStore } from '@/stores/serversStore'
import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Clock,
  Code,
  Copy,
  Expand,
  Eye,
  FormInput,
  GripHorizontal,
  Layout,
  Loader2,
  Pencil,
  Play,
  RefreshCw,
  Search,
  Sparkles,
  TriangleAlert,
  UserRound,
  Wrench,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'

function getToolUiResourceUri(tool: Tool): string | undefined {
  const meta = tool._meta
  if (!meta) return undefined
  const uiMeta = meta.ui as { resourceUri?: string } | undefined
  let uri: unknown = uiMeta?.resourceUri
  if (uri === undefined) {
    uri = (meta as Record<string, unknown>)['ui/resourceUri']
  }
  if (typeof uri === 'string' && uri.startsWith('ui://')) {
    return uri
  }
  return undefined
}

type ToolIntent = 'read' | 'write' | 'destructive'

function getToolIntent(tool: Tool): ToolIntent {
  const annotations = tool.annotations
  if (annotations?.destructiveHint) return 'destructive'
  if (annotations?.readOnlyHint) return 'read'
  return 'write'
}

function getToolTitle(tool: Tool): string {
  const title = tool.annotations?.title
  if (typeof title === 'string' && title.trim().length > 0) {
    return title
  }
  return tool.name
}

type SchemaNode = {
  type?: string
  properties?: Record<string, SchemaNode>
  items?: SchemaNode
  default?: unknown
  enum?: unknown[]
  additionalProperties?: boolean | SchemaNode
}

function buildSkeleton(schema: SchemaNode, depth = 0): unknown {
  if (depth > 6) return undefined
  if (schema.default !== undefined) return schema.default
  if (schema.enum && schema.enum.length > 0) return schema.enum[0]

  switch (schema.type) {
    case 'string':
      return ''
    case 'number':
    case 'integer':
      return 0
    case 'boolean':
      return false
    case 'array': {
      return []
    }
    case 'object': {
      if (!schema.properties) return {}
      const obj: Record<string, unknown> = {}
      for (const [key, propSchema] of Object.entries(schema.properties)) {
        const val = buildSkeleton(propSchema, depth + 1)
        if (val !== undefined) obj[key] = val
      }
      return obj
    }
    default:
      return undefined
  }
}

function argsToFormValues(args: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(args).map(([k, v]) => [
      k,
      typeof v === 'object' && v !== null ? JSON.stringify(v, null, 2) : String(v),
    ])
  )
}

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

type CachedToolEntry = ParsedMcpResult & { _cachedAt?: number }

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

// Store tool result in cache with timestamp
function storeCachedToolResult(serverId: string, toolName: string, result: ParsedMcpResult): void {
  try {
    const stored = localStorage.getItem(TOOL_RESULTS_CACHE_KEY)
    const data = stored ? JSON.parse(stored) : {}
    if (!data[serverId]) {
      data[serverId] = {}
    }
    data[serverId][toolName] = { ...result, _cachedAt: Date.now() }
    localStorage.setItem(TOOL_RESULTS_CACHE_KEY, JSON.stringify(data))
  } catch {
    // Ignore errors
  }
}

const FIELD_VALUES_CACHE_KEY = 'mcp-field-values'
const MAX_FIELD_SUGGESTIONS = 10

function getFieldSuggestions(toolName: string, fieldKey: string): string[] {
  try {
    const stored = localStorage.getItem(FIELD_VALUES_CACHE_KEY)
    if (stored) {
      const data = JSON.parse(stored)
      return data[toolName]?.[fieldKey] || []
    }
  } catch {
    // Ignore
  }
  return []
}

function saveFieldValues(toolName: string, values: Record<string, string>): void {
  try {
    const stored = localStorage.getItem(FIELD_VALUES_CACHE_KEY)
    const data = stored ? JSON.parse(stored) : {}
    if (!data[toolName]) {
      data[toolName] = {}
    }
    for (const [key, val] of Object.entries(values)) {
      if (!val || !val.trim()) continue
      const existing: string[] = data[toolName][key] || []
      const filtered = existing.filter((v: string) => v !== val)
      filtered.unshift(val)
      data[toolName][key] = filtered.slice(0, MAX_FIELD_SUGGESTIONS)
    }
    localStorage.setItem(FIELD_VALUES_CACHE_KEY, JSON.stringify(data))
  } catch {
    // Ignore
  }
}

export function ToolsTab() {
  const { activeServerId, servers } = useServersStore()
  const activeServer = servers.find((s) => s.id === activeServerId)
  const isConnected = activeServer?.status?.connected === true
  
  const { data: tools, isLoading, refetch, error } = useTools(activeServerId || '')
  const callToolMutation = useCallTool()
  const generatePayloadMutation = useGeneratePayload()
  const readResourceMutation = useReadResource()
  const tokenExchangeMutation = useTokenExchange()
  const clearPersonaMutation = useClearPersona()
  const deletePersonaEmailMutation = useDeletePersonaEmail()
  const { data: cachedEmails } = usePersonaEmails(activeServerId || undefined)
  const { setPersona, clearPersona } = useServersStore()

  const [personaEmail, setPersonaEmail] = useState('')
  const [showPersonaDropdown, setShowPersonaDropdown] = useState(false)
  const personaDropdownRef = useRef<HTMLDivElement>(null)
  const [activeFieldSuggestion, setActiveFieldSuggestion] = useState<string | null>(null)
  const fieldSuggestionRef = useRef<HTMLDivElement>(null)

  const [selectedTool, setSelectedTool] = useState<Tool | null>(null)
  const [toolArgs, setToolArgs] = useState<string>('{}')
  const [toolResult, setToolResult] = useState<unknown>(null)
  const [parsedResult, setParsedResult] = useState<ParsedMcpResult | null>(null)
  const [expandedSchemas, setExpandedSchemas] = useState<Set<string>>(new Set())
  const [inputMode, setInputMode] = useState<'json' | 'form'>('form')
  const [formValues, setFormValues] = useState<Record<string, string>>({})
  const [toolSearchQuery, setToolSearchQuery] = useState('')
  const [resultViewMode, setResultViewMode] = useState<'json' | 'ui'>('json')
  const [appHtml, setAppHtml] = useState<string | null>(null)
  const [isLoadingAppHtml, setIsLoadingAppHtml] = useState(false)
  const [schemaDialogTool, setSchemaDialogTool] = useState<Tool | null>(null)
  const [resultExpanded, setResultExpanded] = useState(false)
  const [expandedFieldKey, setExpandedFieldKey] = useState<string | null>(null)
  const [showHistory, setShowHistory] = useState(false)
  const [confirmDestructive, setConfirmDestructive] = useState(false)
  const executeAbortControllerRef = useRef<AbortController | null>(null)

  const selectedToolResourceUri = selectedTool ? getToolUiResourceUri(selectedTool) : undefined
  const isAppTool = !!selectedToolResourceUri

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
    setAppHtml(null)
    setResultViewMode('json')
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
      setConfirmDestructive(false)
      // Try to get stored arguments first
      const storedArgs = getStoredToolArgs(activeServerId, selectedTool.name)
      if (storedArgs) {
        setToolArgs(storedArgs)
        try {
          const parsed = JSON.parse(storedArgs)
          setFormValues(
            Object.fromEntries(
              Object.entries(parsed).map(([k, v]) => [
                k,
                typeof v === 'object' && v !== null ? JSON.stringify(v, null, 2) : String(v),
              ])
            )
          )
        } catch {
          setFormValues({})
        }
      } else {
        const defaultArgs: Record<string, unknown> = {}
        const props = selectedTool.inputSchema.properties || {}
        
        Object.entries(props).forEach(([key, value]) => {
          const val = buildSkeleton(value as SchemaNode)
          if (val !== undefined) defaultArgs[key] = val
        })

        const argsStr = JSON.stringify(defaultArgs, null, 2)
        setToolArgs(argsStr)
        setFormValues(
          Object.fromEntries(
            Object.entries(defaultArgs).map(([k, v]) => [
              k,
              typeof v === 'object' && v !== null ? JSON.stringify(v, null, 2) : String(v),
            ])
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

      // Reset app state and set default view mode based on tool type
      setAppHtml(null)
      const resourceUri = getToolUiResourceUri(selectedTool)
      setResultViewMode(resourceUri ? 'ui' : 'json')
    }
  }, [selectedTool, activeServerId])

  // Store tool arguments when they change
  useEffect(() => {
    if (selectedTool && activeServerId && toolArgs) {
      storeToolArgs(activeServerId, selectedTool.name, toolArgs)
    }
  }, [toolArgs, selectedTool, activeServerId])

  const fetchAppHtml = useCallback(async (resourceUri: string) => {
    if (!activeServerId) return
    setIsLoadingAppHtml(true)
    try {
      const result = await readResourceMutation.mutateAsync({
        serverId: activeServerId,
        uri: resourceUri,
      })
      const res = result as { contents?: Array<{ text?: string }> }
      const htmlContent = res?.contents?.[0]?.text
      if (htmlContent) {
        setAppHtml(htmlContent)
      }
    } catch (err) {
      console.error('Failed to fetch MCP App HTML resource:', err)
    } finally {
      setIsLoadingAppHtml(false)
    }
  }, [activeServerId, readResourceMutation])

  const handleTokenExchange = useCallback(async () => {
    if (!activeServerId || !personaEmail.trim()) return
    try {
      const result = await tokenExchangeMutation.mutateAsync({
        serverId: activeServerId,
        targetUserEmail: personaEmail.trim(),
      })
      setPersona(activeServerId, {
        email: result.target_email,
        expiresAt: Date.now() + result.expires_in * 1000,
        actorSub: result.actor_sub,
        actorEmail: result.actor_email,
      })
      setShowPersonaDropdown(false)
    } catch {
      // Error is handled by mutation state
    }
  }, [activeServerId, personaEmail, tokenExchangeMutation, setPersona])

  const handleClearPersona = useCallback(async () => {
    if (!activeServerId) return
    clearPersona(activeServerId)
    setPersonaEmail('')
    try {
      await clearPersonaMutation.mutateAsync(activeServerId)
    } catch {
      // best-effort
    }
  }, [activeServerId, clearPersona, clearPersonaMutation])

  // Close dropdowns on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (personaDropdownRef.current && !personaDropdownRef.current.contains(e.target as Node)) {
        setShowPersonaDropdown(false)
      }
      if (fieldSuggestionRef.current && !fieldSuggestionRef.current.contains(e.target as Node)) {
        setActiveFieldSuggestion(null)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const filteredCachedEmails = useMemo(() => {
    if (!cachedEmails) return []
    if (!personaEmail.trim()) return cachedEmails
    const q = personaEmail.toLowerCase()
    return cachedEmails.filter(e => e.email.toLowerCase().includes(q))
  }, [cachedEmails, personaEmail])

  const handleExecuteTool = useCallback(async () => {
    if (!selectedTool || !activeServerId) return
    const toolIntent = getToolIntent(selectedTool)
    if (toolIntent === 'destructive' && !confirmDestructive) {
      toast('Confirm destructive action before executing this tool.')
      return
    }

    const resourceUri = getToolUiResourceUri(selectedTool)
    const startTime = Date.now()
    const abortController = new AbortController()
    executeAbortControllerRef.current = abortController

    try {
      const args = inputMode === 'json' ? JSON.parse(toolArgs) : formValues
      const persona = activeServer?.activePersona
      const result = await callToolMutation.mutateAsync({
        serverId: activeServerId,
        name: selectedTool.name,
        arguments: Object.keys(args).length > 0 ? args : undefined,
        personaEmail: persona?.email,
        signal: abortController.signal,
      })
      setToolResult(result)
      const parsed = parseMcpResult(result)
      setParsedResult(parsed)
      storeCachedToolResult(activeServerId, selectedTool.name, parsed)
      saveFieldValues(selectedTool.name, inputMode === 'form' ? formValues : {})

      useHistoryStore.getState().addEntry({
        serverId: activeServerId,
        toolName: selectedTool.name,
        args: Object.keys(args).length > 0 ? args : {},
        result: parsed,
        timestamp: startTime,
        durationMs: Date.now() - startTime,
        isError: parsed.isError,
      })

      if (resourceUri) {
        setResultViewMode('ui')
        fetchAppHtml(resourceUri)
      }
    } catch (error) {
      let parsedError: ParsedMcpResult
      if (abortController.signal.aborted) {
        const errorResult = { error: 'Execution cancelled by user' }
        setToolResult(errorResult)
        parsedError = {
          data: errorResult,
          rawText: JSON.stringify(errorResult, null, 2),
          isJson: true,
          isError: true,
          contentType: 'text',
        }
      } else if (error instanceof SyntaxError) {
        const errorResult = { error: 'Invalid JSON in arguments' }
        setToolResult(errorResult)
        parsedError = {
          data: errorResult,
          rawText: JSON.stringify(errorResult, null, 2),
          isJson: true,
          isError: true,
          contentType: 'text'
        }
      } else {
        const errorResult = {
          error: error instanceof Error ? error.message : 'Tool execution failed',
        }
        setToolResult(errorResult)
        parsedError = {
          data: errorResult,
          rawText: JSON.stringify(errorResult, null, 2),
          isJson: true,
          isError: true,
          contentType: 'text'
        }
      }
      setParsedResult(parsedError)

      let errorArgs: Record<string, unknown> = {}
      try { errorArgs = inputMode === 'json' ? JSON.parse(toolArgs) : formValues } catch { /* ignore */ }
      useHistoryStore.getState().addEntry({
        serverId: activeServerId,
        toolName: selectedTool.name,
        args: errorArgs,
        result: parsedError,
        timestamp: startTime,
        durationMs: Date.now() - startTime,
        isError: true,
      })
    } finally {
      if (executeAbortControllerRef.current === abortController) {
        executeAbortControllerRef.current = null
      }
    }
  }, [selectedTool, activeServerId, activeServer?.activePersona, confirmDestructive, inputMode, toolArgs, formValues, callToolMutation, fetchAppHtml])

  const handleCancelExecute = useCallback(() => {
    executeAbortControllerRef.current?.abort()
  }, [])

  const handleGeneratePayload = useCallback(async () => {
    if (!selectedTool || !activeServerId) return

    try {
      // Collect relevant cached results, prioritized by most recently executed
      let refPayload: Record<string, unknown> | undefined
      try {
        const stored = localStorage.getItem(TOOL_RESULTS_CACHE_KEY)
        if (stored) {
          const allCached = JSON.parse(stored)
          const serverCache = allCached[activeServerId] as Record<string, CachedToolEntry> | undefined
          if (serverCache) {
            const schemaFields = new Set(
              Object.keys(selectedTool.inputSchema.properties || {}).map(k => k.toLowerCase())
            )

            const hasRelevantKey = (obj: unknown): boolean => {
              if (!obj || typeof obj !== 'object') return false
              if (Array.isArray(obj)) return obj.some(hasRelevantKey)
              for (const key of Object.keys(obj as Record<string, unknown>)) {
                if (schemaFields.has(key.toLowerCase())) return true
                if (hasRelevantKey((obj as Record<string, unknown>)[key])) return true
              }
              return false
            }

            // Filter relevant entries, then sort by most recent first
            const relevant = Object.entries(serverCache)
              .filter(([toolName, entry]) => toolName !== selectedTool.name && entry?.data && hasRelevantKey(entry.data))
              .sort(([, a], [, b]) => (b._cachedAt || 0) - (a._cachedAt || 0))

            // Build payload from most recent first, respecting size limit
            if (relevant.length > 0) {
              const referenceData: Record<string, unknown> = {}
              let size = 2
              for (const [toolName, entry] of relevant) {
                const entryStr = JSON.stringify({ [toolName]: entry.data })
                if (size + entryStr.length > 50000) break
                referenceData[toolName] = entry.data
                size += entryStr.length
              }
              if (Object.keys(referenceData).length > 0) {
                refPayload = referenceData
              }
            }
          }
        }
      } catch {
        // Ignore localStorage errors
      }

      const result = await generatePayloadMutation.mutateAsync({
        toolName: selectedTool.name,
        toolDescription: selectedTool.description,
        inputSchema: selectedTool.inputSchema as Record<string, unknown>,
        referenceData: refPayload,
      })

      const generated = result.payload
      const jsonStr = JSON.stringify(generated, null, 2)
      setToolArgs(jsonStr)

      const newFormValues: Record<string, string> = {}
      Object.entries(generated).forEach(([k, v]) => {
        if (typeof v === 'object' && v !== null) {
          newFormValues[k] = JSON.stringify(v, null, 2)
        } else {
          newFormValues[k] = String(v)
        }
      })
      setFormValues(newFormValues)

      toast('Payload generated with reference data')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Generation failed'
      toast(`AI generation failed: ${message}`, 3000)
    }
  }, [selectedTool, activeServerId, generatePayloadMutation])

  const handleCallToolFromApp = useCallback(async (name: string, args?: Record<string, unknown>) => {
    if (!activeServerId) throw new Error('No server connected')
    const persona = activeServer?.activePersona
    return await callToolMutation.mutateAsync({
      serverId: activeServerId,
      name,
      arguments: args,
      personaEmail: persona?.email,
    })
  }, [activeServerId, activeServer?.activePersona, callToolMutation])

  const handleReadResourceFromApp = useCallback(async (uri: string) => {
    if (!activeServerId) throw new Error('No server connected')
    return await readResourceMutation.mutateAsync({
      serverId: activeServerId,
      uri,
    })
  }, [activeServerId, readResourceMutation])

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
      copyToClipboard(parsedResult.isJson ? JSON.stringify(parsedResult.data, null, 2) : parsedResult.rawText, 'Result')
    } else if (toolResult) {
      copyToClipboard(JSON.stringify(toolResult, null, 2), 'Result')
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
    try {
      const jsonObj: Record<string, unknown> = {}
      const props = selectedTool?.inputSchema.properties || {}
      Object.entries(newValues).forEach(([k, v]) => {
        const prop = props[k] as { type?: string } | undefined
        if (prop?.type === 'number' || prop?.type === 'integer') {
          jsonObj[k] = Number(v) || 0
        } else if (prop?.type === 'boolean') {
          jsonObj[k] = v === 'true'
        } else if (prop?.type === 'object' || prop?.type === 'array') {
          try {
            jsonObj[k] = JSON.parse(v)
          } catch {
            jsonObj[k] = v
          }
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

  const showPersonaBar = activeServer?.config.oauth?.enabled && isConnected &&
    (activeServer.config.type === 'streamable-http' || activeServer.config.type === 'sse')

  return (
    <div className="h-full p-2.5 flex flex-col gap-2">
      {/* Global Persona Bar */}
      {showPersonaBar && (
        <div className="flex-shrink-0 rounded-xl border border-border/70 bg-muted/20 px-3 py-2.5">
          {activeServer.activePersona ? (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="flex items-center justify-center h-7 w-7 rounded-full bg-primary/10">
                  <UserRound className="h-4 w-4 text-primary" />
                </div>
                {activeServer.activePersona.actorEmail && (
                  <Badge variant="outline" className="text-sm px-3 py-0.5 font-normal bg-white text-black border-white/80">
                    {activeServer.activePersona.actorEmail}
                  </Badge>
                )}
                <span className="text-sm text-muted-foreground">impersonating</span>
                <Badge className="text-sm px-3 py-0.5 font-normal bg-emerald-600 hover:bg-emerald-600 text-white border-emerald-600">
                  {activeServer.activePersona.email}
                </Badge>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs px-3"
                onClick={handleClearPersona}
              >
                <X className="h-3 w-3 mr-1" />
                Clear Persona
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-2" ref={personaDropdownRef}>
              <div className="flex items-center justify-center h-7 w-7 rounded-full bg-muted flex-shrink-0">
                <UserRound className="h-4 w-4 text-muted-foreground" />
              </div>
              <span className="text-sm text-muted-foreground flex-shrink-0">Impersonate</span>
              <div className="relative w-72 min-w-[12rem] max-w-full shrink-0">
                <Input
                  placeholder="Enter target user email..."
                  value={personaEmail}
                  autoComplete="off"
                  data-bwignore="true"
                  data-lpignore="true"
                  data-1p-ignore="true"
                  onChange={(e) => {
                    setPersonaEmail(e.target.value)
                    setShowPersonaDropdown(true)
                  }}
                  onFocus={() => setShowPersonaDropdown(true)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && personaEmail.trim()) {
                      e.preventDefault()
                      handleTokenExchange()
                    }
                    if (e.key === 'Escape') {
                      setShowPersonaDropdown(false)
                    }
                  }}
                  className="h-8 text-sm"
                />
                {showPersonaDropdown && filteredCachedEmails.length > 0 && (
                  <div className="absolute top-full left-0 right-0 mt-1 z-50 bg-popover border border-border rounded-md shadow-lg max-h-48 overflow-auto">
                    {filteredCachedEmails.map((entry) => (
                      <div
                        key={entry.email}
                        className="flex items-center justify-between px-3 py-2 hover:bg-muted cursor-pointer group"
                      >
                        <button
                          className="flex-1 text-left text-sm truncate"
                          onClick={() => {
                            setPersonaEmail(entry.email)
                            setShowPersonaDropdown(false)
                          }}
                        >
                          {entry.email}
                        </button>
                        <button
                          className="ml-2 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                          onClick={(e) => {
                            e.stopPropagation()
                            deletePersonaEmailMutation.mutate(entry.email)
                          }}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <Button
                size="sm"
                className="h-8 text-sm px-4"
                disabled={!personaEmail.trim() || tokenExchangeMutation.isPending}
                onClick={handleTokenExchange}
              >
                {tokenExchangeMutation.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                ) : (
                  <UserRound className="h-3.5 w-3.5 mr-1.5" />
                )}
                Exchange Token
              </Button>
            </div>
          )}
          {tokenExchangeMutation.isError && (
            <p className="text-xs text-destructive mt-1.5 ml-10">
              {tokenExchangeMutation.error?.message || 'Token exchange failed'}
            </p>
          )}
        </div>
      )}

      <PanelGroup direction="horizontal" className="flex-1 min-h-0">
        {/* Tools List Panel */}
        <Panel defaultSize={25} minSize={15} maxSize={40}>
          <Card variant="panel" className="h-full flex flex-col">
            <CardHeader className="flex-shrink-0 space-y-1.5 p-4 pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
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
              <ScrollArea className="h-full px-3 pb-3">
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
                          'p-2.5 rounded-lg border cursor-pointer transition-all',
                          selectedTool?.name === tool.name
                            ? 'border-primary/60 bg-primary/10 shadow-[0_12px_30px_-22px_hsl(var(--primary)/0.9)]'
                            : 'border-border/70 hover:border-primary/50 hover:bg-muted/35'
                        )}
                        onClick={() => setSelectedTool(tool)}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <p className="font-medium font-mono text-sm truncate">
                                {getToolTitle(tool)}
                              </p>
                              {(() => {
                                const intent = getToolIntent(tool)
                                if (intent === 'read') {
                                  return (
                                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4 flex-shrink-0 bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                                      <Eye className="h-2.5 w-2.5 mr-0.5" />
                                      READ
                                    </Badge>
                                  )
                                }
                                if (intent === 'destructive') {
                                  return (
                                    <Badge variant="destructive" className="text-[10px] px-1.5 py-0 h-4 flex-shrink-0">
                                      <TriangleAlert className="h-2.5 w-2.5 mr-0.5" />
                                      DESTRUCTIVE
                                    </Badge>
                                  )
                                }
                                return (
                                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 flex-shrink-0">
                                    <Pencil className="h-2.5 w-2.5 mr-0.5" />
                                    WRITE
                                  </Badge>
                                )
                              })()}
                              {getToolUiResourceUri(tool) && (
                                <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4 flex-shrink-0 bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300">
                                  <Layout className="h-2.5 w-2.5 mr-0.5" />
                                  UI
                                </Badge>
                              )}
                              {tool.annotations?.idempotentHint && (
                                <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 flex-shrink-0">
                                  IDEMPOTENT
                                </Badge>
                              )}
                              {tool.annotations?.openWorldHint && (
                                <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 flex-shrink-0">
                                  OPEN-WORLD
                                </Badge>
                              )}
                            </div>
                            {tool.description && (
                              <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                                {tool.description}
                              </p>
                            )}
                          </div>
                        </div>
                        
                        {/* Schema toggle */}
                        <div className="flex items-center gap-1 mt-2">
                          <button
                            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
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
                            <button
                              className="ml-auto p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                              title="Expand schema"
                              onClick={(e) => {
                                e.stopPropagation()
                                setSchemaDialogTool(tool)
                              }}
                            >
                              <Expand className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                        
                        {expandedSchemas.has(tool.name) && (
                          <div className="mt-2 h-32">
                            <JsonEditor
                              value={JSON.stringify(tool.inputSchema, null, 2)}
                              readOnly
                              height="100%"
                            />
                          </div>
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
        <PanelResizeHandle className="w-1.5 mx-0.5 flex items-center justify-center group">
          <div className="w-0.5 h-7 rounded-full bg-border group-hover:bg-primary/50 transition-colors" />
        </PanelResizeHandle>

        {/* Tool Execution Panel */}
        <Panel defaultSize={75} minSize={40}>
          <div className="h-full flex flex-col">
            <PanelGroup direction="vertical" className="h-full" key={showHistory ? 'with-history' : 'no-history'}>
              {/* Arguments Editor */}
              <Panel defaultSize={showHistory ? 35 : 50} minSize={20}>
                <Card variant="panel" className="h-full flex flex-col">
                  <CardHeader className="flex-shrink-0 space-y-1 p-4 pb-2">
                    <div className="flex items-center justify-between gap-2">
                      <CardTitle className="text-base">
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
                          <div className="flex items-center border border-border/70 rounded-md p-0.5 bg-muted/20">
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
                        {selectedTool && (
                          <Button
                            variant="outline"
                            onClick={handleGeneratePayload}
                            disabled={generatePayloadMutation.isPending}
                            title="Generate sample payload using AI"
                          >
                            {generatePayloadMutation.isPending ? (
                              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            ) : (
                              <Sparkles className="h-4 w-4 mr-2" />
                            )}
                            AI Fill
                          </Button>
                        )}
                        {selectedTool && (
                          <Button
                            variant={showHistory ? 'secondary' : 'ghost'}
                            size="sm"
                            onClick={() => setShowHistory(prev => !prev)}
                            title="Execution history"
                          >
                            <Clock className="h-4 w-4" />
                          </Button>
                        )}
                        <Button
                          onClick={callToolMutation.isPending ? handleCancelExecute : handleExecuteTool}
                          disabled={!selectedTool}
                          title="Execute (⌘+Enter)"
                          variant={callToolMutation.isPending ? 'destructive' : 'default'}
                        >
                          {callToolMutation.isPending ? (
                            <>
                              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                              Cancel
                            </>
                          ) : (
                            <>
                              <Play className="h-4 w-4 mr-2" />
                              Execute
                            </>
                          )}
                        </Button>
                      </div>
                    </div>
                    {selectedTool?.description && (
                      <p className="text-sm text-muted-foreground">
                        {selectedTool.description}
                      </p>
                    )}
                    {selectedTool && (
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant={getToolIntent(selectedTool) === 'destructive' ? 'destructive' : getToolIntent(selectedTool) === 'read' ? 'secondary' : 'outline'}>
                          {getToolIntent(selectedTool) === 'destructive' ? 'Destructive Tool' : getToolIntent(selectedTool) === 'read' ? 'Read-only Tool' : 'Write Tool'}
                        </Badge>
                        {selectedTool.annotations?.idempotentHint && (
                          <Badge variant="outline">Idempotent</Badge>
                        )}
                        {selectedTool.annotations?.openWorldHint && (
                          <Badge variant="outline">Open world</Badge>
                        )}
                        {selectedTool.annotations?.destructiveHint && (
                          <label className="flex items-center gap-2 text-xs text-destructive">
                            <input
                              type="checkbox"
                              checked={confirmDestructive}
                              onChange={(e) => setConfirmDestructive(e.target.checked)}
                              className="h-3.5 w-3.5 rounded border-border cursor-pointer accent-destructive"
                            />
                            I confirm this destructive action
                          </label>
                        )}
                      </div>
                    )}

                  </CardHeader>
                  <CardContent className="flex-1 overflow-hidden min-h-0 p-4 pt-0">
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
                          <div className="space-y-3 pr-2">
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
                                    {prop.type === 'object' || prop.type === 'array' ? (
                                      <div className="relative">
                                        <div className="h-36">
                                          <JsonEditor
                                            value={formValues[key] || (prop.type === 'array' ? '[]' : '{}')}
                                            onChange={(val) => updateFormValue(key, val)}
                                            height="100%"
                                          />
                                        </div>
                                        <button
                                          className="absolute top-1 right-1 z-10 p-1 rounded bg-background/80 border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                                          title={`Expand ${key}`}
                                          onClick={() => setExpandedFieldKey(key)}
                                        >
                                          <Expand className="h-3.5 w-3.5" />
                                        </button>
                                      </div>
                                    ) : (
                                      <div className="relative" ref={activeFieldSuggestion === key ? fieldSuggestionRef : undefined}>
                                        <Input
                                          value={formValues[key] || ''}
                                          onChange={(e) => {
                                            updateFormValue(key, e.target.value)
                                            setActiveFieldSuggestion(key)
                                          }}
                                          onFocus={() => setActiveFieldSuggestion(key)}
                                          onKeyDown={(e) => {
                                            if (e.key === 'Escape') setActiveFieldSuggestion(null)
                                          }}
                                          placeholder={`Enter ${key}`}
                                          autoComplete="off"
                                          data-bwignore="true"
                                          data-lpignore="true"
                                          data-1p-ignore="true"
                                        />
                                        {activeFieldSuggestion === key && selectedTool && (() => {
                                          const suggestions = getFieldSuggestions(selectedTool.name, key)
                                          const currentVal = (formValues[key] || '').toLowerCase()
                                          const filtered = suggestions.filter(s =>
                                            s.toLowerCase().includes(currentVal) && s !== formValues[key]
                                          )
                                          if (filtered.length === 0) return null
                                          return (
                                            <div className="absolute top-full left-0 right-0 mt-1 z-50 bg-popover border border-border rounded-md shadow-lg max-h-40 overflow-auto">
                                              {filtered.map((suggestion, i) => (
                                                <button
                                                  key={i}
                                                  className="w-full text-left px-3 py-1.5 text-sm hover:bg-muted cursor-pointer truncate"
                                                  onClick={() => {
                                                    updateFormValue(key, suggestion)
                                                    setActiveFieldSuggestion(null)
                                                  }}
                                                >
                                                  {suggestion}
                                                </button>
                                              ))}
                                            </div>
                                          )
                                        })()}
                                      </div>
                                    )}
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
              <Panel defaultSize={showHistory ? 35 : 50} minSize={20}>
                <Card variant="panel" className="h-full flex flex-col">
                  <CardHeader className="flex-shrink-0 p-4 pb-2">
                    <div className="flex items-center justify-between gap-2">
                      <CardTitle className="text-base flex items-center gap-2">
                        Result
                        {(callToolMutation.isPending || isLoadingAppHtml) && (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        )}
                      </CardTitle>
                      <div className="flex items-center gap-2">
                        {isAppTool && parsedResult && (
                          <div className="flex items-center border border-border/70 rounded-md p-0.5 bg-muted/20">
                            <button
                              className={cn(
                                'px-2 py-1 text-xs rounded transition-colors flex items-center gap-1',
                                resultViewMode === 'ui'
                                  ? 'bg-primary text-primary-foreground'
                                  : 'hover:bg-muted'
                              )}
                              onClick={() => setResultViewMode('ui')}
                            >
                              <Layout className="h-3 w-3" />
                              UI
                            </button>
                            <button
                              className={cn(
                                'px-2 py-1 text-xs rounded transition-colors flex items-center gap-1',
                                resultViewMode === 'json'
                                  ? 'bg-primary text-primary-foreground'
                                  : 'hover:bg-muted'
                              )}
                              onClick={() => setResultViewMode('json')}
                            >
                              <Code className="h-3 w-3" />
                              JSON
                            </button>
                          </div>
                        )}
                        {parsedResult && resultViewMode === 'json' && (
                          <Button variant="ghost" size="sm" onClick={handleCopyResult}>
                            <Copy className="h-4 w-4 mr-1" />
                            Copy
                          </Button>
                        )}
                        {(parsedResult || (resultViewMode === 'ui' && appHtml)) && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setResultExpanded(true)}
                            title="Expand result"
                          >
                            <Expand className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="flex-1 overflow-hidden min-h-0 p-4 pt-0">
                    {resultViewMode === 'ui' && appHtml ? (
                      <div className="h-full">
                        <McpAppViewer
                          html={appHtml}
                          toolName={selectedTool?.name || ''}
                          tool={selectedTool || undefined}
                          toolArgs={(() => {
                            try {
                              return inputMode === 'json' ? JSON.parse(toolArgs) : formValues
                            } catch {
                              return formValues
                            }
                          })()}
                          toolResult={toolResult}
                          onCallTool={handleCallToolFromApp}
                          onReadResource={handleReadResourceFromApp}
                        />
                      </div>
                    ) : parsedResult ? (
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

              {/* History Panel */}
              {showHistory && selectedTool && activeServerId && (
                <>
                  <PanelResizeHandle className="h-2 my-1 flex items-center justify-center group">
                    <GripHorizontal className="h-4 w-4 text-muted-foreground group-hover:text-primary/50 transition-colors" />
                  </PanelResizeHandle>
                  <Panel defaultSize={30} minSize={15}>
                    <Card variant="subpanel" className="h-full flex flex-col">
                      <ToolHistoryPanel
                        serverId={activeServerId}
                        toolName={selectedTool.name}
                        onLoadArgs={(args) => {
                          setToolArgs(JSON.stringify(args, null, 2))
                          setFormValues(argsToFormValues(args))
                        }}
                        onReplay={(args) => {
                          setToolArgs(JSON.stringify(args, null, 2))
                          setFormValues(argsToFormValues(args))
                          setTimeout(() => handleExecuteTool(), 0)
                        }}
                      />
                    </Card>
                  </Panel>
                </>
              )}
            </PanelGroup>
          </div>
        </Panel>
      </PanelGroup>

      {/* Schema Expand Dialog */}
      <Dialog open={!!schemaDialogTool} onOpenChange={(open) => { if (!open) setSchemaDialogTool(null) }}>
        <DialogContent className="max-w-4xl w-[90vw] h-[80vh] flex flex-col p-0 overflow-hidden">
          <DialogHeader className="px-6 pt-6 pb-3 flex-shrink-0">
            <DialogTitle className="flex items-center gap-2 font-mono text-base">
              <Code className="h-4 w-4" />
              {schemaDialogTool?.name}
              <Badge variant="outline" className="text-xs font-sans">Input Schema</Badge>
            </DialogTitle>
            {schemaDialogTool?.description && (
              <p className="text-sm text-muted-foreground mt-1">{schemaDialogTool.description}</p>
            )}
          </DialogHeader>
          <div className="flex-1 min-h-0 px-6 pb-6">
            {schemaDialogTool && (
              <JsonEditor
                value={JSON.stringify(schemaDialogTool.inputSchema, null, 2)}
                readOnly
                height="100%"
              />
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Field Editor Dialog */}
      <Dialog open={!!expandedFieldKey} onOpenChange={(open) => { if (!open) setExpandedFieldKey(null) }}>
        <DialogContent className="max-w-5xl w-[90vw] h-[85vh] flex flex-col p-0 overflow-hidden">
          <DialogHeader className="px-6 pt-5 pb-3 flex-shrink-0 border-b border-border">
            {(() => {
              const fieldSchema = expandedFieldKey
                ? selectedTool?.inputSchema.properties?.[expandedFieldKey] as { type?: string; description?: string } | undefined
                : undefined
              return (
                <>
                  <DialogTitle className="flex items-center gap-2 text-base">
                    <Code className="h-4 w-4" />
                    <span className="font-mono">{expandedFieldKey}</span>
                    {fieldSchema?.type && (
                      <Badge variant="outline" className="text-xs font-sans">{fieldSchema.type}</Badge>
                    )}
                  </DialogTitle>
                  {fieldSchema?.description && (
                    <p className="text-sm text-muted-foreground mt-1">{fieldSchema.description}</p>
                  )}
                </>
              )
            })()}
          </DialogHeader>
          <div className="flex-1 min-h-0 px-6 pb-6 pt-3">
            {expandedFieldKey && (
              <JsonEditor
                value={formValues[expandedFieldKey] || '{}'}
                onChange={(val) => updateFormValue(expandedFieldKey, val)}
                height="100%"
              />
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Result Expand Dialog */}
      <Dialog open={resultExpanded} onOpenChange={setResultExpanded}>
        <DialogContent className="max-w-[95vw] w-[95vw] h-[92vh] flex flex-col p-0 overflow-hidden">
          <DialogHeader className="px-6 pt-5 pb-3 flex-shrink-0 border-b border-border">
            <div className="flex items-center justify-between">
              <DialogTitle className="flex items-center gap-2 text-base">
                Result
                {selectedTool && (
                  <Badge variant="outline" className="text-xs font-mono">{selectedTool.name}</Badge>
                )}
              </DialogTitle>
              <div className="flex items-center gap-2 mr-8">
                {isAppTool && parsedResult && (
                  <div className="flex items-center border rounded-md p-0.5">
                    <button
                      className={cn(
                        'px-2 py-1 text-xs rounded transition-colors flex items-center gap-1',
                        resultViewMode === 'ui'
                          ? 'bg-primary text-primary-foreground'
                          : 'hover:bg-muted'
                      )}
                      onClick={() => setResultViewMode('ui')}
                    >
                      <Layout className="h-3 w-3" />
                      UI
                    </button>
                    <button
                      className={cn(
                        'px-2 py-1 text-xs rounded transition-colors flex items-center gap-1',
                        resultViewMode === 'json'
                          ? 'bg-primary text-primary-foreground'
                          : 'hover:bg-muted'
                      )}
                      onClick={() => setResultViewMode('json')}
                    >
                      <Code className="h-3 w-3" />
                      JSON
                    </button>
                  </div>
                )}
                {parsedResult && resultViewMode === 'json' && (
                  <Button variant="ghost" size="sm" onClick={handleCopyResult}>
                    <Copy className="h-4 w-4 mr-1" />
                    Copy
                  </Button>
                )}
              </div>
            </div>
          </DialogHeader>
          <div className="flex-1 min-h-0">
            {resultViewMode === 'ui' && appHtml ? (
              <McpAppViewer
                html={appHtml}
                toolName={selectedTool?.name || ''}
                tool={selectedTool || undefined}
                toolArgs={(() => {
                  try {
                    return inputMode === 'json' ? JSON.parse(toolArgs) : formValues
                  } catch {
                    return formValues
                  }
                })()}
                toolResult={toolResult}
                onCallTool={handleCallToolFromApp}
                onReadResource={handleReadResourceFromApp}
              />
            ) : parsedResult ? (
              <div className="h-full px-6 pb-6 pt-3">
                <JsonEditor
                  value={parsedResult.isJson ? JSON.stringify(parsedResult.data, null, 2) : parsedResult.rawText}
                  onChange={() => {}}
                  height="100%"
                  readOnly
                />
              </div>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
