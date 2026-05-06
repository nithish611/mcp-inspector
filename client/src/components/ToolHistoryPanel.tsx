import { HistoryDiffDialog } from '@/components/HistoryDiffDialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { formatDate, formatDuration, truncateString } from '@/lib/utils'
import { useHistoryStore, type HistoryEntry } from '@/stores/historyStore'
import {
  Clock,
  Download,
  GitCompareArrows,
  Play,
  Trash2,
} from 'lucide-react'
import { useMemo, useState } from 'react'

interface ToolHistoryPanelProps {
  serverId: string
  toolName: string
  onLoadArgs: (args: Record<string, unknown>) => void
  onReplay: (args: Record<string, unknown>) => void
}

export function ToolHistoryPanel({ serverId, toolName, onLoadArgs, onReplay }: ToolHistoryPanelProps) {
  const entries = useHistoryStore((s) => s.getToolHistory(serverId, toolName))
  const clearToolHistory = useHistoryStore((s) => s.clearToolHistory)

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [diffOpen, setDiffOpen] = useState(false)

  const reversedEntries = useMemo(() => [...entries].reverse(), [entries])

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else if (next.size < 2) {
        next.add(id)
      }
      return next
    })
  }

  const selectedEntries = useMemo(() => {
    const ids = Array.from(selectedIds)
    const map = new Map(entries.map((e) => [e.id, e]))
    return ids.map((id) => map.get(id)).filter(Boolean) as HistoryEntry[]
  }, [selectedIds, entries])

  const handleClear = () => {
    clearToolHistory(serverId, toolName)
    setSelectedIds(new Set())
  }

  return (
    <>
      <CardHeader className="flex-shrink-0 p-4 pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Clock className="h-4 w-4" />
            History
            <Badge variant="secondary">{entries.length}</Badge>
          </CardTitle>
          <div className="flex items-center gap-1">
            {selectedIds.size === 2 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setDiffOpen(true)}
              >
                <GitCompareArrows className="h-3.5 w-3.5 mr-1" />
                Compare
              </Button>
            )}
            {entries.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleClear}
                title="Clear history for this tool"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex-1 overflow-hidden min-h-0 p-0">
        <ScrollArea className="h-full px-4 pb-3">
          {reversedEntries.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
              <Clock className="h-6 w-6 mb-2 opacity-50" />
              <p className="text-sm">No history yet</p>
              <p className="text-xs mt-1">Execute the tool to start recording</p>
            </div>
          ) : (
            <div className="space-y-1">
              {reversedEntries.map((entry) => (
                <div
                  key={entry.id}
                  className="group flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-muted/50 text-sm"
                >
                  <input
                    type="checkbox"
                    checked={selectedIds.has(entry.id)}
                    disabled={!selectedIds.has(entry.id) && selectedIds.size >= 2}
                    onChange={() => toggleSelect(entry.id)}
                    className="h-3.5 w-3.5 rounded border-border flex-shrink-0 cursor-pointer accent-primary"
                  />
                  <span className="font-mono text-xs text-muted-foreground flex-shrink-0 w-20">
                    {formatDate(new Date(entry.timestamp))}
                  </span>
                  <Badge
                    variant={entry.isError ? 'destructive' : 'secondary'}
                    className="text-[10px] px-1.5 py-0 h-4 flex-shrink-0"
                  >
                    {entry.isError ? 'Error' : 'OK'}
                  </Badge>
                  <span className="text-xs text-muted-foreground flex-shrink-0">
                    {formatDuration(entry.durationMs)}
                  </span>
                  <span className="text-xs text-muted-foreground truncate flex-1 min-w-0">
                    {truncateString(JSON.stringify(entry.args), 60)}
                  </span>
                  <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                    <button
                      className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                      title="Load args into editor"
                      onClick={() => onLoadArgs(entry.args)}
                    >
                      <Download className="h-3.5 w-3.5" />
                    </button>
                    <button
                      className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                      title="Replay (load + execute)"
                      onClick={() => onReplay(entry.args)}
                    >
                      <Play className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </CardContent>

      {selectedEntries.length === 2 && (
        <HistoryDiffDialog
          open={diffOpen}
          onOpenChange={setDiffOpen}
          entryA={selectedEntries[0]}
          entryB={selectedEntries[1]}
        />
      )}
    </>
  )
}
