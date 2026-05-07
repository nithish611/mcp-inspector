import { CommandPalette, type PaletteCommand } from '@/components/CommandPalette';
import { NotebookCellEditor } from '@/components/NotebookCellEditor';
import { NotebookCellList } from '@/components/NotebookCellList';
import { NotebookCellResult } from '@/components/NotebookCellResult';
import { NotebookInputsPanel } from '@/components/NotebookInputsPanel';
import { NotebookToolbar } from '@/components/NotebookToolbar';
import { NotebookVariablesDrawer } from '@/components/NotebookVariablesDrawer';
import { useCallTool, useTools } from '@/hooks/useApi';
import {
    detectDestructiveTools,
    detectSecrets,
    exportNotebook,
    importToNotebook,
    validateImport,
} from '@/lib/notebookExport';
import type { CellExecution } from '@/lib/notebookTypes';
import { buildContext, resolveTemplates } from '@/lib/templateEngine';
import { downloadAsFile, parseMcpResult } from '@/lib/utils';
import { useNotebookStore } from '@/stores/notebookStore';
import { useServersStore } from '@/stores/serversStore';
import { BookOpen, Wrench } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
    Panel,
    PanelGroup,
    PanelResizeHandle,
} from 'react-resizable-panels';

export function NotebooksTab() {
  const { activeServerId, servers } = useServersStore();
  const activeServer = servers.find((s) => s.id === activeServerId);
  const isConnected = activeServer?.status?.connected === true;

  const {
    initialized,
    init,
    activeNotebookId,
    activeCellId,
    isRunningAll,
    continueOnError,
    inputValues,
    getActiveNotebook,
    getNotebooksForServer,
    createNotebook,
    setActiveNotebook,
    setActiveCell,
    setIsRunningAll,
    recordCellExecution,
    importNotebook,
    addCell,
    deleteCell,
    moveCell,
    forkCell,
    toggleVariablesDrawer,
  } = useNotebookStore();

  const { data: tools } = useTools(activeServerId || '');
  const callToolMutation = useCallTool();

  const [showInputs, setShowInputs] = useState(false);
  const [executingCellId, setExecutingCellId] = useState<string | null>(null);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);

  const notebook = getActiveNotebook();
  const activeCell = notebook?.cells.find((c) => c.id === activeCellId);

  // Initialize store from IndexedDB
  useEffect(() => {
    init();
  }, [init]);

  // Auto-select first notebook for this server, or create one
  useEffect(() => {
    if (!initialized || !activeServerId || !isConnected) return;
    const serverNotebooks = getNotebooksForServer(activeServerId);
    if (serverNotebooks.length > 0) {
      if (!activeNotebookId || !serverNotebooks.find((n) => n.id === activeNotebookId)) {
        setActiveNotebook(serverNotebooks[0].id);
      }
    }
  }, [initialized, activeServerId, isConnected, activeNotebookId, getNotebooksForServer, setActiveNotebook]);

  // Execute a single cell
  const executeCell = useCallback(
    async (cellId: string) => {
      if (!notebook || !activeServerId) return;

      const cellIndex = notebook.cells.findIndex((c) => c.id === cellId);
      if (cellIndex < 0) return;
      const cell = notebook.cells[cellIndex];
      if (!cell.tool_name) return;

      setExecutingCellId(cellId);
      const startTime = Date.now();

      try {
        // Resolve templates
        const context = buildContext(
          notebook.cells,
          notebook.inputs,
          inputValues,
          cellIndex
        );
        const resolved = resolveTemplates(cell.request_body, context);

        if (!resolved.ok) {
          const execution: CellExecution = {
            executed_at: new Date().toISOString(),
            duration_ms: Date.now() - startTime,
            status: 'error',
            request_body_resolved: cell.request_body,
            response: null,
            error: { code: 'TEMPLATE_ERROR', message: resolved.error },
          };
          recordCellExecution(cellId, execution);
          return execution;
        }

        let args: Record<string, unknown>;
        try {
          args = JSON.parse(resolved.resolved);
        } catch {
          const execution: CellExecution = {
            executed_at: new Date().toISOString(),
            duration_ms: Date.now() - startTime,
            status: 'error',
            request_body_resolved: resolved.resolved,
            response: null,
            error: { code: 'JSON_ERROR', message: 'Invalid JSON after template resolution' },
          };
          recordCellExecution(cellId, execution);
          return execution;
        }

        const persona = activeServer?.activePersona;
        const result = await callToolMutation.mutateAsync({
          serverId: activeServerId,
          name: cell.tool_name,
          arguments: Object.keys(args).length > 0 ? args : undefined,
          personaEmail: persona?.email,
        });

        const parsed = parseMcpResult(result);
        // Store the unwrapped data (not the raw MCP envelope) so JSONPath
        // references like $.vars.worker.associateOID resolve directly.
        const execution: CellExecution = {
          executed_at: new Date().toISOString(),
          duration_ms: Date.now() - startTime,
          status: parsed.isError ? 'error' : 'success',
          request_body_resolved: args,
          response: parsed.data,
          error: parsed.isError
            ? { code: 'TOOL_ERROR', message: parsed.rawText.slice(0, 500) }
            : undefined,
        };
        recordCellExecution(cellId, execution);
        return execution;
      } catch (error) {
        const execution: CellExecution = {
          executed_at: new Date().toISOString(),
          duration_ms: Date.now() - startTime,
          status: 'error',
          request_body_resolved: cell.request_body,
          response: null,
          error: {
            code: 'EXECUTION_ERROR',
            message: error instanceof Error ? error.message : 'Tool execution failed',
          },
        };
        recordCellExecution(cellId, execution);
        return execution;
      } finally {
        setExecutingCellId(null);
      }
    },
    [notebook, activeServerId, activeServer, inputValues, callToolMutation, recordCellExecution]
  );

  // Run all cells
  const handleRunAll = useCallback(async () => {
    if (!notebook || isRunningAll) return;
    setIsRunningAll(true, { current: 0, total: notebook.cells.length });

    for (let i = 0; i < notebook.cells.length; i++) {
      setIsRunningAll(true, { current: i + 1, total: notebook.cells.length });
      const cell = notebook.cells[i];
      if (!cell.tool_name) continue;

      const result = await executeCell(cell.id);
      if (result?.status === 'error' && !continueOnError) {
        setActiveCell(cell.id);
        break;
      }
    }

    setIsRunningAll(false);
  }, [notebook, isRunningAll, continueOnError, executeCell, setIsRunningAll, setActiveCell]);

  // Export
  const handleExport = useCallback(() => {
    if (!notebook || !activeServer) return;
    const warnings = detectSecrets(notebook);
    if (warnings.length > 0) {
      if (!confirm(`Warning:\n${warnings.join('\n')}\n\nExport anyway?`)) return;
    }
    const exported = exportNotebook(notebook, activeServer.name);
    downloadAsFile(
      JSON.stringify(exported, null, 2),
      `${notebook.title.replace(/[^a-zA-Z0-9_-]/g, '_')}.mcpnb.json`
    );
  }, [notebook, activeServer]);

  // Import
  const handleImport = useCallback(
    (file: File) => {
      if (!activeServerId) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const data = JSON.parse(reader.result as string);
          const validation = validateImport(data);
          if (!validation.ok) {
            alert(validation.error);
            return;
          }
          const destructive = detectDestructiveTools(validation.data.cells);
          if (destructive.length > 0) {
            if (
              !confirm(
                `This notebook contains potentially destructive tools: ${destructive.join(', ')}. Import anyway?`
              )
            )
              return;
          }
          const nb = importToNotebook(validation.data, activeServerId);
          importNotebook(nb);
        } catch {
          alert('Failed to parse notebook file');
        }
      };
      reader.readAsText(file);
    },
    [activeServerId, importNotebook]
  );

  // Command palette commands
  const paletteCommands = useMemo<PaletteCommand[]>(() => {
    const cmds: PaletteCommand[] = [
      {
        id: 'new-notebook',
        label: 'New Notebook',
        category: 'Notebook',
        action: () => activeServerId && createNotebook(activeServerId),
      },
      {
        id: 'run-all',
        label: 'Run All Cells',
        shortcut: '⌘⇧↵',
        category: 'Notebook',
        action: handleRunAll,
      },
      {
        id: 'add-cell',
        label: 'Add Cell',
        shortcut: '⌘N',
        category: 'Cell',
        action: () => addCell(activeCellId || undefined),
      },
      {
        id: 'toggle-variables',
        label: 'Toggle Variables',
        shortcut: '⌘B',
        category: 'View',
        action: toggleVariablesDrawer,
      },
      {
        id: 'export-notebook',
        label: 'Export Notebook',
        category: 'Notebook',
        action: handleExport,
      },
    ];
    if (activeCellId) {
      cmds.push(
        {
          id: 'run-cell',
          label: 'Run Current Cell',
          shortcut: '⌘↵',
          category: 'Cell',
          action: () => executeCell(activeCellId),
        },
        {
          id: 'fork-cell',
          label: 'Fork Current Cell',
          shortcut: '⌘D',
          category: 'Cell',
          action: () => forkCell(activeCellId),
        },
        {
          id: 'delete-cell',
          label: 'Delete Current Cell',
          shortcut: '⌘⌫',
          category: 'Cell',
          action: () => deleteCell(activeCellId),
        }
      );
    }
    return cmds;
  }, [
    activeServerId,
    activeCellId,
    createNotebook,
    handleRunAll,
    handleExport,
    addCell,
    toggleVariablesDrawer,
    executeCell,
    forkCell,
    deleteCell,
  ]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMod = e.metaKey || e.ctrlKey;

      // Command palette
      if (isMod && e.key === 'k') {
        e.preventDefault();
        setCommandPaletteOpen(true);
        return;
      }

      // Notebook-specific shortcuts
      if (isMod && e.key === 'Enter' && !e.shiftKey) {
        if (activeCellId && !executingCellId) {
          e.preventDefault();
          executeCell(activeCellId);
        }
        return;
      }

      if (isMod && e.shiftKey && e.key === 'Enter') {
        e.preventDefault();
        handleRunAll();
        return;
      }

      if (isMod && e.key === 'b') {
        e.preventDefault();
        toggleVariablesDrawer();
        return;
      }

      if (isMod && e.key === 'n') {
        e.preventDefault();
        addCell(activeCellId || undefined);
        return;
      }

      if (isMod && e.key === 'd') {
        e.preventDefault();
        if (activeCellId) forkCell(activeCellId);
        return;
      }

      if (isMod && e.key === 'Backspace') {
        e.preventDefault();
        if (activeCellId) deleteCell(activeCellId);
        return;
      }

      // Cell navigation (only when not in editor)
      const target = e.target as HTMLElement;
      const inEditor =
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable ||
        target.closest('.monaco-editor');

      if (!inEditor && notebook) {
        if (e.key === 'j' || (e.altKey && e.key === 'ArrowDown')) {
          e.preventDefault();
          const idx = notebook.cells.findIndex((c) => c.id === activeCellId);
          if (e.altKey && activeCellId) {
            moveCell(activeCellId, 'down');
          } else if (idx < notebook.cells.length - 1) {
            setActiveCell(notebook.cells[idx + 1].id);
          }
          return;
        }

        if (e.key === 'k' || (e.altKey && e.key === 'ArrowUp')) {
          e.preventDefault();
          const idx = notebook.cells.findIndex((c) => c.id === activeCellId);
          if (e.altKey && activeCellId) {
            moveCell(activeCellId, 'up');
          } else if (idx > 0) {
            setActiveCell(notebook.cells[idx - 1].id);
          }
          return;
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    activeCellId,
    executingCellId,
    notebook,
    executeCell,
    handleRunAll,
    toggleVariablesDrawer,
    addCell,
    forkCell,
    deleteCell,
    moveCell,
    setActiveCell,
  ]);

  if (!activeServerId) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground p-8">
        <BookOpen className="h-12 w-12 mb-4 opacity-50" />
        <p className="text-lg font-medium">No Server Selected</p>
        <p className="text-sm">Select a server from the sidebar to use notebooks</p>
      </div>
    );
  }

  if (!isConnected) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground p-8">
        <BookOpen className="h-12 w-12 mb-4 opacity-50" />
        <p className="text-lg font-medium">Not Connected</p>
        <p className="text-sm">Connect to the server to use notebooks</p>
      </div>
    );
  }

  if (!notebook) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground p-8">
        <BookOpen className="h-12 w-12 mb-4 opacity-50" />
        <p className="text-lg font-medium">No Notebooks</p>
        <p className="text-sm mb-4">Create a notebook to start building workflows</p>
        <button
          className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90"
          onClick={() => createNotebook(activeServerId)}
        >
          New Notebook
        </button>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col p-2.5 gap-2">
      <NotebookToolbar
        onRunAll={handleRunAll}
        onExport={handleExport}
        onImport={handleImport}
        onToggleInputs={() => setShowInputs(!showInputs)}
        showInputs={showInputs}
      />

      {showInputs && <NotebookInputsPanel />}

      <div className="flex-1 min-h-0 flex rounded-xl border border-border/60 bg-card/70 overflow-hidden">
        <PanelGroup direction="horizontal" className="flex-1">
          {/* Cell List */}
          <Panel defaultSize={25} minSize={15} maxSize={40}>
            <NotebookCellList />
          </Panel>

          <PanelResizeHandle className="w-1.5 mx-0.5 flex items-center justify-center group">
            <div className="w-0.5 h-7 rounded-full bg-border group-hover:bg-primary/50 transition-colors" />
          </PanelResizeHandle>

          {/* Active Cell Detail */}
          <Panel defaultSize={75} minSize={40}>
            {activeCell ? (
              <PanelGroup direction="vertical" className="h-full">
                <Panel defaultSize={50} minSize={20}>
                  <NotebookCellEditor
                    cell={activeCell}
                    tools={tools || []}
                    isExecuting={executingCellId === activeCell.id}
                    onExecute={() => executeCell(activeCell.id)}
                  />
                </Panel>

                <PanelResizeHandle className="h-1.5 my-0.5 flex items-center justify-center group">
                  <div className="h-0.5 w-7 rounded-full bg-border group-hover:bg-primary/50 transition-colors" />
                </PanelResizeHandle>

                <Panel defaultSize={50} minSize={20}>
                  <NotebookCellResult
                    cell={activeCell}
                    isExecuting={executingCellId === activeCell.id}
                  />
                </Panel>
              </PanelGroup>
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                <Wrench className="h-8 w-8 mb-2 opacity-50" />
                <p className="text-sm">Select a cell to edit</p>
              </div>
            )}
          </Panel>
        </PanelGroup>

        {/* Variables Drawer */}
        <NotebookVariablesDrawer />
      </div>

      <CommandPalette
        commands={paletteCommands}
        open={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
      />
    </div>
  );
}
