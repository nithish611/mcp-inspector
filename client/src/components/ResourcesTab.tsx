import { JsonEditor } from '@/components/JsonEditor'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useReadResource, useResources, type Resource } from '@/hooks/useApi'
import { cn, copyToClipboard, parseMcpResult, type ParsedMcpResult } from '@/lib/utils'
import { useConnectionStore } from '@/stores/connectionStore'
import { useServersStore } from '@/stores/serversStore'
import {
    AlertCircle,
    Copy,
    Eye,
    FileText,
    FolderOpen,
    GripVertical,
    Loader2,
    RefreshCw,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'

export function ResourcesTab() {
  // Use serversStore for new UI, fallback to connectionStore for backward compatibility
  const { getActiveServer, activeServerId } = useServersStore()
  const { status: legacyStatus } = useConnectionStore()
  const activeServer = getActiveServer()
  const status = activeServer?.status || legacyStatus
  const { data: resources, isLoading, refetch, error } = useResources(activeServerId || undefined)
  const readResourceMutation = useReadResource()

  const [selectedResource, setSelectedResource] = useState<Resource | null>(null)
  const [resourceContent, setResourceContent] = useState<ParsedMcpResult | null>(null)
  const [showRawContent, setShowRawContent] = useState(false)

  useEffect(() => {
    if (status.connected && status.capabilities?.resources) {
      refetch()
    }
  }, [status.connected, status.capabilities?.resources, refetch])

  const handleReadResource = async (resource: Resource) => {
    if (!activeServerId) return
    
    setSelectedResource(resource)
    setResourceContent(null)
    setShowRawContent(false)

    try {
      const result = await readResourceMutation.mutateAsync({ serverId: activeServerId, uri: resource.uri })
      const parsed = parseMcpResult(result)
      setResourceContent(parsed)
    } catch (error) {
      console.error('Failed to read resource:', error)
    }
  }

  const handleCopyContent = () => {
    if (resourceContent) {
      const textToCopy = resourceContent.isJson 
        ? JSON.stringify(resourceContent.data, null, 2)
        : resourceContent.rawText
      copyToClipboard(textToCopy)
    }
  }

  if (!status.connected) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground p-8">
        <FolderOpen className="h-12 w-12 mb-4 opacity-50" />
        <p className="text-lg font-medium">Not Connected</p>
        <p className="text-sm">Connect to an MCP server to view resources</p>
      </div>
    )
  }

  if (!status.capabilities?.resources) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground p-8">
        <AlertCircle className="h-12 w-12 mb-4 opacity-50" />
        <p className="text-lg font-medium">Resources Not Supported</p>
        <p className="text-sm">This server does not expose any resources</p>
      </div>
    )
  }

  return (
    <div className="h-full p-4">
      <PanelGroup direction="horizontal" className="h-full">
        {/* Resources List */}
        <Panel defaultSize={35} minSize={20}>
          <Card className="h-full flex flex-col">
            <CardHeader className="pb-3 flex-shrink-0">
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg flex items-center gap-2">
                  <FolderOpen className="h-5 w-5" />
                  Resources
                  {resources && (
                    <Badge variant="secondary" className="ml-2">
                      {resources.length}
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
                    <p className="text-sm">Failed to load resources</p>
                  </div>
                ) : resources?.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <FileText className="h-6 w-6 mx-auto mb-2 opacity-50" />
                    <p className="text-sm">No resources available</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {resources?.map((resource) => (
                      <div
                        key={resource.uri}
                        className={cn(
                          'p-3 rounded-lg border cursor-pointer transition-colors',
                          selectedResource?.uri === resource.uri
                            ? 'border-primary bg-primary/5'
                            : 'border-border hover:border-primary/50 hover:bg-muted/50'
                        )}
                        onClick={() => handleReadResource(resource)}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <p className="font-medium truncate">{resource.name}</p>
                            <p className="text-xs text-muted-foreground truncate mt-1">
                              {resource.uri}
                            </p>
                            {resource.description && (
                              <p className="text-sm text-muted-foreground mt-2 line-clamp-2">
                                {resource.description}
                              </p>
                            )}
                          </div>
                          {resource.mimeType && (
                            <Badge variant="outline" className="text-xs flex-shrink-0">
                              {resource.mimeType}
                            </Badge>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </CardContent>
          </Card>
        </Panel>

        {/* Resize Handle */}
        <PanelResizeHandle className="w-2 flex items-center justify-center group cursor-col-resize mx-2">
          <div className="h-12 w-1 rounded-full bg-border group-hover:bg-primary/50 transition-colors flex items-center justify-center">
            <GripVertical className="h-3 w-3 text-muted-foreground group-hover:text-primary/70" />
          </div>
        </PanelResizeHandle>

        {/* Resource Content Preview */}
        <Panel defaultSize={65} minSize={30}>
          <Card className="h-full flex flex-col">
            <CardHeader className="pb-3 flex-shrink-0">
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Eye className="h-5 w-5" />
                  Content Preview
                  {resourceContent && (
                    <>
                      {resourceContent.isError && (
                        <Badge variant="destructive" className="text-xs">Error</Badge>
                      )}
                      {resourceContent.isJson && !resourceContent.isError && (
                        <Badge variant="secondary" className="text-xs">JSON</Badge>
                      )}
                    </>
                  )}
                </CardTitle>
                {resourceContent !== null && (
                  <div className="flex items-center gap-2">
                    <div className="flex items-center border rounded-md overflow-hidden">
                      <Button
                        variant={!showRawContent ? 'secondary' : 'ghost'}
                        size="sm"
                        onClick={() => setShowRawContent(false)}
                        className="rounded-none h-7 text-xs"
                      >
                        Parsed
                      </Button>
                      <Button
                        variant={showRawContent ? 'secondary' : 'ghost'}
                        size="sm"
                        onClick={() => setShowRawContent(true)}
                        className="rounded-none h-7 text-xs"
                      >
                        Raw
                      </Button>
                    </div>
                    <Button variant="ghost" size="sm" onClick={handleCopyContent}>
                      <Copy className="h-4 w-4 mr-1" />
                      Copy
                    </Button>
                  </div>
                )}
              </div>
              {selectedResource && (
                <p className="text-sm text-muted-foreground truncate">
                  {selectedResource.uri}
                </p>
              )}
            </CardHeader>
            <CardContent className="flex-1 p-4 overflow-hidden flex flex-col">
              {readResourceMutation.isPending ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : readResourceMutation.error ? (
                <div className="text-center py-8 text-destructive">
                  <AlertCircle className="h-6 w-6 mx-auto mb-2" />
                  <p className="text-sm">Failed to read resource</p>
                  <p className="text-xs mt-1 opacity-75">
                    {readResourceMutation.error instanceof Error
                      ? readResourceMutation.error.message
                      : 'Unknown error'}
                  </p>
                </div>
              ) : resourceContent !== null ? (
                <div className="flex-1 min-h-0">
                  <JsonEditor
                    value={showRawContent 
                      ? resourceContent.rawText
                      : (resourceContent.isJson 
                          ? JSON.stringify(resourceContent.data, null, 2)
                          : resourceContent.rawText
                        )
                    }
                    readOnly
                    height="100%"
                  />
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                  <Eye className="h-6 w-6 mb-2 opacity-50" />
                  <p className="text-sm">Select a resource to preview its content</p>
                </div>
              )}
            </CardContent>
          </Card>
        </Panel>
      </PanelGroup>
    </div>
  )
}
