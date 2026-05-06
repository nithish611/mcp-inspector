import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { HistoryEntry } from '@/stores/historyStore'
import { useThemeStore } from '@/stores/themeStore'
import { formatDate } from '@/lib/utils'
import { DiffEditor } from '@monaco-editor/react'
import { GitCompareArrows } from 'lucide-react'

interface HistoryDiffDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  entryA: HistoryEntry
  entryB: HistoryEntry
}

export function HistoryDiffDialog({ open, onOpenChange, entryA, entryB }: HistoryDiffDialogProps) {
  const { theme } = useThemeStore()

  const originalText = entryA.result.isJson
    ? JSON.stringify(entryA.result.data, null, 2)
    : entryA.result.rawText

  const modifiedText = entryB.result.isJson
    ? JSON.stringify(entryB.result.data, null, 2)
    : entryB.result.rawText

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl w-[90vw] h-[85vh] flex flex-col p-0 overflow-hidden">
        <DialogHeader className="px-6 pt-5 pb-3 flex-shrink-0 border-b border-border">
          <DialogTitle className="flex items-center gap-2 text-base">
            <GitCompareArrows className="h-4 w-4" />
            Compare Results
          </DialogTitle>
          <div className="flex items-center gap-2 text-sm text-muted-foreground mt-1">
            <Badge variant="outline" className="font-mono text-xs">
              {formatDate(new Date(entryA.timestamp))}
            </Badge>
            <span>vs</span>
            <Badge variant="outline" className="font-mono text-xs">
              {formatDate(new Date(entryB.timestamp))}
            </Badge>
          </div>
        </DialogHeader>
        <div className="flex-1 min-h-0">
          <DiffEditor
            original={originalText}
            modified={modifiedText}
            language="json"
            theme={theme === 'dark' ? 'vs-dark' : 'light'}
            options={{
              readOnly: true,
              renderSideBySide: true,
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
              fontSize: 13,
              wordWrap: 'on',
            }}
          />
        </div>
      </DialogContent>
    </Dialog>
  )
}
