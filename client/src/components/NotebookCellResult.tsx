import { JsonEditor } from '@/components/JsonEditor';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { Cell, CellExecution } from '@/lib/notebookTypes';
import { cn, copyToClipboard, formatDate } from '@/lib/utils';
import {
  AlertCircle,
  Clock,
  Copy,
  Expand,
  History,
  Loader2,
  Play,
} from 'lucide-react';
import { useState } from 'react';

interface NotebookCellResultProps {
  cell: Cell;
  isExecuting: boolean;
}

export function NotebookCellResult({ cell, isExecuting }: NotebookCellResultProps) {
  const [showHistory, setShowHistory] = useState(false);
  const [resultExpanded, setResultExpanded] = useState(false);
  const [diffEntry, setDiffEntry] = useState<CellExecution | null>(null);

  const exec = cell.last_execution;

  const resultText = exec
    ? typeof exec.response === 'string'
      ? exec.response
      : JSON.stringify(exec.response, null, 2)
    : '';

  const handleCopy = () => {
    if (resultText) copyToClipboard(resultText, 'Result');
  };

  return (
    <>
      <Card className="h-full flex flex-col">
        <CardHeader className="flex-shrink-0 p-3 pb-2">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-sm flex items-center gap-2">
              Result
              {isExecuting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {exec && (
                <Badge
                  variant={exec.status === 'success' ? 'secondary' : 'destructive'}
                  className="text-[10px]"
                >
                  {exec.status === 'success' ? `✓ ${exec.duration_ms}ms` : 'Error'}
                </Badge>
              )}
            </CardTitle>
            <div className="flex items-center gap-1">
              {cell.history.length > 0 && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => setShowHistory(true)}
                  title={`History (${cell.history.length} runs)`}
                >
                  <History className="h-3.5 w-3.5" />
                </Button>
              )}
              {exec && (
                <>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={handleCopy}
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => setResultExpanded(true)}
                  >
                    <Expand className="h-3.5 w-3.5" />
                  </Button>
                </>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="flex-1 overflow-hidden min-h-0 p-3 pt-0">
          {exec ? (
            <div className="h-full">
              {exec.error && (
                <div className="flex items-start gap-2 p-2 mb-2 rounded-md bg-destructive/10 border border-destructive/20 text-destructive text-xs">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                  <div>
                    {exec.error.code && <span className="font-mono">[{exec.error.code}] </span>}
                    {exec.error.message}
                  </div>
                </div>
              )}
              <JsonEditor value={resultText} readOnly height="100%" />
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
              <Play className="h-6 w-6 mb-2 opacity-50" />
              <p className="text-xs">Execute to see results</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* History dialog */}
      <Dialog open={showHistory} onOpenChange={setShowHistory}>
        <DialogContent className="max-w-4xl w-[90vw] h-[80vh] flex flex-col p-0 overflow-hidden">
          <DialogHeader className="px-6 pt-5 pb-3 flex-shrink-0 border-b border-border">
            <DialogTitle className="flex items-center gap-2 text-sm">
              <History className="h-4 w-4" />
              Execution History
              <Badge variant="secondary" className="text-xs">
                {cell.history.length} runs
              </Badge>
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 min-h-0 flex">
            {/* History list */}
            <div className="w-64 border-r border-border overflow-auto p-2 space-y-1">
              {cell.history.map((entry, i) => (
                <button
                  key={i}
                  className={cn(
                    'w-full text-left p-2 rounded-md text-xs hover:bg-muted transition-colors',
                    diffEntry === entry && 'bg-primary/10 border border-primary'
                  )}
                  onClick={() => setDiffEntry(entry)}
                >
                  <div className="flex items-center justify-between">
                    <Badge
                      variant={entry.status === 'success' ? 'secondary' : 'destructive'}
                      className="text-[10px]"
                    >
                      {entry.status}
                    </Badge>
                    <span className="text-muted-foreground">{entry.duration_ms}ms</span>
                  </div>
                  <div className="flex items-center gap-1 mt-1 text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    {formatDate(entry.executed_at)}
                  </div>
                </button>
              ))}
            </div>
            {/* History detail */}
            <div className="flex-1 min-w-0 p-4">
              {diffEntry ? (
                <div className="h-full">
                  <div className="text-xs text-muted-foreground mb-2">
                    Response at {formatDate(diffEntry.executed_at)}
                  </div>
                  <div className="h-[calc(100%-2rem)]">
                    <JsonEditor
                      value={JSON.stringify(diffEntry.response, null, 2)}
                      readOnly
                      height="100%"
                    />
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                  Select a run to view details
                </div>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Expanded result dialog */}
      <Dialog open={resultExpanded} onOpenChange={setResultExpanded}>
        <DialogContent className="max-w-[95vw] w-[95vw] h-[92vh] flex flex-col p-0 overflow-hidden">
          <DialogHeader className="px-6 pt-5 pb-3 flex-shrink-0 border-b border-border">
            <DialogTitle className="flex items-center gap-2 text-sm">
              Result
              {exec && (
                <Badge variant="outline" className="text-xs font-mono">
                  {cell.tool_name}
                </Badge>
              )}
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 min-h-0 px-6 pb-6 pt-3">
            <JsonEditor value={resultText} readOnly height="100%" />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
