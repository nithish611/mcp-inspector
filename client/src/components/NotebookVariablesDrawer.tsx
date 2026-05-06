import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn, copyToClipboard } from '@/lib/utils';
import { useNotebookStore } from '@/stores/notebookStore';
import { ChevronDown, ChevronRight, Copy, Variable, X } from 'lucide-react';
import { useState } from 'react';

interface TreeNodeProps {
  label: string;
  path: string;
  value: unknown;
  depth: number;
}

function TreeNode({ label, path, value, depth }: TreeNodeProps) {
  const [expanded, setExpanded] = useState(depth < 2);

  const isExpandable =
    value !== null &&
    value !== undefined &&
    typeof value === 'object';

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    copyToClipboard(`{{ ${path} }}`, 'JSONPath');
  };

  const displayValue = isExpandable
    ? Array.isArray(value)
      ? `Array(${(value as unknown[]).length})`
      : `Object(${Object.keys(value as object).length})`
    : value === null
    ? 'null'
    : value === undefined
    ? 'undefined'
    : typeof value === 'string'
    ? `"${value.length > 40 ? value.slice(0, 40) + '...' : value}"`
    : String(value);

  return (
    <div>
      <div
        className={cn(
          'flex items-center gap-1 py-0.5 px-1 rounded-sm hover:bg-muted cursor-pointer group text-xs',
          !isExpandable && 'pl-5'
        )}
        style={{ paddingLeft: `${depth * 12 + 4}px` }}
        onClick={() => isExpandable && setExpanded(!expanded)}
      >
        {isExpandable && (
          expanded ? (
            <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
          )
        )}
        <span className="font-mono text-blue-500 dark:text-blue-400 shrink-0">{label}</span>
        <span className="text-muted-foreground mx-0.5">:</span>
        <span className="text-foreground/70 truncate flex-1 font-mono">{displayValue}</span>
        <button
          className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-muted-foreground/10 shrink-0"
          onClick={handleCopy}
          title={`Copy {{ ${path} }}`}
        >
          <Copy className="h-3 w-3 text-muted-foreground" />
        </button>
      </div>
      {isExpandable && expanded && (
        <div>
          {Array.isArray(value)
            ? (value as unknown[]).map((item, i) => (
                <TreeNode
                  key={i}
                  label={`[${i}]`}
                  path={`${path}[${i}]`}
                  value={item}
                  depth={depth + 1}
                />
              ))
            : Object.entries(value as object).map(([key, val]) => (
                <TreeNode
                  key={key}
                  label={key}
                  path={`${path}.${key}`}
                  value={val}
                  depth={depth + 1}
                />
              ))}
        </div>
      )}
    </div>
  );
}

export function NotebookVariablesDrawer() {
  const { variablesDrawerOpen, toggleVariablesDrawer, getActiveNotebook, inputValues } =
    useNotebookStore();

  const notebook = getActiveNotebook();

  if (!variablesDrawerOpen || !notebook) return null;

  return (
    <div className="w-72 border-l border-border bg-background flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <div className="flex items-center gap-1.5">
          <Variable className="h-4 w-4 text-muted-foreground" />
          <span className="text-xs font-semibold">Variables</span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={toggleVariablesDrawer}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-2 space-y-3">
          {/* Inputs section */}
          {notebook.inputs.length > 0 && (
            <div>
              <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide px-1 mb-1">
                $.inputs
              </div>
              {notebook.inputs.map((input) => (
                <TreeNode
                  key={input.name}
                  label={input.name}
                  path={`$.inputs.${input.name}`}
                  value={
                    inputValues[input.name] !== undefined
                      ? inputValues[input.name]
                      : input.defaultValue
                  }
                  depth={0}
                />
              ))}
            </div>
          )}

          {/* Named vars section */}
          {notebook.cells.some((c) => c.output_name) && (
            <div>
              <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide px-1 mb-1">
                $.vars
              </div>
              {notebook.cells
                .filter((c) => c.output_name)
                .map((cell) => (
                  <TreeNode
                    key={cell.id}
                    label={cell.output_name!}
                    path={`$.vars.${cell.output_name}`}
                    value={
                      cell.last_execution
                        ? cell.last_execution.response
                        : undefined
                    }
                    depth={0}
                  />
                ))}
            </div>
          )}

          {/* Cells section */}
          <div>
            <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide px-1 mb-1">
              $.cells
            </div>
            {notebook.cells.map((cell, i) => (
              <TreeNode
                key={cell.id}
                label={String(i)}
                path={`$.cells.${i}`}
                value={
                  cell.last_execution
                    ? cell.last_execution.response
                    : undefined
                }
                depth={0}
              />
            ))}
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}
