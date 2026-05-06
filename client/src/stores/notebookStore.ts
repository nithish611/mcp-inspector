import { create } from 'zustand';
import type { Cell, CellExecution, Notebook, NotebookInput } from '@/lib/notebookTypes';
import * as db from '@/lib/notebookDb';

const MAX_HISTORY = 20;
const AUTOSAVE_DELAY = 2000;
const RESPONSE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_RESPONSE_SIZE = 1_000_000;

function truncateResponse(response: unknown): unknown {
  const json = JSON.stringify(response);
  if (json.length <= MAX_RESPONSE_SIZE) return response;
  return {
    _truncated: true,
    size_bytes: json.length,
    preview: json.slice(0, 1024),
  };
}

function isResponseExpired(execution: CellExecution): boolean {
  const age = Date.now() - new Date(execution.executed_at).getTime();
  return age > RESPONSE_TTL_MS;
}

function makeCell(toolName: string = ''): Cell {
  return {
    id: crypto.randomUUID(),
    tool_name: toolName,
    request_body: '{}',
    history: [],
  };
}

function makeNotebook(serverId: string, title?: string): Notebook {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    mcpnb_version: '1.0',
    title: title || 'Untitled Notebook',
    created_at: now,
    updated_at: now,
    server_id: serverId,
    inputs: [],
    cells: [makeCell()],
  };
}

interface NotebookState {
  notebooks: Notebook[];
  activeNotebookId: string | null;
  activeCellId: string | null;
  isRunningAll: boolean;
  runAllProgress: { current: number; total: number } | null;
  continueOnError: boolean;
  variablesDrawerOpen: boolean;
  inputValues: Record<string, unknown>;
  initialized: boolean;

  init: () => Promise<void>;
  createNotebook: (serverId: string, title?: string) => Notebook;
  deleteNotebook: (id: string) => void;
  duplicateNotebook: (id: string) => void;
  setActiveNotebook: (id: string | null) => void;
  setActiveCell: (id: string | null) => void;
  updateNotebookTitle: (id: string, title: string) => void;
  getActiveNotebook: () => Notebook | undefined;
  getNotebooksForServer: (serverId: string) => Notebook[];

  addCell: (afterCellId?: string) => void;
  deleteCell: (cellId: string) => void;
  moveCell: (cellId: string, direction: 'up' | 'down') => void;
  reorderCells: (fromIndex: number, toIndex: number) => void;
  forkCell: (cellId: string) => void;
  updateCellToolName: (cellId: string, toolName: string) => void;
  updateCellOutputName: (cellId: string, outputName: string) => void;
  updateCellRequestBody: (cellId: string, requestBody: string) => void;
  recordCellExecution: (cellId: string, execution: CellExecution) => void;

  updateInputs: (inputs: NotebookInput[]) => void;
  setInputValues: (values: Record<string, unknown>) => void;
  setContinueOnError: (value: boolean) => void;
  setIsRunningAll: (value: boolean, progress?: { current: number; total: number } | null) => void;
  toggleVariablesDrawer: () => void;

  importNotebook: (notebook: Notebook) => void;
}

let autosaveTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleSave(notebook: Notebook) {
  if (autosaveTimer) clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    db.saveNotebook(notebook);
  }, AUTOSAVE_DELAY);
}

function mutateActiveNotebook(
  state: NotebookState,
  fn: (nb: Notebook) => Notebook
): Partial<NotebookState> {
  const nb = state.notebooks.find((n) => n.id === state.activeNotebookId);
  if (!nb) return {};
  const updated = fn({ ...nb, updated_at: new Date().toISOString() });
  const notebooks = state.notebooks.map((n) => (n.id === updated.id ? updated : n));
  scheduleSave(updated);
  return { notebooks };
}

export const useNotebookStore = create<NotebookState>()((set, get) => ({
  notebooks: [],
  activeNotebookId: null,
  activeCellId: null,
  isRunningAll: false,
  runAllProgress: null,
  continueOnError: false,
  variablesDrawerOpen: false,
  inputValues: {},
  initialized: false,

  init: async () => {
    if (get().initialized) return;
    const notebooks = await db.getAllNotebooks();
    // Expire stale responses
    for (const nb of notebooks) {
      for (const cell of nb.cells) {
        if (cell.last_execution && isResponseExpired(cell.last_execution)) {
          cell.last_execution = undefined;
        }
      }
    }
    set({ notebooks, initialized: true });
  },

  createNotebook: (serverId, title) => {
    const nb = makeNotebook(serverId, title);
    set((state) => ({
      notebooks: [...state.notebooks, nb],
      activeNotebookId: nb.id,
      activeCellId: nb.cells[0]?.id || null,
      inputValues: {},
    }));
    db.saveNotebook(nb);
    return nb;
  },

  deleteNotebook: (id) => {
    set((state) => {
      const notebooks = state.notebooks.filter((n) => n.id !== id);
      const activeNotebookId =
        state.activeNotebookId === id
          ? notebooks[0]?.id || null
          : state.activeNotebookId;
      return { notebooks, activeNotebookId, activeCellId: null };
    });
    db.deleteNotebook(id);
  },

  duplicateNotebook: (id) => {
    const nb = get().notebooks.find((n) => n.id === id);
    if (!nb) return;
    const now = new Date().toISOString();
    const dup: Notebook = {
      ...nb,
      id: crypto.randomUUID(),
      title: `${nb.title} (copy)`,
      created_at: now,
      updated_at: now,
      cells: nb.cells.map((c) => ({
        ...c,
        id: crypto.randomUUID(),
        last_execution: undefined,
        history: [],
      })),
    };
    set((state) => ({
      notebooks: [...state.notebooks, dup],
      activeNotebookId: dup.id,
      activeCellId: dup.cells[0]?.id || null,
    }));
    db.saveNotebook(dup);
  },

  setActiveNotebook: (id) => {
    const nb = id ? get().notebooks.find((n) => n.id === id) : undefined;
    set({
      activeNotebookId: id,
      activeCellId: nb?.cells[0]?.id || null,
      inputValues: {},
    });
  },

  setActiveCell: (id) => set({ activeCellId: id }),

  updateNotebookTitle: (id, title) => {
    set((state) => {
      const notebooks = state.notebooks.map((n) =>
        n.id === id ? { ...n, title, updated_at: new Date().toISOString() } : n
      );
      const updated = notebooks.find((n) => n.id === id);
      if (updated) scheduleSave(updated);
      return { notebooks };
    });
  },

  getActiveNotebook: () => {
    const state = get();
    return state.notebooks.find((n) => n.id === state.activeNotebookId);
  },

  getNotebooksForServer: (serverId) => {
    return get().notebooks.filter((n) => n.server_id === serverId);
  },

  addCell: (afterCellId) => {
    set((state) => {
      const result = mutateActiveNotebook(state, (nb) => {
        const newCell = makeCell();
        const cells = [...nb.cells];
        if (afterCellId) {
          const idx = cells.findIndex((c) => c.id === afterCellId);
          cells.splice(idx + 1, 0, newCell);
        } else {
          cells.push(newCell);
        }
        return { ...nb, cells };
      });
      const nb = (result.notebooks as Notebook[])?.find(
        (n) => n.id === state.activeNotebookId
      );
      const lastCell = nb?.cells[nb.cells.length - 1];
      return { ...result, activeCellId: afterCellId ? undefined : lastCell?.id } as Partial<NotebookState>;
    });
    // Fix: set activeCellId to the newly added cell
    const state = get();
    const nb = state.notebooks.find((n) => n.id === state.activeNotebookId);
    if (nb && afterCellId) {
      const idx = nb.cells.findIndex((c) => c.id === afterCellId);
      if (idx >= 0 && idx + 1 < nb.cells.length) {
        set({ activeCellId: nb.cells[idx + 1].id });
      }
    }
  },

  deleteCell: (cellId) => {
    set((state) => {
      const result = mutateActiveNotebook(state, (nb) => ({
        ...nb,
        cells: nb.cells.filter((c) => c.id !== cellId),
      }));
      let activeCellId = state.activeCellId;
      if (activeCellId === cellId) {
        const nb = (result.notebooks as Notebook[])?.find(
          (n) => n.id === state.activeNotebookId
        );
        activeCellId = nb?.cells[0]?.id || null;
      }
      return { ...result, activeCellId };
    });
  },

  moveCell: (cellId, direction) => {
    set((state) =>
      mutateActiveNotebook(state, (nb) => {
        const cells = [...nb.cells];
        const idx = cells.findIndex((c) => c.id === cellId);
        if (idx < 0) return nb;
        const newIdx = direction === 'up' ? idx - 1 : idx + 1;
        if (newIdx < 0 || newIdx >= cells.length) return nb;
        [cells[idx], cells[newIdx]] = [cells[newIdx], cells[idx]];
        return { ...nb, cells };
      })
    );
  },

  reorderCells: (fromIndex, toIndex) => {
    set((state) =>
      mutateActiveNotebook(state, (nb) => {
        const cells = [...nb.cells];
        const [moved] = cells.splice(fromIndex, 1);
        cells.splice(toIndex, 0, moved);
        return { ...nb, cells };
      })
    );
  },

  forkCell: (cellId) => {
    set((state) => {
      const result = mutateActiveNotebook(state, (nb) => {
        const idx = nb.cells.findIndex((c) => c.id === cellId);
        if (idx < 0) return nb;
        const source = nb.cells[idx];
        const forked: Cell = {
          id: crypto.randomUUID(),
          tool_name: source.tool_name,
          request_body: source.request_body,
          history: [],
        };
        const cells = [...nb.cells];
        cells.splice(idx + 1, 0, forked);
        return { ...nb, cells };
      });
      // Focus the forked cell
      const nb = (result.notebooks as Notebook[])?.find(
        (n) => n.id === state.activeNotebookId
      );
      if (nb) {
        const idx = nb.cells.findIndex((c) => c.id === cellId);
        if (idx >= 0 && idx + 1 < nb.cells.length) {
          return { ...result, activeCellId: nb.cells[idx + 1].id };
        }
      }
      return result;
    });
  },

  updateCellToolName: (cellId, toolName) => {
    set((state) =>
      mutateActiveNotebook(state, (nb) => ({
        ...nb,
        cells: nb.cells.map((c) =>
          c.id === cellId ? { ...c, tool_name: toolName } : c
        ),
      }))
    );
  },

  updateCellOutputName: (cellId, outputName) => {
    set((state) =>
      mutateActiveNotebook(state, (nb) => ({
        ...nb,
        cells: nb.cells.map((c) =>
          c.id === cellId ? { ...c, output_name: outputName || undefined } : c
        ),
      }))
    );
  },

  updateCellRequestBody: (cellId, requestBody) => {
    set((state) =>
      mutateActiveNotebook(state, (nb) => ({
        ...nb,
        cells: nb.cells.map((c) =>
          c.id === cellId ? { ...c, request_body: requestBody } : c
        ),
      }))
    );
  },

  recordCellExecution: (cellId, execution) => {
    const stored: CellExecution = {
      ...execution,
      response: truncateResponse(execution.response),
    };
    set((state) =>
      mutateActiveNotebook(state, (nb) => ({
        ...nb,
        cells: nb.cells.map((c) => {
          if (c.id !== cellId) return c;
          const history = [stored, ...c.history].slice(0, MAX_HISTORY);
          return { ...c, last_execution: stored, history };
        }),
      }))
    );
  },

  updateInputs: (inputs) => {
    set((state) => mutateActiveNotebook(state, (nb) => ({ ...nb, inputs })));
  },

  setInputValues: (values) => set({ inputValues: values }),

  setContinueOnError: (value) => set({ continueOnError: value }),

  setIsRunningAll: (value, progress) =>
    set({ isRunningAll: value, runAllProgress: progress || null }),

  toggleVariablesDrawer: () =>
    set((state) => ({ variablesDrawerOpen: !state.variablesDrawerOpen })),

  importNotebook: (notebook) => {
    set((state) => ({
      notebooks: [...state.notebooks, notebook],
      activeNotebookId: notebook.id,
      activeCellId: notebook.cells[0]?.id || null,
      inputValues: {},
    }));
    db.saveNotebook(notebook);
  },
}));
