import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { ConnectionStep, Server } from '@/stores/serversStore'
import {
    AlertCircle,
    Check,
    ChevronDown,
    ChevronUp,
    Globe,
    Loader2,
    MoreVertical,
    Pencil,
    Plug,
    Radio,
    Terminal,
    Trash2,
    Unplug,
} from 'lucide-react'
import { useEffect, useState } from 'react'

interface ServerCardProps {
  server: Server
  isActive: boolean
  onSelect: () => void
  onConnect: () => void
  onDisconnect: () => void
  onEdit: () => void
  onDelete: () => void
}

function StepIcon({ status }: { status: ConnectionStep['status'] }) {
  switch (status) {
    case 'done':
      return (
        <div className="flex items-center justify-center w-4 h-4 rounded-full bg-green-500/20 text-green-500 flex-shrink-0">
          <Check className="w-2.5 h-2.5" />
        </div>
      )
    case 'active':
      return (
        <div className="flex items-center justify-center w-4 h-4 flex-shrink-0">
          <Loader2 className="w-3 h-3 animate-spin text-primary" />
        </div>
      )
    case 'error':
      return (
        <div className="flex items-center justify-center w-4 h-4 rounded-full bg-destructive/20 text-destructive flex-shrink-0">
          <AlertCircle className="w-2.5 h-2.5" />
        </div>
      )
    default:
      return (
        <div className="w-4 h-4 flex items-center justify-center flex-shrink-0">
          <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground/30" />
        </div>
      )
  }
}

function ConnectionTimeline({ steps }: { steps: ConnectionStep[] }) {
  const [expanded, setExpanded] = useState(true)
  const hasSteps = steps.length > 0
  const isComplete = steps.some(s => s.id === 'connected')
  const hasError = steps.some(s => s.status === 'error')

  useEffect(() => {
    if (isComplete && !hasError) {
      const timer = setTimeout(() => setExpanded(false), 2500)
      return () => clearTimeout(timer)
    }
  }, [isComplete, hasError])

  if (!hasSteps) return null

  const lastStep = steps[steps.length - 1]
  const completedCount = steps.filter(s => s.status === 'done').length

  return (
    <div
      className="mt-2 border-t pt-2"
      onClick={(e) => e.stopPropagation()}
    >
      <button
        className="flex items-center justify-between w-full text-xs text-muted-foreground hover:text-foreground transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="flex items-center gap-1.5">
          {!isComplete && !hasError && (
            <Loader2 className="w-3 h-3 animate-spin text-primary" />
          )}
          {isComplete && <Check className="w-3 h-3 text-green-500" />}
          {hasError && <AlertCircle className="w-3 h-3 text-destructive" />}
          <span className="font-medium">
            {hasError ? 'Connection failed' : isComplete ? 'Connected' : lastStep.label}
          </span>
          <span className="text-muted-foreground/60">
            ({completedCount}/{steps.length} steps)
          </span>
        </span>
        {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
      </button>

      {expanded && (
        <div className="mt-1.5 ml-0.5 space-y-0">
          {steps.map((step, i) => (
            <div key={`${step.id}-${i}`} className="flex items-start gap-2 py-0.5">
              <div className="flex flex-col items-center">
                <StepIcon status={step.status} />
                {i < steps.length - 1 && (
                  <div className={cn(
                    'w-px flex-1 min-h-[8px]',
                    step.status === 'done' ? 'bg-green-500/30' :
                    step.status === 'error' ? 'bg-destructive/30' :
                    'bg-border'
                  )} />
                )}
              </div>
              <div className="flex-1 min-w-0 -mt-0.5">
                <p className={cn(
                  'text-xs leading-tight',
                  step.status === 'active' ? 'text-foreground font-medium' :
                  step.status === 'error' ? 'text-destructive' :
                  step.status === 'done' ? 'text-muted-foreground' :
                  'text-muted-foreground/60'
                )}>
                  {step.label}
                </p>
                {step.detail && (
                  <p className="text-[10px] text-muted-foreground/70 truncate mt-0.5">
                    {step.detail}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function ServerCard({
  server,
  isActive,
  onSelect,
  onConnect,
  onDisconnect,
  onEdit,
  onDelete,
}: ServerCardProps) {
  const [showMenu, setShowMenu] = useState(false)

  const getTransportIcon = () => {
    switch (server.config.type) {
      case 'stdio':
        return <Terminal className="h-4 w-4" />
      case 'sse':
        return <Radio className="h-4 w-4" />
      case 'streamable-http':
        return <Globe className="h-4 w-4" />
      default:
        return <Terminal className="h-4 w-4" />
    }
  }

  const getStatusColor = () => {
    if (server.isConnecting) return 'bg-yellow-500'
    if (server.status.connected) return 'bg-green-500'
    // Don't show error color when OAuth authorization is required
    if (server.status.error && !server.status.oauth?.authorizationRequired) return 'bg-red-500'
    if (server.status.oauth?.authorizationRequired) return 'bg-yellow-500'
    return 'bg-gray-400'
  }

  const getStatusText = () => {
    if (server.isConnecting) return 'Connecting...'
    if (server.status.connected) return 'Connected'
    // Don't show error when OAuth authorization is required
    if (server.status.oauth?.authorizationRequired) return 'Authorizing...'
    if (server.status.error) return 'Error'
    return 'Disconnected'
  }

  const getServerUrl = () => {
    if (server.config.type === 'stdio') {
      return server.config.command || 'No command'
    }
    return server.config.url || 'No URL'
  }

  return (
    <div
      className={cn(
        'relative rounded-lg border p-3 cursor-pointer transition-all',
        isActive
          ? 'border-primary bg-primary/5 ring-1 ring-primary'
          : 'border-border hover:border-primary/50 hover:bg-muted/50'
      )}
      onClick={onSelect}
    >
      {/* Status indicator */}
      <div className="flex items-start gap-3">
        <div className={cn('w-2 h-2 rounded-full mt-2 flex-shrink-0', getStatusColor())} />
        
        <div className="flex-1 min-w-0">
          {/* Server name */}
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm truncate">{server.name}</span>
            {server.status.connected && server.status.serverInfo && (
              <Badge variant="outline" className="text-xs px-1.5 py-0">
                v{server.status.serverInfo.version}
              </Badge>
            )}
          </div>

          {/* URL/Command preview */}
          <p className="text-xs text-muted-foreground truncate mt-0.5">
            {getServerUrl()}
          </p>

          {/* Transport type and status */}
          <div className="flex items-center gap-2 mt-2">
            <Badge variant="secondary" className="text-xs px-1.5 py-0 gap-1">
              {getTransportIcon()}
              {server.config.type}
            </Badge>
            <span className="text-xs text-muted-foreground">{getStatusText()}</span>
          </div>

          {/* Error message - don't show when OAuth authorization is required */}
          {server.status.error && !server.status.oauth?.authorizationRequired && (
            <p className="text-xs text-destructive mt-1 truncate">
              {server.status.error}
            </p>
          )}

          {/* Capabilities */}
          {server.status.connected && server.status.capabilities && (
            <div className="flex gap-1 mt-2">
              {server.status.capabilities.tools && (
                <Badge variant="info" className="text-xs px-1.5 py-0">Tools</Badge>
              )}
              {server.status.capabilities.resources && (
                <Badge variant="info" className="text-xs px-1.5 py-0">Resources</Badge>
              )}
              {server.status.capabilities.prompts && (
                <Badge variant="info" className="text-xs px-1.5 py-0">Prompts</Badge>
              )}
            </div>
          )}

          {/* Connection Timeline */}
          {server.connectionSteps.length > 0 && (
            <ConnectionTimeline steps={server.connectionSteps} />
          )}
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-1 flex-shrink-0">
          {server.status.connected ? (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={(e) => {
                e.stopPropagation()
                onDisconnect()
              }}
              title="Disconnect"
            >
              <Unplug className="h-4 w-4 text-destructive" />
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={(e) => {
                e.stopPropagation()
                onConnect()
              }}
              disabled={server.isConnecting}
              title="Connect"
            >
              {server.isConnecting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Plug className="h-4 w-4 text-green-500" />
              )}
            </Button>
          )}

          {/* More menu */}
          <div className="relative">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={(e) => {
                e.stopPropagation()
                setShowMenu(!showMenu)
              }}
            >
              <MoreVertical className="h-4 w-4" />
            </Button>

            {showMenu && (
              <>
                <div
                  className="fixed inset-0 z-10"
                  onClick={(e) => {
                    e.stopPropagation()
                    setShowMenu(false)
                  }}
                />
                <div className="absolute right-0 top-full mt-1 z-20 bg-popover border border-border rounded-md shadow-lg py-1 min-w-[120px]">
                  <button
                    className="w-full px-3 py-1.5 text-sm text-left hover:bg-muted flex items-center gap-2"
                    onClick={(e) => {
                      e.stopPropagation()
                      setShowMenu(false)
                      onEdit()
                    }}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    Edit
                  </button>
                  <button
                    className="w-full px-3 py-1.5 text-sm text-left hover:bg-muted flex items-center gap-2 text-destructive"
                    onClick={(e) => {
                      e.stopPropagation()
                      setShowMenu(false)
                      onDelete()
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Delete
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
