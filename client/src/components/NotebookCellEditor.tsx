import { JsonEditor } from '@/components/JsonEditor';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { Tool } from '@/hooks/useApi';
import type { Cell } from '@/lib/notebookTypes';
import { buildCompletionItems } from '@/lib/templateSuggestions';
import { cn } from '@/lib/utils';
import { useNotebookStore } from '@/stores/notebookStore';
import {
  Copy,
  Loader2,
  Play,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

interface NotebookCellEditorProps {
  cell: Cell;
  tools: Tool[];
  isExecuting: boolean;
  onExecute: () => void;
}

export function NotebookCellEditor({
  cell,
  tools,
  isExecuting,
  onExecute,
}: NotebookCellEditorProps) {
  const {
    updateCellToolName,
    updateCellOutputName,
    updateCellRequestBody,
    deleteCell,
    forkCell,
    getActiveNotebook,
    inputValues,
  } = useNotebookStore();

  const notebook = getActiveNotebook();
  const cellIndex = notebook?.cells.findIndex((c) => c.id === cell.id) ?? -1;

  const completionItems = useMemo(() => {
    if (!notebook || cellIndex < 0) return [];
    return buildCompletionItems(notebook.cells, cellIndex, notebook.inputs, inputValues);
  }, [notebook, cellIndex, inputValues]);

  const [toolSearch, setToolSearch] = useState('');
  const [showToolDropdown, setShowToolDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const selectedTool = useMemo(
    () => tools.find((t) => t.name === cell.tool_name),
    [tools, cell.tool_name]
  );

  const filteredTools = useMemo(() => {
    if (!toolSearch.trim()) return tools.slice(0, 50);
    const q = toolSearch.toLowerCase();
    return tools
      .filter(
        (t) =>
          t.name.toLowerCase().includes(q) ||
          t.description?.toLowerCase().includes(q)
      )
      .slice(0, 50);
  }, [tools, toolSearch]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowToolDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelectTool = useCallback(
    (tool: Tool) => {
      updateCellToolName(cell.id, tool.name);
      setToolSearch('');
      setShowToolDropdown(false);
      // Set default request body from schema
      const props = tool.inputSchema.properties || {};
      const defaults: Record<string, unknown> = {};
      Object.entries(props).forEach(([key, value]) => {
        const schema = value as { type?: string; default?: unknown };
        if (schema.default !== undefined) {
          defaults[key] = schema.default;
        } else if (schema.type === 'string') {
          defaults[key] = '';
        } else if (schema.type === 'number' || schema.type === 'integer') {
          defaults[key] = 0;
        } else if (schema.type === 'boolean') {
          defaults[key] = false;
        } else if (schema.type === 'array') {
          defaults[key] = [];
        } else if (schema.type === 'object') {
          defaults[key] = {};
        }
      });
      updateCellRequestBody(cell.id, JSON.stringify(defaults, null, 2));
    },
    [cell.id, updateCellToolName, updateCellRequestBody]
  );

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="flex-shrink-0 space-y-2 p-3 pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm flex items-center gap-2 flex-1 min-w-0">
            {/* Tool selector */}
            <div className="relative flex-1 min-w-0" ref={dropdownRef}>
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  value={showToolDropdown ? toolSearch : cell.tool_name || ''}
                  placeholder="Search tools..."
                  className="h-8 pl-7 pr-8 text-sm font-mono"
                  onFocus={() => {
                    setToolSearch('');
                    setShowToolDropdown(true);
                  }}
                  onChange={(e) => {
                    setToolSearch(e.target.value);
                    setShowToolDropdown(true);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') setShowToolDropdown(false);
                    if (e.key === 'Enter' && filteredTools.length > 0) {
                      handleSelectTool(filteredTools[0]);
                    }
                  }}
                />
                {cell.tool_name && !showToolDropdown && (
                  <button
                    className="absolute right-2 top-1/2 -translate-y-1/2"
                    onClick={() => {
                      updateCellToolName(cell.id, '');
                      setShowToolDropdown(true);
                    }}
                  >
                    <X className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" />
                  </button>
                )}
              </div>

              {showToolDropdown && (
                <div className="absolute top-full left-0 right-0 mt-1 z-50 bg-popover border border-border rounded-md shadow-lg max-h-64 overflow-auto">
                  {filteredTools.length === 0 ? (
                    <div className="px-3 py-4 text-center text-xs text-muted-foreground">
                      No tools match "{toolSearch}"
                    </div>
                  ) : (
                    filteredTools.map((tool) => (
                      <button
                        key={tool.name}
                        className={cn(
                          'w-full text-left px-3 py-2 hover:bg-muted cursor-pointer',
                          tool.name === cell.tool_name && 'bg-primary/5'
                        )}
                        onClick={() => handleSelectTool(tool)}
                      >
                        <p className="font-mono text-xs font-medium truncate">
                          {tool.name}
                        </p>
                        {tool.description && (
                          <p className="text-[10px] text-muted-foreground truncate mt-0.5">
                            {tool.description}
                          </p>
                        )}
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          </CardTitle>

          <div className="flex items-center gap-1.5 shrink-0">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => forkCell(cell.id)}
              title="Fork cell (⌘D)"
            >
              <Copy className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-destructive hover:text-destructive"
              onClick={() => {
                if (cell.last_execution) {
                  if (!confirm('Delete this executed cell?')) return;
                }
                deleteCell(cell.id);
              }}
              title="Delete cell (⌘⌫)"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
            <Button
              size="sm"
              className="h-7"
              onClick={onExecute}
              disabled={!cell.tool_name || isExecuting}
              title="Execute (⌘↵)"
            >
              {isExecuting ? (
                <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
              ) : (
                <Play className="h-3.5 w-3.5 mr-1" />
              )}
              Run
            </Button>
          </div>
        </div>

        {/* Output name */}
        <div className="flex items-center gap-2">
          <Label className="text-xs text-muted-foreground shrink-0">Output name</Label>
          <Input
            value={cell.output_name || ''}
            onChange={(e) => updateCellOutputName(cell.id, e.target.value)}
            placeholder="e.g. worker"
            className="h-6 text-xs font-mono flex-1 max-w-48"
          />
          {selectedTool?.description && (
            <p className="text-[10px] text-muted-foreground truncate flex-1">
              {selectedTool.description}
            </p>
          )}
        </div>
      </CardHeader>

      <CardContent className="flex-1 overflow-hidden min-h-0 p-3 pt-0">
        <div className="h-full">
          <JsonEditor
            value={cell.request_body}
            onChange={(val) => updateCellRequestBody(cell.id, val)}
            height="100%"
            schema={selectedTool?.inputSchema}
            completionItems={completionItems}
          />
        </div>
      </CardContent>
    </Card>
  );
}
