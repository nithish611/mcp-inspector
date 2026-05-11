import { useExecutionStore, type ExecutionEntry } from '@/stores/executionStore'
import { cn } from '@/lib/utils'
import { AlertCircle, CheckCircle2, Loader2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

export function ExecutionStatusBar() {
  const executions = useExecutionStore((s) => s.executions)
  const clearCompleted = useExecutionStore((s) => s.clearCompleted)
  const [showDropdown, setShowDropdown] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const running = executions.filter((e) => e.status === 'running')
  const recent = executions.slice(0, 10)

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  if (executions.length === 0) return null

  const lastExec = executions[0]
  const hasErrors = executions.some((e) => e.status === 'error')

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        className={cn(
          'flex items-center gap-1.5 px-2 py-1 rounded-md text-xs border transition-colors hover:bg-muted/60',
          running.length > 0
            ? 'border-primary/40 bg-primary/5 text-primary'
            : hasErrors
              ? 'border-destructive/30 bg-destructive/5 text-destructive'
              : 'border-green-500/30 bg-green-500/5 text-green-600 dark:text-green-400'
        )}
        onClick={() => setShowDropdown(!showDropdown)}
        title="Execution status"
      >
        {running.length > 0 ? (
          <>
            <Loader2 className="h-3 w-3 animate-spin" />
            <span>{running.length} running</span>
          </>
        ) : lastExec.status === 'error' ? (
          <>
            <AlertCircle className="h-3 w-3" />
            <span>{lastExec.toolName}</span>
          </>
        ) : (
          <>
            <CheckCircle2 className="h-3 w-3" />
            <span>{lastExec.toolName}</span>
            {lastExec.durationMs && (
              <span className="text-[10px] opacity-70">
                {lastExec.durationMs >= 1000 ? `${(lastExec.durationMs / 1000).toFixed(1)}s` : `${lastExec.durationMs}ms`}
              </span>
            )}
          </>
        )}
      </button>

      {showDropdown && (
        <div className="absolute right-0 top-full mt-1.5 w-72 bg-popover border border-border rounded-lg shadow-lg z-50">
          <div className="flex items-center justify-between px-3 py-2 border-b border-border">
            <span className="text-xs font-medium">Recent Executions</span>
            <button
              className="text-[10px] text-muted-foreground hover:text-foreground"
              onClick={() => { clearCompleted(); setShowDropdown(false) }}
            >
              Clear
            </button>
          </div>
          <div className="max-h-64 overflow-auto py-1">
            {recent.map((exec) => (
              <ExecutionRow key={exec.id} exec={exec} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function ExecutionRow({ exec }: { exec: ExecutionEntry }) {
  const elapsed = exec.durationMs || (exec.status === 'running' ? Date.now() - exec.startTime : 0)

  return (
    <div className="px-3 py-1.5 flex items-center gap-2 hover:bg-muted/40">
      {exec.status === 'running' && <Loader2 className="h-3.5 w-3.5 animate-spin text-primary flex-shrink-0" />}
      {exec.status === 'success' && <CheckCircle2 className="h-3.5 w-3.5 text-green-500 flex-shrink-0" />}
      {exec.status === 'error' && <AlertCircle className="h-3.5 w-3.5 text-destructive flex-shrink-0" />}
      <div className="flex-1 min-w-0">
        <p className="text-xs font-mono truncate">{exec.toolName}</p>
        {exec.error && <p className="text-[10px] text-destructive truncate">{exec.error}</p>}
      </div>
      <span className="text-[10px] text-muted-foreground flex-shrink-0">
        {elapsed >= 1000 ? `${(elapsed / 1000).toFixed(1)}s` : `${elapsed}ms`}
      </span>
    </div>
  )
}

export function RunningExecutionIndicator() {
  const running = useExecutionStore((s) => s.executions.filter((e) => e.status === 'running'))
  const [, forceUpdate] = useState(0)

  useEffect(() => {
    if (running.length === 0) return
    const interval = setInterval(() => forceUpdate((n) => n + 1), 500)
    return () => clearInterval(interval)
  }, [running.length])

  if (running.length === 0) return null

  return (
    <div className="flex items-center gap-1 text-[10px] text-primary animate-pulse">
      <Loader2 className="h-3 w-3 animate-spin" />
      <span>{running.length} in progress</span>
    </div>
  )
}
