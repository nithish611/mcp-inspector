import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import type { Server, ServerConfig, TransportType } from '@/stores/serversStore'
import { ChevronDown, ChevronUp, Globe, Shield, Terminal } from 'lucide-react'
import { useEffect, useState } from 'react'

interface ServerConfigModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  server?: Server | null
  onSave: (name: string, config: ServerConfig) => void
}

export function ServerConfigModal({
  open,
  onOpenChange,
  server,
  onSave,
}: ServerConfigModalProps) {
  const [name, setName] = useState('')
  const [transportType, setTransportType] = useState<TransportType>('streamable-http')
  
  // STDIO fields
  const [command, setCommand] = useState('')
  const [args, setArgs] = useState('')
  const [envVars, setEnvVars] = useState('')
  
  // HTTP fields
  const [url, setUrl] = useState('')
  const [headers, setHeaders] = useState('')
  
  // OAuth fields
  const [oauthEnabled, setOauthEnabled] = useState(false)
  const [showOAuthSettings, setShowOAuthSettings] = useState(false)
  
  const isEditing = !!server

  const handleTransportTypeChange = (nextType: TransportType) => {
    setTransportType(nextType)
    // Default OAuth on for HTTP transport; user can still toggle it off.
    if (nextType === 'streamable-http') {
      setOauthEnabled(true)
      setShowOAuthSettings(false)
    }
  }

  // Reset form when modal opens/closes or server changes
  useEffect(() => {
    if (open && server) {
      setName(server.name)
      setTransportType(server.config.type)
      setCommand(server.config.command || '')
      setArgs(server.config.args?.join(' ') || '')
      setEnvVars(
        server.config.env
          ? Object.entries(server.config.env)
              .map(([k, v]) => `${k}=${v}`)
              .join('\n')
          : ''
      )
      setUrl(server.config.url || '')
      setHeaders(
        server.config.headers
          ? Object.entries(server.config.headers)
              .map(([k, v]) => `${k}: ${v}`)
              .join('\n')
          : ''
      )
      setOauthEnabled(server.config.oauth?.enabled || false)
      setShowOAuthSettings(false)
    } else if (open) {
      // Reset to defaults for new server
      setName('')
      setTransportType('streamable-http')
      setCommand('')
      setArgs('')
      setEnvVars('')
      setUrl('')
      setHeaders('')
      setOauthEnabled(true)
      setShowOAuthSettings(false)
    }
  }, [open, server])

  const handleSave = () => {
    // Parse environment variables
    const envObj: Record<string, string> = {}
    if (envVars.trim()) {
      envVars.split('\n').forEach((line) => {
        const [key, ...valueParts] = line.split('=')
        if (key && valueParts.length > 0) {
          envObj[key.trim()] = valueParts.join('=').trim()
        }
      })
    }

    // Parse headers
    const headersObj: Record<string, string> = {}
    if (headers.trim()) {
      headers.split('\n').forEach((line) => {
        const [key, ...valueParts] = line.split(':')
        if (key && valueParts.length > 0) {
          headersObj[key.trim()] = valueParts.join(':').trim()
        }
      })
    }

    const config: ServerConfig = {
      type: transportType,
      command: transportType === 'stdio' ? command : undefined,
      args: transportType === 'stdio' ? args.split(' ').filter(Boolean) : undefined,
      env: transportType === 'stdio' ? envObj : undefined,
      url: transportType !== 'stdio' ? url : undefined,
      headers: transportType !== 'stdio' ? headersObj : undefined,
      oauth: transportType !== 'stdio' ? {
        enabled: oauthEnabled,
        redirectUri: `${window.location.origin}/oauth/callback`,
      } : undefined,
    }

    onSave(name || `Server ${Date.now()}`, config)
    onOpenChange(false)
  }

  const isValid = () => {
    if (!name.trim()) return false
    if (transportType === 'stdio' && !command.trim()) return false
    if (transportType !== 'stdio' && !url.trim()) return false
    return true
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl border-border/70 bg-card/95">
        <DialogHeader>
          <DialogTitle>{isEditing ? 'Edit Server' : 'Add New Server'}</DialogTitle>
          <DialogDescription>
            Configure your MCP server connection settings.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Server Name */}
          <div className="space-y-2 rounded-lg border border-border/70 bg-muted/20 p-3">
            <div className="flex items-center gap-2">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground border border-border/60 bg-muted/40 rounded-full px-2 py-0.5">
                Step 1
              </span>
              <Label htmlFor="name">Server Name</Label>
            </div>
            <Input
              id="name"
              placeholder="My MCP Server"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="bg-background/70"
            />
          </div>

          {/* Transport Type */}
          <div className="space-y-2 rounded-lg border border-border/70 bg-muted/20 p-3">
            <div className="flex items-center gap-2">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground border border-border/60 bg-muted/40 rounded-full px-2 py-0.5">
                Step 2
              </span>
              <Label>Transport Type</Label>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant={transportType === 'streamable-http' ? 'default' : 'panel'}
                className="flex items-center gap-2"
                onClick={() => handleTransportTypeChange('streamable-http')}
              >
                <Globe className="h-4 w-4" />
                HTTP
              </Button>
              <Button
                type="button"
                variant={transportType === 'stdio' ? 'default' : 'panel'}
                className="flex items-center gap-2"
                onClick={() => handleTransportTypeChange('stdio')}
              >
                <Terminal className="h-4 w-4" />
                STDIO
              </Button>
            </div>
          </div>

          {/* STDIO Configuration */}
          {transportType === 'stdio' && (
            <div className="space-y-3 rounded-lg border border-border/70 bg-muted/20 p-3">
              <div>
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground border border-border/60 bg-muted/40 rounded-full px-2 py-0.5">
                  Step 3
                </span>
              </div>
              <div className="space-y-2">
                <Label htmlFor="command">Command</Label>
                <Input
                  id="command"
                  placeholder="npx -y @modelcontextprotocol/server-filesystem"
                  value={command}
                  onChange={(e) => setCommand(e.target.value)}
                  className="bg-background/70"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="args">Arguments (space-separated)</Label>
                <Input
                  id="args"
                  placeholder="/path/to/directory"
                  value={args}
                  onChange={(e) => setArgs(e.target.value)}
                  className="bg-background/70"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="env">Environment Variables (one per line, KEY=VALUE)</Label>
                <Textarea
                  id="env"
                  placeholder="NODE_ENV=production&#10;DEBUG=true"
                  value={envVars}
                  onChange={(e) => setEnvVars(e.target.value)}
                  rows={3}
                  className="bg-background/70"
                />
              </div>
            </div>
          )}

          {/* HTTP Configuration */}
          {transportType !== 'stdio' && (
            <div className="space-y-3 rounded-lg border border-border/70 bg-muted/20 p-3">
              <div>
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground border border-border/60 bg-muted/40 rounded-full px-2 py-0.5">
                  Step 3
                </span>
              </div>
              <div className="space-y-2">
                <Label htmlFor="url">Server URL</Label>
                <Input
                  id="url"
                  placeholder="https://mcp.example.com/server"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  className="bg-background/70"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="headers">Custom Headers (one per line, Key: Value)</Label>
                <Textarea
                  id="headers"
                  placeholder="Authorization: Bearer token&#10;X-Custom-Header: value"
                  value={headers}
                  onChange={(e) => setHeaders(e.target.value)}
                  rows={3}
                  className="bg-background/70"
                />
              </div>

              {/* OAuth Settings */}
              <div className={`rounded-lg border transition-colors ${oauthEnabled ? 'border-primary/50 bg-primary/10' : 'border-border/70 bg-background/30'}`}>
                <button
                  type="button"
                  className="w-full flex items-center justify-between p-4 cursor-pointer"
                  onClick={() => {
                    const next = !oauthEnabled
                    setOauthEnabled(next)
                    if (next) setShowOAuthSettings(true)
                  }}
                >
                  <div className="flex items-center gap-3">
                    <div className={`flex items-center justify-center h-9 w-9 rounded-lg transition-colors ${oauthEnabled ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>
                      <Shield className="h-5 w-5" />
                    </div>
                    <div className="text-left">
                      <p className="text-sm font-medium">OAuth 2.1 Authentication</p>
                      <p className="text-xs text-muted-foreground">
                        {oauthEnabled ? 'Enabled — auto-discovery, DCR & PKCE' : 'Click to enable secure authentication'}
                      </p>
                    </div>
                  </div>
                  <div
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${oauthEnabled ? 'bg-primary' : 'bg-muted'}`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform ${oauthEnabled ? 'translate-x-6' : 'translate-x-1'}`}
                    />
                  </div>
                </button>

                {oauthEnabled && (
                  <div className="px-4 pb-4">
                    <button
                      type="button"
                      className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                      onClick={() => setShowOAuthSettings(!showOAuthSettings)}
                    >
                      {showOAuthSettings ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                      {showOAuthSettings ? 'Hide details' : 'Show details'}
                    </button>
                    {showOAuthSettings && (
                      <div className="mt-3 p-3 rounded-md bg-muted/40 text-sm text-muted-foreground space-y-2 border border-border/60">
                        <p>
                          OAuth settings will be automatically discovered from the server's
                          metadata. The client will handle Dynamic Client Registration (DCR)
                          and PKCE automatically.
                        </p>
                        <div className="flex items-center gap-2 text-xs font-mono bg-background/80 rounded px-2 py-1.5 border border-border/70">
                          <span className="text-muted-foreground">Redirect URI:</span>
                          <span className="truncate">{window.location.origin}/oauth/callback</span>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!isValid()}>
            {isEditing ? 'Save Changes' : 'Add Server'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
