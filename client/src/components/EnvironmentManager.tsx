import { useEnvironmentStore } from '@/stores/environmentStore'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import {
  Check,
  ChevronDown,
  Plus,
  Trash2,
  Variable,
  X,
} from 'lucide-react'
import { useState, useRef, useEffect } from 'react'

export function EnvironmentManager() {
  const {
    environments,
    activeEnvironmentId,
    addEnvironment,
    removeEnvironment,
    setActiveEnvironment,
    addVariable,
    updateVariable,
    removeVariable,
  } = useEnvironmentStore()

  const [showDropdown, setShowDropdown] = useState(false)
  const [newEnvName, setNewEnvName] = useState('')
  const [showNewEnv, setShowNewEnv] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const activeEnv = environments.find((e) => e.id === activeEnvironmentId)

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleCreateEnv = () => {
    if (!newEnvName.trim()) return
    const id = addEnvironment(newEnvName.trim())
    setActiveEnvironment(id)
    setNewEnvName('')
    setShowNewEnv(false)
  }

  const handleAddVariable = () => {
    if (!activeEnvironmentId) return
    addVariable(activeEnvironmentId, '', '')
  }

  return (
    <Card variant="panel" className="h-full flex flex-col">
      <CardHeader className="flex-shrink-0 p-4 pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Variable className="h-4 w-4" />
            Environments
          </CardTitle>

          {/* Environment Selector */}
          <div className="relative" ref={dropdownRef}>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs gap-1"
              onClick={() => setShowDropdown(!showDropdown)}
            >
              <span className={cn(
                'w-2 h-2 rounded-full',
                activeEnv ? 'bg-green-500' : 'bg-muted-foreground/40'
              )} />
              {activeEnv?.name || 'No Environment'}
              <ChevronDown className="h-3 w-3" />
            </Button>

            {showDropdown && (
              <div className="absolute right-0 top-full mt-1 w-56 bg-popover border border-border rounded-lg shadow-lg z-50 py-1">
                <button
                  className={cn(
                    'w-full px-3 py-1.5 text-xs text-left hover:bg-muted/60 flex items-center gap-2',
                    !activeEnvironmentId && 'bg-muted/40'
                  )}
                  onClick={() => { setActiveEnvironment(null); setShowDropdown(false) }}
                >
                  <span className="w-2 h-2 rounded-full bg-muted-foreground/40" />
                  No Environment
                  {!activeEnvironmentId && <Check className="h-3 w-3 ml-auto" />}
                </button>
                {environments.map((env) => (
                  <div key={env.id} className="flex items-center group">
                    <button
                      className={cn(
                        'flex-1 px-3 py-1.5 text-xs text-left hover:bg-muted/60 flex items-center gap-2',
                        env.id === activeEnvironmentId && 'bg-muted/40'
                      )}
                      onClick={() => { setActiveEnvironment(env.id); setShowDropdown(false) }}
                    >
                      <span className="w-2 h-2 rounded-full bg-green-500" />
                      {env.name}
                      {env.id === activeEnvironmentId && <Check className="h-3 w-3 ml-auto" />}
                    </button>
                    <button
                      className="px-2 py-1 opacity-0 group-hover:opacity-100 hover:text-destructive transition-opacity"
                      onClick={() => removeEnvironment(env.id)}
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                ))}
                <div className="border-t border-border mt-1 pt-1">
                  {showNewEnv ? (
                    <div className="px-2 py-1 flex items-center gap-1">
                      <Input
                        className="h-6 text-xs"
                        placeholder="Environment name"
                        value={newEnvName}
                        onChange={(e) => setNewEnvName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleCreateEnv()
                          if (e.key === 'Escape') setShowNewEnv(false)
                        }}
                        autoFocus
                      />
                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={handleCreateEnv}>
                        <Check className="h-3 w-3" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setShowNewEnv(false)}>
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  ) : (
                    <button
                      className="w-full px-3 py-1.5 text-xs text-left hover:bg-muted/60 flex items-center gap-2 text-primary"
                      onClick={() => setShowNewEnv(true)}
                    >
                      <Plus className="h-3 w-3" />
                      New Environment
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="flex-1 overflow-auto p-4 pt-0">
        {activeEnv ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                Use <code className="px-1 py-0.5 bg-muted rounded text-[10px]">{'{{variable}}'}</code> in tool arguments
              </p>
              <Button variant="outline" size="sm" className="h-6 text-xs gap-1" onClick={handleAddVariable}>
                <Plus className="h-3 w-3" />
                Add
              </Button>
            </div>

            <div className="space-y-2">
              {activeEnv.variables.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-6">
                  No variables yet. Click "Add" to create one.
                </p>
              )}
              {activeEnv.variables.map((variable, index) => (
                <div key={index} className="flex items-center gap-2 group">
                  <button
                    className={cn(
                      'w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center transition-colors',
                      variable.enabled
                        ? 'bg-primary border-primary text-primary-foreground'
                        : 'border-border hover:border-primary/50'
                    )}
                    onClick={() => updateVariable(activeEnv.id, index, { enabled: !variable.enabled })}
                  >
                    {variable.enabled && <Check className="h-2.5 w-2.5" />}
                  </button>
                  <Input
                    className="h-7 text-xs font-mono flex-1"
                    placeholder="KEY"
                    value={variable.key}
                    onChange={(e) => updateVariable(activeEnv.id, index, { key: e.target.value })}
                  />
                  <Input
                    className="h-7 text-xs font-mono flex-1"
                    placeholder="value"
                    value={variable.value}
                    onChange={(e) => updateVariable(activeEnv.id, index, { value: e.target.value })}
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 opacity-0 group-hover:opacity-100 flex-shrink-0"
                    onClick={() => removeVariable(activeEnv.id, index)}
                  >
                    <Trash2 className="h-3 w-3 text-destructive" />
                  </Button>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-center gap-3 py-8">
            <Variable className="h-8 w-8 text-muted-foreground/50" />
            <div>
              <p className="text-sm text-muted-foreground">No environment selected</p>
              <p className="text-xs text-muted-foreground/70 mt-1">
                Create an environment to define variables for your tool arguments
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
