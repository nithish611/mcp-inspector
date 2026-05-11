import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useTools, type Tool } from '@/hooks/useApi'
import { toast } from '@/lib/toast'
import { cn, parseMcpResult, type ParsedMcpResult } from '@/lib/utils'
import { useEnvironmentStore } from '@/stores/environmentStore'
import { useHistoryStore } from '@/stores/historyStore'
import { useServersStore } from '@/stores/serversStore'
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Layers,
  Loader2,
  Pause,
  Play,
  Plus,
  Trash2,
  X,
} from 'lucide-react'
import { useCallback, useRef, useState } from 'react'

interface BatchStep {
  id: string
  toolName: string
  args: string
  status: 'pending' | 'running' | 'success' | 'error' | 'skipped'
  result?: ParsedMcpResult
  durationMs?: number
  error?: string
}

type ExecutionMode = 'sequential' | 'parallel'

function generateId() {
  return Math.random().toString(36).substring(2, 10)
}

function fetchApi<T>(path: string, options?: RequestInit): Promise<T> {
  const base = window.location.origin.replace(/:\d+$/, ':3000')
  return fetch(`${base}/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  }).then(async (res) => {
    if (!res.ok) throw new Error(await res.text())
    return res.json()
  })
}

export function BatchExecution() {
  const { activeServerId } = useServersStore()
  const activeServer = useServersStore((s) => s.getActiveServer())
  const { data: tools = [] } = useTools(activeServerId || undefined)

  const [steps, setSteps] = useState<BatchStep[]>([])
  const [mode, setMode] = useState<ExecutionMode>('sequential')
  const [isRunning, setIsRunning] = useState(false)
  const [showToolPicker, setShowToolPicker] = useState(false)
  const [toolSearch, setToolSearch] = useState('')
  const [expandedStep, setExpandedStep] = useState<string | null>(null)
  const [continueOnError, setContinueOnError] = useState(true)
  const abortRef = useRef(false)

  const filteredTools = tools.filter((t) =>
    t.name.toLowerCase().includes(toolSearch.toLowerCase())
  )

  const addStep = (tool: Tool) => {
    const defaultArgs: Record<string, string> = {}
    if (tool.inputSchema.properties) {
      for (const key of Object.keys(tool.inputSchema.properties)) {
        defaultArgs[key] = ''
      }
    }
    setSteps((prev) => [
      ...prev,
      {
        id: generateId(),
        toolName: tool.name,
        args: JSON.stringify(defaultArgs, null, 2),
        status: 'pending',
      },
    ])
    setShowToolPicker(false)
    setToolSearch('')
  }

  const removeStep = (id: string) => {
    setSteps((prev) => prev.filter((s) => s.id !== id))
  }

  const updateStepArgs = (id: string, args: string) => {
    setSteps((prev) => prev.map((s) => (s.id === id ? { ...s, args } : s)))
  }

  const resetSteps = () => {
    setSteps((prev) => prev.map((s) => ({ ...s, status: 'pending' as const, result: undefined, durationMs: undefined, error: undefined })))
  }

  const executeStep = async (step: BatchStep): Promise<BatchStep> => {
    if (!activeServerId) throw new Error('No active server')
    const substituteVariables = useEnvironmentStore.getState().substituteVariables
    const startTime = Date.now()
    try {
      const parsedArgs = JSON.parse(substituteVariables(step.args))
      const persona = activeServer?.activePersona
      const result = await fetchApi<unknown>('/tools/call', {
        method: 'POST',
        body: JSON.stringify({
          serverId: activeServerId,
          name: step.toolName,
          arguments: Object.keys(parsedArgs).length > 0 ? parsedArgs : undefined,
          personaEmail: persona?.email,
        }),
      })
      const parsed = parseMcpResult(result)
      const durationMs = Date.now() - startTime

      useHistoryStore.getState().addEntry({
        serverId: activeServerId,
        toolName: step.toolName,
        args: parsedArgs,
        result: parsed,
        timestamp: startTime,
        durationMs,
        isError: parsed.isError,
      })

      return { ...step, status: 'success', result: parsed, durationMs }
    } catch (error) {
      const durationMs = Date.now() - startTime
      const errMsg = error instanceof Error ? error.message : 'Execution failed'
      const parsed: ParsedMcpResult = {
        data: { error: errMsg },
        rawText: JSON.stringify({ error: errMsg }, null, 2),
        isJson: true,
        isError: true,
        contentType: 'text',
      }
      return { ...step, status: 'error', result: parsed, durationMs, error: errMsg }
    }
  }

  const handleExecute = useCallback(async () => {
    if (!activeServerId || steps.length === 0) return
    setIsRunning(true)
    abortRef.current = false
    resetSteps()

    if (mode === 'sequential') {
      for (let i = 0; i < steps.length; i++) {
        if (abortRef.current) {
          setSteps((prev) => prev.map((s, idx) => idx >= i ? { ...s, status: 'skipped' } : s))
          break
        }
        setSteps((prev) => prev.map((s, idx) => idx === i ? { ...s, status: 'running' } : s))
        const result = await executeStep(steps[i])
        setSteps((prev) => prev.map((s, idx) => idx === i ? result : s))
        if (result.status === 'error' && !continueOnError) {
          setSteps((prev) => prev.map((s, idx) => idx > i ? { ...s, status: 'skipped' } : s))
          break
        }
      }
    } else {
      setSteps((prev) => prev.map((s) => ({ ...s, status: 'running' as const })))
      const results = await Promise.all(steps.map((step) => executeStep(step)))
      setSteps(results)
    }

    setIsRunning(false)
    toast('Batch execution complete')
  }, [activeServerId, steps, mode, continueOnError])

  const handleStop = () => {
    abortRef.current = true
  }

  const totalDuration = steps.reduce((sum, s) => sum + (s.durationMs || 0), 0)
  const successCount = steps.filter((s) => s.status === 'success').length
  const errorCount = steps.filter((s) => s.status === 'error').length

  if (!activeServerId) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center text-muted-foreground">
          <Layers className="h-10 w-10 mx-auto mb-3 opacity-40" />
          <p className="text-sm">Connect to a server to use batch execution</p>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col p-4 gap-4">
      {/* Header Controls */}
      <div className="flex items-center justify-between gap-3 flex-shrink-0">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-semibold flex items-center gap-2">
            <Layers className="h-4 w-4" />
            Batch Execution
          </h2>
          {steps.length > 0 && (
            <Badge variant="secondary" className="text-xs">
              {steps.length} step{steps.length !== 1 ? 's' : ''}
            </Badge>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Mode Toggle */}
          <div className="flex items-center border border-border/70 rounded-md p-0.5 bg-muted/20">
            <button
              className={cn(
                'px-2.5 py-1 text-xs rounded transition-colors',
                mode === 'sequential' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'
              )}
              onClick={() => setMode('sequential')}
              disabled={isRunning}
            >
              Sequential
            </button>
            <button
              className={cn(
                'px-2.5 py-1 text-xs rounded transition-colors',
                mode === 'parallel' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'
              )}
              onClick={() => setMode('parallel')}
              disabled={isRunning}
            >
              Parallel
            </button>
          </div>

          {/* Continue on Error */}
          {mode === 'sequential' && (
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
              <input
                type="checkbox"
                checked={continueOnError}
                onChange={(e) => setContinueOnError(e.target.checked)}
                disabled={isRunning}
                className="rounded border-border"
              />
              Continue on error
            </label>
          )}

          {/* Execute / Stop */}
          {isRunning ? (
            <Button variant="destructive" size="sm" onClick={handleStop} className="gap-1">
              <Pause className="h-3.5 w-3.5" />
              Stop
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={handleExecute}
              disabled={steps.length === 0}
              className="gap-1"
            >
              <Play className="h-3.5 w-3.5" />
              Run All
            </Button>
          )}
        </div>
      </div>

      {/* Summary Bar */}
      {steps.some((s) => s.status !== 'pending') && (
        <div className="flex items-center gap-4 text-xs text-muted-foreground flex-shrink-0 px-1">
          {successCount > 0 && (
            <span className="flex items-center gap-1 text-green-600 dark:text-green-400">
              <CheckCircle2 className="h-3.5 w-3.5" /> {successCount} passed
            </span>
          )}
          {errorCount > 0 && (
            <span className="flex items-center gap-1 text-destructive">
              <AlertCircle className="h-3.5 w-3.5" /> {errorCount} failed
            </span>
          )}
          {totalDuration > 0 && (
            <span className="flex items-center gap-1">
              <Clock className="h-3.5 w-3.5" />
              Total: {totalDuration >= 1000 ? `${(totalDuration / 1000).toFixed(2)}s` : `${totalDuration}ms`}
            </span>
          )}
        </div>
      )}

      {/* Steps List */}
      <ScrollArea className="flex-1">
        <div className="space-y-2 pr-2">
          {steps.map((step, index) => (
            <Card
              key={step.id}
              variant="panel"
              className={cn(
                'transition-colors',
                step.status === 'running' && 'border-primary/50',
                step.status === 'success' && 'border-green-500/30',
                step.status === 'error' && 'border-destructive/30',
              )}
            >
              <CardHeader className="p-3 pb-0">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground font-mono w-5">{index + 1}.</span>
                    <StatusIcon status={step.status} />
                    <span className="text-sm font-medium font-mono">{step.toolName}</span>
                    {step.durationMs !== undefined && (
                      <span className="text-[10px] text-muted-foreground border border-border rounded px-1.5 py-0.5">
                        {step.durationMs >= 1000 ? `${(step.durationMs / 1000).toFixed(2)}s` : `${step.durationMs}ms`}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={() => setExpandedStep(expandedStep === step.id ? null : step.id)}
                    >
                      {expandedStep === step.id ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 text-destructive/70 hover:text-destructive"
                      onClick={() => removeStep(step.id)}
                      disabled={isRunning}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </CardHeader>

              {expandedStep === step.id && (
                <CardContent className="p-3 pt-2">
                  <div className="space-y-2">
                    <div>
                      <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Arguments (JSON)</label>
                      <textarea
                        className="w-full mt-1 rounded-md border border-border bg-muted/30 p-2 text-xs font-mono resize-y min-h-[60px] focus:outline-none focus:ring-1 focus:ring-ring"
                        value={step.args}
                        onChange={(e) => updateStepArgs(step.id, e.target.value)}
                        disabled={isRunning}
                        spellCheck={false}
                      />
                    </div>
                    {step.result && (
                      <div>
                        <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Result</label>
                        <pre className={cn(
                          'mt-1 rounded-md border p-2 text-xs font-mono overflow-auto max-h-48',
                          step.result.isError
                            ? 'border-destructive/30 bg-destructive/5'
                            : 'border-border bg-muted/30'
                        )}>
                          {step.result.rawText}
                        </pre>
                      </div>
                    )}
                  </div>
                </CardContent>
              )}
            </Card>
          ))}

          {/* Add Step Button */}
          <div className="relative">
            <Button
              variant="outline"
              size="sm"
              className="w-full border-dashed gap-1.5"
              onClick={() => setShowToolPicker(!showToolPicker)}
              disabled={isRunning}
            >
              <Plus className="h-3.5 w-3.5" />
              Add Tool Step
            </Button>

            {showToolPicker && (
              <div className="absolute top-full left-0 right-0 mt-1 z-50 bg-popover border border-border rounded-lg shadow-lg">
                <div className="p-2 border-b border-border">
                  <Input
                    placeholder="Search tools..."
                    className="h-7 text-xs"
                    value={toolSearch}
                    onChange={(e) => setToolSearch(e.target.value)}
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') setShowToolPicker(false)
                    }}
                  />
                </div>
                <ScrollArea className="max-h-56">
                  <div className="p-1">
                    {filteredTools.length === 0 ? (
                      <p className="text-xs text-muted-foreground text-center py-3">No tools found</p>
                    ) : (
                      filteredTools.map((tool) => (
                        <button
                          key={tool.name}
                          className="w-full text-left px-3 py-2 text-sm hover:bg-muted rounded-md cursor-pointer flex items-center justify-between"
                          onClick={() => addStep(tool)}
                        >
                          <span className="font-mono text-xs">{tool.name}</span>
                          {tool.annotations?.readOnlyHint && (
                            <Badge variant="secondary" className="text-[9px] h-4">read-only</Badge>
                          )}
                        </button>
                      ))
                    )}
                  </div>
                </ScrollArea>
              </div>
            )}
          </div>
        </div>
      </ScrollArea>
    </div>
  )
}

function StatusIcon({ status }: { status: BatchStep['status'] }) {
  switch (status) {
    case 'pending':
      return <div className="h-4 w-4 rounded-full border-2 border-muted-foreground/30" />
    case 'running':
      return <Loader2 className="h-4 w-4 animate-spin text-primary" />
    case 'success':
      return <CheckCircle2 className="h-4 w-4 text-green-500" />
    case 'error':
      return <AlertCircle className="h-4 w-4 text-destructive" />
    case 'skipped':
      return <X className="h-4 w-4 text-muted-foreground" />
  }
}
