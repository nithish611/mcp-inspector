import { BatchExecution } from '@/components/BatchExecution'
import { EnvironmentManager } from '@/components/EnvironmentManager'
import { ExecutionStatusBar } from '@/components/ExecutionStatusBar'
import { LogsTab } from '@/components/LogsTab'
import { NotebooksTab } from '@/components/NotebooksTab'
import { PerformanceDashboard } from '@/components/PerformanceDashboard'
import { PromptsTab } from '@/components/PromptsTab'
import { ResourcesTab } from '@/components/ResourcesTab'
import { ServerList } from '@/components/ServerList'
import { ToolsTab } from '@/components/ToolsTab'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useConnect, useConnectedServers, useDisconnect, useOAuthClear, useOAuthRefresh } from '@/hooks/useApi'
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts'
import { useWebSocket } from '@/hooks/useWebSocket'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/utils'
import { useConnectionStore } from '@/stores/connectionStore'
import { useLogsStore } from '@/stores/logsStore'
import { useServersStore } from '@/stores/serversStore'
import { useThemeStore } from '@/stores/themeStore'
import {
  Activity,
  BarChart3,
  BookOpen,
  ChevronRight,
  Eraser,
  FolderOpen,
  Github,
  Keyboard,
  Layers,
  MessageSquare,
  Moon,
  RefreshCw,
  Server as ServerIcon,
  Sun,
  Variable,
  Wrench,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  type ImperativePanelHandle,
  Panel,
  PanelGroup,
  PanelResizeHandle,
} from 'react-resizable-panels'

export function Layout() {
  const [activeTab, setActiveTab] = useState('tools')
  const [showShortcuts, setShowShortcuts] = useState(false)
  const [serversPanelCollapsed, setServersPanelCollapsed] = useState(false)
  const leftPanelRef = useRef<ImperativePanelHandle>(null)
  const autoReconnectAttempted = useRef(false)
  const { clearServerLogs } = useWebSocket()
  const { theme, toggleTheme } = useThemeStore()
  const {
    servers,
    getActiveServer,
    getConnectedServers,
    setServerConnecting,
    setServerStatus,
    setActiveServer,
    clearConnectionSteps,
  } = useServersStore()
  const { logs, toggleExpanded, clearLogs } = useLogsStore()
  
  // Also update legacy connectionStore for backward compatibility with tabs
  const { setStatus: setLegacyStatus } = useConnectionStore()

  const connectMutation = useConnect()
  const disconnectMutation = useDisconnect()
  const oauthRefreshMutation = useOAuthRefresh()
  const oauthClearMutation = useOAuthClear()
  const { data: backendConnectedServers } = useConnectedServers()

  const activeServer = getActiveServer()
  const connectedServers = getConnectedServers()

  // Handle OAuth callback success - reconnect to the pending server
  // This should NOT disconnect other servers
  const handleOAuthSuccess = useCallback(async (serverId: string) => {
    const server = servers.find((s) => s.id === serverId)
    if (!server) return

    // Set this server as active since user just authenticated with it
    setActiveServer(serverId)
    setServerConnecting(serverId, true)
    try {
      // Ensure redirectUri uses current window origin
      const configWithCorrectRedirect = {
        ...server.config,
        oauth: server.config.oauth ? {
          ...server.config.oauth,
          redirectUri: `${window.location.origin}/oauth/callback`,
        } : undefined,
      }
      const result = await connectMutation.mutateAsync({ serverId, config: configWithCorrectRedirect })
      setServerStatus(serverId, result)
      // Update legacy store since this is now the active server
      setLegacyStatus(result)
      
      // After successful OAuth, the backend should have this server connected
      // Other servers should remain connected (backend maintains separate connections)
      console.log(`[OAuth] Server ${server.name} connected after OAuth`)
    } catch (error) {
      const errorStatus = {
        connected: false,
        error: error instanceof Error ? error.message : 'Connection failed after OAuth',
      }
      setServerStatus(serverId, errorStatus)
      setLegacyStatus(errorStatus)
    } finally {
      setServerConnecting(serverId, false)
    }
  }, [servers, setActiveServer, setServerConnecting, connectMutation, setServerStatus, setLegacyStatus])

  // Check for OAuth success on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const oauthSuccess = params.get('oauth_success')
    const oauthError = params.get('oauth_error')
    
    if (oauthSuccess === 'true') {
      // Get the pending server ID from localStorage
      const pendingServerId = localStorage.getItem('mcp-pending-oauth-server')
      if (pendingServerId) {
        localStorage.removeItem('mcp-pending-oauth-server')
        // Clean up the URL
        window.history.replaceState({}, '', window.location.pathname)
        // Reconnect to the server
        handleOAuthSuccess(pendingServerId)
      }
    } else if (oauthError) {
      // Clean up the URL and show error
      window.history.replaceState({}, '', window.location.pathname)
      console.error('OAuth error:', oauthError)
    }
  }, [handleOAuthSuccess])

  // Sync legacy store when active server changes
  useEffect(() => {
    if (activeServer) {
      setLegacyStatus(activeServer.status)
    } else {
      setLegacyStatus({ connected: false })
    }
  }, [activeServer, setLegacyStatus])

  // Auto-reconnect servers on mount - try to connect all configured servers
  // that have OAuth enabled (they might have valid tokens)
  useEffect(() => {
    // Only run once on mount
    if (autoReconnectAttempted.current) return
    
    // Skip if this is an OAuth callback (will be handled by handleOAuthSuccess)
    const params = new URLSearchParams(window.location.search)
    if (params.get('oauth_success') || params.get('oauth_error')) return
    
    // Wait a bit for the app to initialize
    const timer = setTimeout(async () => {
      autoReconnectAttempted.current = true
      
      // Try to reconnect all servers that have OAuth enabled
      // The backend will check if tokens exist and connect if valid
      for (const server of servers) {
        // Skip servers that are already connected or connecting
        if (server.status.connected || server.isConnecting) continue
        
        // Only auto-reconnect HTTP-based servers with OAuth
        if ((server.config.type === 'sse' || server.config.type === 'streamable-http') && 
            server.config.oauth?.enabled) {
          console.log(`[AutoReconnect] Attempting to reconnect server: ${server.name}`)
          setServerConnecting(server.id, true)
          try {
            // Ensure redirectUri uses current window origin
            const configWithCorrectRedirect = {
              ...server.config,
              oauth: {
                ...server.config.oauth,
                redirectUri: `${window.location.origin}/oauth/callback`,
              },
            }
            const result = await connectMutation.mutateAsync({ 
              serverId: server.id, 
              config: configWithCorrectRedirect 
            })
            
            // If OAuth is required, don't redirect - just mark as needing auth
            if (result.oauth?.authorizationRequired) {
              console.log(`[AutoReconnect] Server ${server.name} needs OAuth authorization`)
              setServerStatus(server.id, { 
                connected: false, 
                oauth: result.oauth 
              })
            } else {
              console.log(`[AutoReconnect] Server ${server.name} connected successfully`)
              setServerStatus(server.id, result)
            }
          } catch (error) {
            console.log(`[AutoReconnect] Failed to reconnect ${server.name}:`, error)
            setServerStatus(server.id, { 
              connected: false, 
              error: error instanceof Error ? error.message : 'Auto-reconnect failed' 
            })
          } finally {
            setServerConnecting(server.id, false)
          }
        }
      }
    }, 500)
    
    return () => clearTimeout(timer)
  }, [servers, setServerConnecting, setServerStatus, connectMutation])

  // Sync frontend state with backend connected servers
  useEffect(() => {
    if (!backendConnectedServers?.serverIds) return
    
    // Update frontend state to match backend
    const syncServers = async () => {
      for (const server of servers) {
        const isBackendConnected = backendConnectedServers.serverIds.includes(server.id)
        const isFrontendConnected = server.status.connected
        
        // If backend says connected but frontend says not, fetch full status
        if (isBackendConnected && !isFrontendConnected && !server.isConnecting) {
          console.log(`[Sync] Server ${server.name} is connected on backend, fetching status`)
          try {
            const response = await fetch(`/api/status?serverId=${encodeURIComponent(server.id)}`)
            if (response.ok) {
              const status = await response.json()
              setServerStatus(server.id, status)
              console.log(`[Sync] Updated status for ${server.name}:`, status)
            }
          } catch (error) {
            console.error(`[Sync] Failed to fetch status for ${server.name}:`, error)
            // Fallback to just marking as connected
            setServerStatus(server.id, { connected: true })
          }
        }
      }
    }
    
    syncServers()
  }, [backendConnectedServers, servers, setServerStatus])

  // Register keyboard shortcuts
  useKeyboardShortcuts({
    onToggleTheme: toggleTheme,
    onToggleLogs: toggleExpanded,
    onClearLogs: () => {
      clearLogs()
      clearServerLogs()
    },
    onSwitchToTools: () => setActiveTab('tools'),
    onSwitchToResources: () => setActiveTab('resources'),
    onSwitchToPrompts: () => setActiveTab('prompts'),
    onSwitchToNotebooks: () => setActiveTab('notebooks'),
    onSwitchToLogs: () => setActiveTab('logs'),
  })

  const handleConnect = async (serverId: string) => {
    const server = servers.find((s) => s.id === serverId)
    if (!server) return

    clearConnectionSteps(serverId)
    setServerConnecting(serverId, true)
    try {
      // Ensure redirectUri uses current window origin (not hardcoded port)
      const configWithCorrectRedirect = {
        ...server.config,
        oauth: server.config.oauth ? {
          ...server.config.oauth,
          redirectUri: `${window.location.origin}/oauth/callback`,
        } : undefined,
      }
      const result = await connectMutation.mutateAsync({ serverId, config: configWithCorrectRedirect })
      
      // Check if OAuth authorization is required
      if (result.oauth?.authorizationRequired && result.oauth?.authorizationUrl) {
        // Store the server ID for when we return from OAuth
        localStorage.setItem('mcp-pending-oauth-server', serverId)
        // Redirect to the authorization URL
        window.location.href = result.oauth.authorizationUrl
        return
      }
      
      setServerStatus(serverId, result)
      // Only update legacy store if this is the active server
      const currentActiveServerId = useServersStore.getState().activeServerId
      if (serverId === currentActiveServerId) {
        setLegacyStatus(result)
      }
    } catch (error) {
      const errorStatus = {
        connected: false,
        error: error instanceof Error ? error.message : 'Connection failed',
      }
      setServerStatus(serverId, errorStatus)
      // Only update legacy store if this is the active server
      const currentActiveServerId = useServersStore.getState().activeServerId
      if (serverId === currentActiveServerId) {
        setLegacyStatus(errorStatus)
      }
    } finally {
      setServerConnecting(serverId, false)
    }
  }

  const handleDisconnect = async (serverId: string) => {
    const server = servers.find((s) => s.id === serverId)
    if (!server) return

    try {
      await disconnectMutation.mutateAsync(serverId)
      setServerStatus(serverId, { connected: false })
      // Only update legacy store if this is the active server
      const currentActiveServerId = useServersStore.getState().activeServerId
      if (serverId === currentActiveServerId) {
        setLegacyStatus({ connected: false })
      }
    } catch (error) {
      console.error('Disconnect error:', error)
    }
  }

  const handleRefreshAuth = async () => {
    if (!activeServer?.config.url) {
      toast('Select an HTTP server to refresh OAuth tokens.')
      return
    }

    try {
      const result = await oauthRefreshMutation.mutateAsync({
        serverId: activeServer.id,
        serverUrl: activeServer.config.url,
      })
      if (result.success) {
        toast('OAuth token refresh successful.')
      } else if (result.authorizationRequired) {
        toast('Refresh failed. Re-authorization is required.')
      } else {
        toast(result.error || 'OAuth refresh failed.')
      }
    } catch (error) {
      toast(error instanceof Error ? error.message : 'OAuth refresh failed.')
    }
  }

  const handleClearAllAuth = async () => {
    try {
      await oauthClearMutation.mutateAsync()
      toast('Cleared all stored OAuth tokens and registered clients.')
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Failed to clear OAuth data.')
    }
  }

  return (
    <div className="h-screen flex flex-col bg-background/70 backdrop-blur-sm">
      {/* Header */}
      <header className="h-12 border-b border-border/70 bg-card/70 flex items-center justify-between gap-3 px-3.5 flex-shrink-0 min-h-0 backdrop-blur supports-[backdrop-filter]:bg-card/55">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <div className="flex items-center gap-2 shrink-0">
            <div className="h-7 w-7 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-[0_10px_30px_-16px_rgba(99,102,241,1)]">
              <span className="text-white font-bold text-[10px] leading-none">MCP</span>
            </div>
            <div className="min-w-0 flex items-baseline gap-1.5">
              <h1
                className="text-sm font-semibold leading-none tracking-tight text-foreground/95"
                title="Model Context Protocol Inspector"
              >
                MCP Client
              </h1>
              <span className="text-[10px] text-muted-foreground leading-none hidden sm:inline border-l border-border/70 pl-1.5 max-w-[14rem] truncate">
                Inspector
              </span>
            </div>
          </div>

          {/* Connected servers indicator — inline, compact */}
          {connectedServers.length > 0 && (
            <div className="flex items-center gap-1.5 min-w-0 ml-1 border-l border-border/60 pl-2">
              <Badge
                variant="success"
                className="gap-0.5 h-5 px-1.5 py-0 text-[10px] font-medium shrink-0"
                title={`${connectedServers.length} server(s) connected`}
                aria-label={`${connectedServers.length} server(s) connected`}
              >
                <ServerIcon className="h-2.5 w-2.5" />
                {connectedServers.length}
              </Badge>
              {activeServer?.status.connected && activeServer.status.serverInfo && (
                <Badge
                  variant="outline"
                  className="h-5 px-1.5 py-0 text-[10px] font-normal max-w-[min(12rem,28vw)] truncate border-border/70 bg-muted/25"
                  title={`Active: ${activeServer.status.serverInfo.name}`}
                >
                  {activeServer.status.serverInfo.name}
                </Badge>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <ExecutionStatusBar />
          <div className="relative">
            <Button
              variant="panel"
              size="icon"
              onClick={() => setShowShortcuts(!showShortcuts)}
              className="h-8 w-8"
              title="Keyboard shortcuts"
            >
              <Keyboard className="h-3.5 w-3.5" />
            </Button>
            {showShortcuts && (
              <div className="absolute right-0 top-full mt-2 w-64 bg-popover border border-border rounded-lg shadow-lg p-4 z-50">
                <h3 className="font-medium mb-3 text-sm">Keyboard Shortcuts</h3>
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Toggle theme</span>
                    <kbd className="px-1.5 py-0.5 bg-muted rounded text-xs">⌘D</kbd>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Toggle logs</span>
                    <kbd className="px-1.5 py-0.5 bg-muted rounded text-xs">⌘L</kbd>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Command palette</span>
                    <kbd className="px-1.5 py-0.5 bg-muted rounded text-xs">⌘K</kbd>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Clear logs</span>
                    <kbd className="px-1.5 py-0.5 bg-muted rounded text-xs">⌘⇧K</kbd>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Tools tab</span>
                    <kbd className="px-1.5 py-0.5 bg-muted rounded text-xs">⌘1</kbd>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Resources tab</span>
                    <kbd className="px-1.5 py-0.5 bg-muted rounded text-xs">⌘2</kbd>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Prompts tab</span>
                    <kbd className="px-1.5 py-0.5 bg-muted rounded text-xs">⌘3</kbd>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Notebooks tab</span>
                    <kbd className="px-1.5 py-0.5 bg-muted rounded text-xs">⌘4</kbd>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Logs tab</span>
                    <kbd className="px-1.5 py-0.5 bg-muted rounded text-xs">⌘5</kbd>
                  </div>
                </div>
              </div>
            )}
          </div>
          <Button
            variant="panel"
            size="icon"
            className="h-8 w-8"
            title="Refresh OAuth tokens"
            onClick={handleRefreshAuth}
            disabled={oauthRefreshMutation.isPending}
          >
            <RefreshCw className={cn('h-3.5 w-3.5', oauthRefreshMutation.isPending && 'animate-spin')} />
          </Button>
          <Button
            variant="panel"
            size="icon"
            className="h-8 w-8"
            title="Clear all OAuth tokens"
            onClick={handleClearAllAuth}
            disabled={oauthClearMutation.isPending}
          >
            <Eraser className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="panel"
            size="icon"
            onClick={toggleTheme}
            className="h-8 w-8"
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {theme === 'dark' ? (
              <Sun className="h-3.5 w-3.5" />
            ) : (
              <Moon className="h-3.5 w-3.5" />
            )}
          </Button>
          <Button
            variant="panel"
            size="icon"
            className="h-8 w-8"
            title="View on GitHub"
            onClick={() =>
              window.open('https://github.com/modelcontextprotocol', '_blank')
            }
          >
            <Github className="h-3.5 w-3.5" />
          </Button>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden relative p-2 gap-2">
        {serversPanelCollapsed && (
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="absolute left-0 top-1/2 z-20 h-14 w-7 -translate-y-1/2 rounded-l-none rounded-r-md border-l-0 shadow-sm"
            onClick={() => leftPanelRef.current?.expand()}
            title="Show servers panel"
            aria-label="Show servers panel"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        )}

        <PanelGroup direction="horizontal">
          {/* Left Sidebar - Server List */}
          <Panel
            ref={leftPanelRef}
            defaultSize={16}
            minSize={12}
            maxSize={28}
            collapsible
            collapsedSize={0}
            onCollapse={() => setServersPanelCollapsed(true)}
            onExpand={() => setServersPanelCollapsed(false)}
          >
            <div className="h-full rounded-xl border border-border/60 bg-card/60 backdrop-blur overflow-hidden">
              <ServerList
                onConnect={handleConnect}
                onDisconnect={handleDisconnect}
                onCollapseSidebar={() => leftPanelRef.current?.collapse()}
              />
            </div>
          </Panel>

          <PanelResizeHandle
            className={cn(
              'w-1 rounded-full bg-border/60 hover:bg-primary/60 transition-colors',
              serversPanelCollapsed && 'hidden'
            )}
          />

          {/* Main Panel - Tabs */}
          <Panel defaultSize={84} minSize={40}>
            <div className="h-full flex flex-col">
              <Tabs
                value={activeTab}
                onValueChange={setActiveTab}
                className="flex-1 flex flex-col overflow-hidden"
              >
                <div className="px-2 pt-2">
                  <TabsList className="h-10 bg-muted/25 border border-border/70 gap-1 rounded-xl p-1">
                    <TabsTrigger
                      value="tools"
                      className="data-[state=active]:bg-card data-[state=active]:shadow-sm rounded-lg"
                    >
                      <Wrench className="h-4 w-4 mr-2" />
                      Tools
                    </TabsTrigger>
                    <TabsTrigger
                      value="resources"
                      className="data-[state=active]:bg-card data-[state=active]:shadow-sm rounded-lg"
                    >
                      <FolderOpen className="h-4 w-4 mr-2" />
                      Resources
                    </TabsTrigger>
                    <TabsTrigger
                      value="prompts"
                      className="data-[state=active]:bg-card data-[state=active]:shadow-sm rounded-lg"
                    >
                      <MessageSquare className="h-4 w-4 mr-2" />
                      Prompts
                    </TabsTrigger>
                    <TabsTrigger
                      value="notebooks"
                      className="data-[state=active]:bg-card data-[state=active]:shadow-sm rounded-lg"
                    >
                      <BookOpen className="h-4 w-4 mr-2" />
                      Notebooks
                    </TabsTrigger>
                    <TabsTrigger
                      value="batch"
                      className="data-[state=active]:bg-card data-[state=active]:shadow-sm rounded-lg"
                    >
                      <Layers className="h-4 w-4 mr-2" />
                      Batch
                    </TabsTrigger>
                    <TabsTrigger
                      value="environments"
                      className="data-[state=active]:bg-card data-[state=active]:shadow-sm rounded-lg"
                    >
                      <Variable className="h-4 w-4 mr-2" />
                      Env
                    </TabsTrigger>
                    <TabsTrigger
                      value="performance"
                      className="data-[state=active]:bg-card data-[state=active]:shadow-sm rounded-lg"
                    >
                      <BarChart3 className="h-4 w-4 mr-2" />
                      Performance
                    </TabsTrigger>
                    <TabsTrigger
                      value="logs"
                      className="data-[state=active]:bg-card data-[state=active]:shadow-sm rounded-lg"
                    >
                      <Activity className="h-4 w-4 mr-2" />
                      Logs
                      {logs.length > 0 && (
                        <Badge variant="secondary" className="ml-2 text-xs">
                          {logs.length}
                        </Badge>
                      )}
                    </TabsTrigger>
                  </TabsList>
                </div>

                <TabsContent value="tools" className="flex-1 overflow-hidden m-0">
                  <ToolsTab />
                </TabsContent>
                <TabsContent value="resources" className="flex-1 overflow-hidden m-0">
                  <ResourcesTab />
                </TabsContent>
                <TabsContent value="prompts" className="flex-1 overflow-hidden m-0">
                  <PromptsTab />
                </TabsContent>
                <TabsContent value="notebooks" className="flex-1 overflow-hidden m-0">
                  <NotebooksTab />
                </TabsContent>
                <TabsContent value="batch" className="flex-1 overflow-hidden m-0">
                  <BatchExecution />
                </TabsContent>
                <TabsContent value="environments" className="flex-1 overflow-hidden m-0 p-2">
                  <EnvironmentManager />
                </TabsContent>
                <TabsContent value="performance" className="flex-1 overflow-hidden m-0">
                  <PerformanceDashboard />
                </TabsContent>
                <TabsContent value="logs" className="flex-1 overflow-hidden m-0">
                  <LogsTab onClearLogs={clearServerLogs} />
                </TabsContent>
              </Tabs>
            </div>
          </Panel>
        </PanelGroup>
      </div>
    </div>
  )
}
