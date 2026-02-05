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
import { ChevronDown, ChevronUp, Globe, Radio, Shield, Terminal } from 'lucide-react'
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
  const [transportType, setTransportType] = useState<TransportType>('stdio')
  
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
    } else if (open) {
      // Reset to defaults for new server
      setName('')
      setTransportType('stdio')
      setCommand('')
      setArgs('')
      setEnvVars('')
      setUrl('')
      setHeaders('')
      setOauthEnabled(false)
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
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{isEditing ? 'Edit Server' : 'Add New Server'}</DialogTitle>
          <DialogDescription>
            Configure your MCP server connection settings.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Server Name */}
          <div className="space-y-2">
            <Label htmlFor="name">Server Name</Label>
            <Input
              id="name"
              placeholder="My MCP Server"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          {/* Transport Type */}
          <div className="space-y-2">
            <Label>Transport Type</Label>
            <div className="grid grid-cols-3 gap-2">
              <Button
                type="button"
                variant={transportType === 'stdio' ? 'default' : 'outline'}
                className="flex items-center gap-2"
                onClick={() => setTransportType('stdio')}
              >
                <Terminal className="h-4 w-4" />
                STDIO
              </Button>
              <Button
                type="button"
                variant={transportType === 'sse' ? 'default' : 'outline'}
                className="flex items-center gap-2"
                onClick={() => setTransportType('sse')}
              >
                <Radio className="h-4 w-4" />
                SSE
              </Button>
              <Button
                type="button"
                variant={transportType === 'streamable-http' ? 'default' : 'outline'}
                className="flex items-center gap-2"
                onClick={() => setTransportType('streamable-http')}
              >
                <Globe className="h-4 w-4" />
                HTTP
              </Button>
            </div>
          </div>

          {/* STDIO Configuration */}
          {transportType === 'stdio' && (
            <>
              <div className="space-y-2">
                <Label htmlFor="command">Command</Label>
                <Input
                  id="command"
                  placeholder="npx -y @modelcontextprotocol/server-filesystem"
                  value={command}
                  onChange={(e) => setCommand(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="args">Arguments (space-separated)</Label>
                <Input
                  id="args"
                  placeholder="/path/to/directory"
                  value={args}
                  onChange={(e) => setArgs(e.target.value)}
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
                />
              </div>
            </>
          )}

          {/* HTTP/SSE Configuration */}
          {transportType !== 'stdio' && (
            <>
              <div className="space-y-2">
                <Label htmlFor="url">Server URL</Label>
                <Input
                  id="url"
                  placeholder="https://mcp.example.com/server"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
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
                />
              </div>

              {/* OAuth Settings */}
              <div className="border rounded-lg p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Shield className="h-4 w-4 text-muted-foreground" />
                    <Label className="cursor-pointer" htmlFor="oauth-toggle">
                      OAuth 2.1 Authentication
                    </Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="oauth-toggle"
                      checked={oauthEnabled}
                      onChange={(e) => setOauthEnabled(e.target.checked)}
                      className="h-4 w-4"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0"
                      onClick={() => setShowOAuthSettings(!showOAuthSettings)}
                    >
                      {showOAuthSettings ? (
                        <ChevronUp className="h-4 w-4" />
                      ) : (
                        <ChevronDown className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </div>

                {showOAuthSettings && oauthEnabled && (
                  <div className="text-sm text-muted-foreground pt-2 border-t">
                    <p>
                      OAuth settings will be automatically discovered from the server's
                      metadata. The client will handle Dynamic Client Registration (DCR)
                      and PKCE automatically.
                    </p>
                  </div>
                )}
              </div>
            </>
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
