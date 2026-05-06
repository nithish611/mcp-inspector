import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useNotebookStore } from '@/stores/notebookStore';
import {
  BookOpen,
  ChevronDown,
  Download,
  Loader2,
  Play,
  Plus,
  Settings2,
  Trash2,
  Upload,
  Variable,
} from 'lucide-react';
import { useCallback, useRef, useState } from 'react';

interface NotebookToolbarProps {
  onRunAll: () => void;
  onExport: () => void;
  onImport: (file: File) => void;
  onToggleInputs: () => void;
  showInputs: boolean;
}

export function NotebookToolbar({
  onRunAll,
  onExport,
  onImport,
  onToggleInputs,
  showInputs,
}: NotebookToolbarProps) {
  const {
    activeNotebookId,
    isRunningAll,
    runAllProgress,
    continueOnError,
    variablesDrawerOpen,
    setContinueOnError,
    toggleVariablesDrawer,
    getActiveNotebook,
    getNotebooksForServer,
    setActiveNotebook,
    createNotebook,
    deleteNotebook,
    duplicateNotebook,
    updateNotebookTitle,
  } = useNotebookStore();

  const notebook = getActiveNotebook();
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleValue, setTitleValue] = useState('');
  const [showNotebookMenu, setShowNotebookMenu] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const handleTitleClick = useCallback(() => {
    if (!notebook) return;
    setTitleValue(notebook.title);
    setIsEditingTitle(true);
  }, [notebook]);

  const handleTitleBlur = useCallback(() => {
    if (notebook && titleValue.trim()) {
      updateNotebookTitle(notebook.id, titleValue.trim());
    }
    setIsEditingTitle(false);
  }, [notebook, titleValue, updateNotebookTitle]);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) onImport(file);
      e.target.value = '';
    },
    [onImport]
  );

  // Get server_id from current notebook for creating new ones
  const serverId = notebook?.server_id;

  return (
    <div className="flex items-center gap-2 px-3 py-2 border-b border-border flex-shrink-0">
      {/* Notebook selector */}
      <div className="relative" ref={menuRef}>
        <button
          className="flex items-center gap-1.5 px-2 py-1 rounded-md hover:bg-muted transition-colors text-sm"
          onClick={() => setShowNotebookMenu(!showNotebookMenu)}
        >
          <BookOpen className="h-4 w-4 text-muted-foreground" />
          {notebook ? (
            isEditingTitle ? (
              <Input
                value={titleValue}
                onChange={(e) => setTitleValue(e.target.value)}
                onBlur={handleTitleBlur}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleTitleBlur();
                  if (e.key === 'Escape') setIsEditingTitle(false);
                }}
                className="h-6 w-48 text-sm px-1"
                autoFocus
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <span
                className="font-medium cursor-text"
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  handleTitleClick();
                }}
              >
                {notebook.title}
              </span>
            )
          ) : (
            <span className="text-muted-foreground">No notebook</span>
          )}
          <ChevronDown className="h-3 w-3 text-muted-foreground" />
        </button>

        {showNotebookMenu && (
          <div className="absolute top-full left-0 mt-1 z-50 w-72 bg-popover border border-border rounded-lg shadow-lg overflow-hidden">
            <div className="p-2 border-b border-border">
              <Button
                variant="ghost"
                size="sm"
                className="w-full justify-start text-sm"
                onClick={() => {
                  if (serverId) createNotebook(serverId);
                  setShowNotebookMenu(false);
                }}
              >
                <Plus className="h-3.5 w-3.5 mr-2" />
                New Notebook
              </Button>
            </div>
            <div className="max-h-64 overflow-auto p-1">
              {serverId &&
                getNotebooksForServer(serverId).map((nb) => (
                  <div
                    key={nb.id}
                    className={`flex items-center justify-between px-3 py-2 rounded-md cursor-pointer text-sm group ${
                      nb.id === activeNotebookId
                        ? 'bg-primary/10 text-primary'
                        : 'hover:bg-muted'
                    }`}
                  >
                    <button
                      className="flex-1 text-left truncate"
                      onClick={() => {
                        setActiveNotebook(nb.id);
                        setShowNotebookMenu(false);
                      }}
                    >
                      {nb.title}
                      <span className="text-xs text-muted-foreground ml-2">
                        {nb.cells.length} cells
                      </span>
                    </button>
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        className="p-1 rounded hover:bg-muted-foreground/10"
                        title="Duplicate"
                        onClick={(e) => {
                          e.stopPropagation();
                          duplicateNotebook(nb.id);
                          setShowNotebookMenu(false);
                        }}
                      >
                        <Plus className="h-3 w-3" />
                      </button>
                      <button
                        className="p-1 rounded hover:bg-destructive/10 text-destructive"
                        title="Delete"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (confirm(`Delete "${nb.title}"?`)) {
                            deleteNotebook(nb.id);
                          }
                        }}
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                ))}
            </div>
          </div>
        )}
      </div>

      {notebook && (
        <Badge variant="secondary" className="text-xs">
          {notebook.cells.length} cells
        </Badge>
      )}

      <div className="flex-1" />

      {/* Run All progress */}
      {isRunningAll && runAllProgress && (
        <Badge variant="outline" className="text-xs gap-1">
          <Loader2 className="h-3 w-3 animate-spin" />
          Running cell {runAllProgress.current} of {runAllProgress.total}
        </Badge>
      )}

      {/* Continue on error toggle */}
      <button
        className={`text-xs px-2 py-1 rounded-md transition-colors ${
          continueOnError
            ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
            : 'text-muted-foreground hover:bg-muted'
        }`}
        onClick={() => setContinueOnError(!continueOnError)}
        title="Continue on error"
      >
        {continueOnError ? 'Continue on error: ON' : 'Stop on error'}
      </button>

      {/* Inputs toggle */}
      <Button
        variant={showInputs ? 'secondary' : 'ghost'}
        size="sm"
        className="h-7 text-xs"
        onClick={onToggleInputs}
        disabled={!notebook}
      >
        <Settings2 className="h-3.5 w-3.5 mr-1" />
        Inputs
      </Button>

      {/* Variables drawer toggle */}
      <Button
        variant={variablesDrawerOpen ? 'secondary' : 'ghost'}
        size="sm"
        className="h-7 text-xs"
        onClick={toggleVariablesDrawer}
        disabled={!notebook}
        title="Toggle variables (⌘B)"
      >
        <Variable className="h-3.5 w-3.5 mr-1" />
        Variables
      </Button>

      {/* Export/Import */}
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        onClick={onExport}
        disabled={!notebook}
        title="Export notebook"
      >
        <Download className="h-3.5 w-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        onClick={() => fileInputRef.current?.click()}
        title="Import notebook"
      >
        <Upload className="h-3.5 w-3.5" />
      </Button>
      <input
        ref={fileInputRef}
        type="file"
        accept=".mcpnb.json,.json"
        className="hidden"
        onChange={handleFileChange}
      />

      {/* Run All */}
      <Button
        size="sm"
        onClick={onRunAll}
        disabled={!notebook || isRunningAll || notebook.cells.length === 0}
        title="Run All (⌘⇧↵)"
      >
        {isRunningAll ? (
          <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
        ) : (
          <Play className="h-4 w-4 mr-1.5" />
        )}
        Run All
      </Button>
    </div>
  );
}
