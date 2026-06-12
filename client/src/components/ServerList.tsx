import { ServerCard } from '@/components/ServerCard'
import { ServerConfigModal } from '@/components/ServerConfigModal'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useOAuthRefresh, useOAuthRevoke } from '@/hooks/useApi'
import { toast } from '@/lib/toast'
import type { Server, ServerConfig } from '@/stores/serversStore'
import { useServersStore } from '@/stores/serversStore'
import { ChevronLeft, ListChecks, Plus, Search, Server as ServerIcon, Trash2, X } from 'lucide-react'
import { useMemo, useState } from 'react'

interface ServerListProps {
  onConnect: (serverId: string) => void
  onDisconnect: (serverId: string) => void
  /** Collapses the servers column so tools/results use full width */
  onCollapseSidebar?: () => void
}

export function ServerList({
  onConnect,
  onDisconnect,
  onCollapseSidebar,
}: ServerListProps) {
  const {
    servers,
    activeServerId,
    addServer,
    removeServer,
    updateServer,
    updateServerConfig,
    setActiveServer,
  } = useServersStore()

  const [showModal, setShowModal] = useState(false)
  const [editingServer, setEditingServer] = useState<Server | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  // Filter servers based on search query
  const filteredServers = useMemo(() => {
    if (!searchQuery.trim()) return servers
    const query = searchQuery.toLowerCase()
    return servers.filter(server => 
      server.name.toLowerCase().includes(query) ||
      server.config.url?.toLowerCase().includes(query) ||
      server.config.command?.toLowerCase().includes(query)
    )
  }, [servers, searchQuery])

  const handleAddServer = () => {
    setEditingServer(null)
    setShowModal(true)
  }

  const handleEditServer = (server: Server) => {
    setEditingServer(server)
    setShowModal(true)
  }

  const handleSaveServer = (name: string, config: ServerConfig) => {
    if (editingServer) {
      // Update existing server
      updateServer(editingServer.id, { name })
      updateServerConfig(editingServer.id, config)
    } else {
      // Add new server
      addServer({ name, config })
    }
    setShowModal(false)
    setEditingServer(null)
  }

  const handleDeleteServer = (serverId: string) => {
    if (confirm('Are you sure you want to delete this server?')) {
      removeServer(serverId)
    }
  }

  const exitSelectionMode = () => {
    setSelectionMode(false)
    setSelectedIds(new Set())
  }

  const toggleSelected = (serverId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(serverId)) {
        next.delete(serverId)
      } else {
        next.add(serverId)
      }
      return next
    })
  }

  const allFilteredSelected =
    filteredServers.length > 0 && filteredServers.every((s) => selectedIds.has(s.id))

  const toggleSelectAll = () => {
    setSelectedIds(
      allFilteredSelected ? new Set() : new Set(filteredServers.map((s) => s.id))
    )
  }

  const handleDeleteSelected = () => {
    if (selectedIds.size === 0) return
    const isAll = selectedIds.size === servers.length
    const message = isAll
      ? `Delete ALL ${servers.length} servers? This cannot be undone.`
      : `Delete ${selectedIds.size} selected server${selectedIds.size > 1 ? 's' : ''}? This cannot be undone.`
    if (!confirm(message)) return
    selectedIds.forEach((id) => removeServer(id))
    toast(`Deleted ${selectedIds.size} server${selectedIds.size > 1 ? 's' : ''}`)
    exitSelectionMode()
  }

  const oauthRefreshMutation = useOAuthRefresh()
  const oauthRevokeMutation = useOAuthRevoke()

  const handleRefreshToken = async (server: Server) => {
    if (!server.config.url) return
    try {
      const result = await oauthRefreshMutation.mutateAsync({
        serverUrl: server.config.url,
        serverId: server.id,
      })
      if (result.success) {
        toast('Token refreshed successfully')
      } else {
        toast(result.error || 'Token refresh failed')
      }
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Token refresh failed')
    }
  }

  const handleClearToken = async (server: Server) => {
    if (!server.config.url) return
    try {
      await oauthRevokeMutation.mutateAsync({
        serverUrl: server.config.url,
        serverId: server.id,
      })
      toast('Token cleared for ' + server.name)
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Failed to clear token')
    }
  }

  return (
    <div className="flex flex-col h-full bg-card/40">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-border/60 bg-muted/20">
        <div className="flex items-center gap-2">
          <ServerIcon className="h-4 w-4 text-muted-foreground" />
          <h2 className="font-semibold text-sm tracking-tight">Servers</h2>
          <span className="text-[11px] text-muted-foreground bg-muted/70 border border-border/60 px-1.5 py-0.5 rounded-full">
            {filteredServers.length}{searchQuery && `/${servers.length}`}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {onCollapseSidebar && (
            <Button
              type="button"
              variant="panel"
              size="icon"
              className="h-8 w-8 shrink-0 text-muted-foreground"
              onClick={onCollapseSidebar}
              title="Collapse server list"
              aria-label="Collapse server list"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
          )}
          {servers.length > 0 && (
            <Button
              type="button"
              variant={selectionMode ? 'secondary' : 'ghost'}
              size="icon"
              className="h-8 w-8 shrink-0 text-muted-foreground"
              onClick={() => (selectionMode ? exitSelectionMode() : setSelectionMode(true))}
              title={selectionMode ? 'Exit selection mode' : 'Select servers to delete'}
              aria-label={selectionMode ? 'Exit selection mode' : 'Select servers to delete'}
            >
              <ListChecks className="h-4 w-4" />
            </Button>
          )}
          <Button size="sm" onClick={handleAddServer}>
            <Plus className="h-4 w-4 mr-1" />
            Add
          </Button>
        </div>
      </div>

      {/* Selection action bar */}
      {selectionMode && (
        <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-border/60 bg-muted/30">
          <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
            <input
              type="checkbox"
              checked={allFilteredSelected}
              onChange={toggleSelectAll}
              className="h-3.5 w-3.5 rounded border-border cursor-pointer accent-primary"
            />
            Select all
            <span className="text-foreground font-medium">{selectedIds.size} selected</span>
          </label>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="destructive"
              size="sm"
              className="h-7 px-2 text-xs"
              disabled={selectedIds.size === 0}
              onClick={handleDeleteSelected}
            >
              <Trash2 className="h-3.5 w-3.5 mr-1" />
              Delete
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={exitSelectionMode}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* Search */}
      {servers.length > 0 && (
        <div className="px-2.5 py-2 border-b border-border/60">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Search servers..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-8 pl-8 pr-8 text-sm bg-muted/25 border-border/70"
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
        </div>
      )}

      {/* Server List */}
      <ScrollArea className="flex-1">
        <div className="p-2.5 space-y-2">
          {servers.length === 0 ? (
            <div className="text-center py-8">
              <ServerIcon className="h-12 w-12 mx-auto text-muted-foreground/50 mb-3" />
              <p className="text-sm text-muted-foreground mb-3">
                No servers configured
              </p>
              <Button variant="outline" size="sm" onClick={handleAddServer}>
                <Plus className="h-4 w-4 mr-1" />
                Add your first server
              </Button>
            </div>
          ) : filteredServers.length === 0 ? (
            <div className="text-center py-8">
              <Search className="h-8 w-8 mx-auto text-muted-foreground/50 mb-3" />
              <p className="text-sm text-muted-foreground">
                No servers match "{searchQuery}"
              </p>
            </div>
          ) : (
            filteredServers.map((server) => (
              <div key={server.id} className={selectionMode ? 'flex items-start gap-2' : undefined}>
                {selectionMode && (
                  <input
                    type="checkbox"
                    checked={selectedIds.has(server.id)}
                    onChange={() => toggleSelected(server.id)}
                    className="mt-4 h-4 w-4 shrink-0 rounded border-border cursor-pointer accent-primary"
                    aria-label={`Select ${server.name}`}
                  />
                )}
                <div className={selectionMode ? 'flex-1 min-w-0' : undefined}>
                  <ServerCard
                    server={server}
                    isActive={server.id === activeServerId}
                    onSelect={() => setActiveServer(server.id)}
                    onConnect={() => onConnect(server.id)}
                    onDisconnect={() => onDisconnect(server.id)}
                    onEdit={() => handleEditServer(server)}
                    onDelete={() => handleDeleteServer(server.id)}
                    onRefreshToken={() => handleRefreshToken(server)}
                    onClearToken={() => handleClearToken(server)}
                  />
                </div>
              </div>
            ))
          )}
        </div>
      </ScrollArea>

      {/* Config Modal */}
      <ServerConfigModal
        open={showModal}
        onOpenChange={setShowModal}
        server={editingServer}
        onSave={handleSaveServer}
      />
    </div>
  )
}
