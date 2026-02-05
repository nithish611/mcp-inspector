import { JsonEditor } from '@/components/JsonEditor'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useGetPrompt, usePrompts, type Prompt } from '@/hooks/useApi'
import { cn, copyToClipboard, parseMcpResult, type ParsedMcpResult } from '@/lib/utils'
import { useConnectionStore } from '@/stores/connectionStore'
import { useServersStore } from '@/stores/serversStore'
import {
    AlertCircle,
    Copy,
    GripHorizontal,
    Loader2,
    MessageSquare,
    RefreshCw,
    Send,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'

export function PromptsTab() {
  // Use serversStore for new UI, fallback to connectionStore for backward compatibility
  const { getActiveServer, activeServerId } = useServersStore()
  const { status: legacyStatus } = useConnectionStore()
  const activeServer = getActiveServer()
  const status = activeServer?.status || legacyStatus
  const { data: prompts, isLoading, refetch, error } = usePrompts(activeServerId || undefined)
  const getPromptMutation = useGetPrompt()

  const [selectedPrompt, setSelectedPrompt] = useState<Prompt | null>(null)
  const [promptArgs, setPromptArgs] = useState<Record<string, string>>({})
  const [promptResult, setPromptResult] = useState<ParsedMcpResult | null>(null)
  const [showRawResult, setShowRawResult] = useState(false)

  useEffect(() => {
    if (status.connected && status.capabilities?.prompts) {
      refetch()
    }
  }, [status.connected, status.capabilities?.prompts, refetch])

  useEffect(() => {
    if (selectedPrompt) {
      // Initialize arguments with empty strings
      const initialArgs: Record<string, string> = {}
      selectedPrompt.arguments?.forEach((arg) => {
        initialArgs[arg.name] = ''
      })
      setPromptArgs(initialArgs)
      setPromptResult(null)
    }
  }, [selectedPrompt])

  const handleGetPrompt = async () => {
    if (!selectedPrompt || !activeServerId) return

    try {
      // Filter out empty arguments
      const filteredArgs: Record<string, string> = {}
      Object.entries(promptArgs).forEach(([key, value]) => {
        if (value.trim()) {
          filteredArgs[key] = value
        }
      })

      const result = await getPromptMutation.mutateAsync({
        serverId: activeServerId,
        name: selectedPrompt.name,
        arguments: Object.keys(filteredArgs).length > 0 ? filteredArgs : undefined,
      })
      const parsed = parseMcpResult(result)
      setPromptResult(parsed)
      setShowRawResult(false)
    } catch (error) {
      setPromptResult({
        data: { error: error instanceof Error ? error.message : 'Failed to get prompt' },
        rawText: error instanceof Error ? error.message : 'Failed to get prompt',
        isJson: false,
        isError: true,
        contentType: 'error',
      })
    }
  }

  const handleCopyResult = () => {
    if (promptResult) {
      const textToCopy = promptResult.isJson 
        ? JSON.stringify(promptResult.data, null, 2)
        : promptResult.rawText
      copyToClipboard(textToCopy)
    }
  }

  const updateArg = (name: string, value: string) => {
    setPromptArgs((prev) => ({ ...prev, [name]: value }))
  }

  if (!status.connected) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground p-8">
        <MessageSquare className="h-12 w-12 mb-4 opacity-50" />
        <p className="text-lg font-medium">Not Connected</p>
        <p className="text-sm">Connect to an MCP server to view prompts</p>
      </div>
    )
  }

  if (!status.capabilities?.prompts) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground p-8">
        <AlertCircle className="h-12 w-12 mb-4 opacity-50" />
        <p className="text-lg font-medium">Prompts Not Supported</p>
        <p className="text-sm">This server does not expose any prompts</p>
      </div>
    )
  }

  return (
    <div className="flex h-full gap-4 p-4">
      {/* Prompts List */}
      <Card className="w-80 flex flex-col flex-shrink-0">
        <CardHeader className="pb-3 flex-shrink-0">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg flex items-center gap-2">
              <MessageSquare className="h-5 w-5" />
              Prompts
              {prompts && (
                <Badge variant="secondary" className="ml-2">
                  {prompts.length}
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
                <p className="text-sm">Failed to load prompts</p>
              </div>
            ) : prompts?.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <MessageSquare className="h-6 w-6 mx-auto mb-2 opacity-50" />
                <p className="text-sm">No prompts available</p>
              </div>
            ) : (
              <div className="space-y-2">
                {prompts?.map((prompt) => (
                  <div
                    key={prompt.name}
                    className={cn(
                      'p-3 rounded-lg border cursor-pointer transition-colors',
                      selectedPrompt?.name === prompt.name
                        ? 'border-primary bg-primary/5'
                        : 'border-border hover:border-primary/50 hover:bg-muted/50'
                    )}
                    onClick={() => setSelectedPrompt(prompt)}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{prompt.name}</p>
                        {prompt.description && (
                          <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                            {prompt.description}
                          </p>
                        )}
                        {prompt.arguments && prompt.arguments.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-2">
                            {prompt.arguments.map((arg) => (
                              <Badge
                                key={arg.name}
                                variant={arg.required ? 'default' : 'outline'}
                                className="text-xs"
                              >
                                {arg.name}
                                {arg.required && '*'}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </CardContent>
      </Card>

      {/* Prompt Execution Panel */}
      <div className="flex-1 flex flex-col min-w-0">
        <PanelGroup direction="vertical" className="h-full">
          {/* Arguments Form */}
          <Panel defaultSize={35} minSize={15}>
            <Card className="h-full flex flex-col">
              <CardHeader className="pb-3 flex-shrink-0">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg">
                    {selectedPrompt ? (
                      <span className="flex items-center gap-2">
                        <span>{selectedPrompt.name}</span>
                        <Badge variant="outline">Arguments</Badge>
                      </span>
                    ) : (
                      'Prompt Arguments'
                    )}
                  </CardTitle>
                  <Button
                    onClick={handleGetPrompt}
                    disabled={!selectedPrompt || getPromptMutation.isPending}
                  >
                    {getPromptMutation.isPending ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Send className="h-4 w-4 mr-2" />
                    )}
                    Get Prompt
                  </Button>
                </div>
                {selectedPrompt?.description && (
                  <p className="text-sm text-muted-foreground">
                    {selectedPrompt.description}
                  </p>
                )}
              </CardHeader>
              <CardContent className="flex-1 overflow-auto">
                {selectedPrompt ? (
                  selectedPrompt.arguments && selectedPrompt.arguments.length > 0 ? (
                    <div className="space-y-4">
                      {selectedPrompt.arguments.map((arg) => (
                        <div key={arg.name} className="space-y-2">
                          <Label className="flex items-center gap-2">
                            {arg.name}
                            {arg.required && (
                              <span className="text-destructive">*</span>
                            )}
                          </Label>
                          {arg.description && (
                            <p className="text-xs text-muted-foreground">
                              {arg.description}
                            </p>
                          )}
                          <Input
                            value={promptArgs[arg.name] || ''}
                            onChange={(e) => updateArg(arg.name, e.target.value)}
                            placeholder={`Enter ${arg.name}`}
                          />
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground text-center py-4">
                      This prompt has no arguments
                    </p>
                  )
                ) : (
                  <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                    <MessageSquare className="h-8 w-8 mb-2 opacity-50" />
                    <p className="text-sm">Select a prompt to configure arguments</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </Panel>

          {/* Resize Handle */}
          <PanelResizeHandle className="h-2 flex items-center justify-center group cursor-row-resize">
            <div className="w-12 h-1 rounded-full bg-border group-hover:bg-primary/50 transition-colors flex items-center justify-center">
              <GripHorizontal className="h-3 w-3 text-muted-foreground group-hover:text-primary/70" />
            </div>
          </PanelResizeHandle>

          {/* Results Panel */}
          <Panel defaultSize={65} minSize={20}>
            <Card className="h-full flex flex-col">
              <CardHeader className="pb-3 flex-shrink-0">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg flex items-center gap-2">
                    Generated Messages
                    {getPromptMutation.isPending && (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    )}
                    {promptResult && (
                      <>
                        {promptResult.isError && (
                          <Badge variant="destructive" className="text-xs">Error</Badge>
                        )}
                        {promptResult.isJson && !promptResult.isError && (
                          <Badge variant="secondary" className="text-xs">JSON</Badge>
                        )}
                      </>
                    )}
                  </CardTitle>
                  {promptResult !== null && (
                    <div className="flex items-center gap-2">
                      <div className="flex items-center border rounded-md overflow-hidden">
                        <Button
                          variant={!showRawResult ? 'secondary' : 'ghost'}
                          size="sm"
                          onClick={() => setShowRawResult(false)}
                          className="rounded-none h-7 text-xs"
                        >
                          Parsed
                        </Button>
                        <Button
                          variant={showRawResult ? 'secondary' : 'ghost'}
                          size="sm"
                          onClick={() => setShowRawResult(true)}
                          className="rounded-none h-7 text-xs"
                        >
                          Raw
                        </Button>
                      </div>
                      <Button variant="ghost" size="sm" onClick={handleCopyResult}>
                        <Copy className="h-4 w-4 mr-1" />
                        Copy
                      </Button>
                    </div>
                  )}
                </div>
              </CardHeader>
              <CardContent className="flex-1 p-4 overflow-hidden flex flex-col">
                {promptResult !== null ? (
                  <div className="flex-1 min-h-0">
                    <JsonEditor
                      value={showRawResult 
                        ? promptResult.rawText
                        : (promptResult.isJson 
                            ? JSON.stringify(promptResult.data, null, 2)
                            : promptResult.rawText
                          )
                      }
                      readOnly
                      height="100%"
                    />
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                    <Send className="h-8 w-8 mb-2 opacity-50" />
                    <p className="text-sm">Get a prompt to see generated messages</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </Panel>
        </PanelGroup>
      </div>
    </div>
  )
}
