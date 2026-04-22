# MCP Workbench — Notebook-Style Workflow Builder: Design Spec

**Date:** 2026-04-22
**Status:** Approved
**PRD:** See root-level PRD document
**Scope:** All 5 epics (Cells & Execution, Variable Passing, Persistence & Sharing, History & Replay, Keyboard & Command Palette)

---

## Architecture Decision: Thin Notebook Layer

The notebook is a thin orchestration layer on top of existing Inspector primitives. No new execution pipeline — cells call tools via the same `useCallTool` hook that `ToolsTab` uses. New code is limited to: notebook state management, template resolution, cell list UI, and the variables drawer.

## UI Placement

- **New "Notebooks" tab** added to the main tab bar alongside Tools, Resources, Prompts, Logs
- Icon: `BookOpen` from lucide-react
- Keyboard shortcut: `Cmd+4` (Logs shifts to `Cmd+5`)
- Notebooks are scoped to the active server — switching servers in the sidebar switches which notebooks are visible

## Layout: Split Panel (IDE-style)

The NotebooksTab mirrors the ToolsTab layout:

- **Left panel (25%):** Cell list — compact cards showing tool name, output alias, execution status. Drag-to-reorder via `dnd-kit`. "+ Add Cell" button at bottom.
- **Right panel (75%):** Active cell detail, split vertically:
  - **Top half:** Tool selector (type-ahead fuzzy search) + args editor (reuses `JsonEditor`, supports JSON and form modes)
  - **Bottom half:** Result viewer (reuses `JsonEditor` read-only + `McpAppViewer` for UI tools)
- **Variables drawer:** Slide-out from right edge, toggled via `Cmd+B` or toolbar button

Above the split panel: `NotebookToolbar` with notebook title (editable), Run All button, cell count, export/import buttons, and inputs panel toggle.

---

## 1. Data Model

```typescript
type Notebook = {
  id: string;                    // crypto.randomUUID()
  mcpnb_version: "1.0";
  title: string;
  created_at: string;            // ISO 8601
  updated_at: string;
  server_id: string;             // references serversStore server ID
  inputs: NotebookInput[];
  cells: Cell[];
};

type NotebookInput = {
  name: string;                  // /^[a-zA-Z_][a-zA-Z0-9_]*$/
  type: "string" | "number" | "boolean" | "json";
  defaultValue: unknown;
  description?: string;
};

type Cell = {
  id: string;                    // crypto.randomUUID(), stable across reorders
  tool_name: string;
  output_name?: string;          // alias for $.vars.<name>
  request_body: string;          // raw JSON with {{ }} templates
  last_execution?: CellExecution;
  history: CellExecution[];      // capped at 20
};

type CellExecution = {
  executed_at: string;
  duration_ms: number;
  status: "success" | "error";
  request_body_resolved: unknown;  // after template resolution
  response: unknown;
  error?: { code: string; message: string };
};
```

### Export Format

Same shape as `Notebook` but:
- Strips `last_execution` and `history` from all cells
- Replaces `server_id` with `server_ref: { name: string }` for portability
- Never includes auth tokens or persona identities
- File extension: `.mcpnb.json`
- Top-level key: `mcpnb_version: "1.0"`

---

## 2. Storage Layer

- **Engine:** IndexedDB via `idb` wrapper library (not localStorage — 5MB limit is too tight for notebooks with cached responses)
- **Object store:** `notebooks` keyed by notebook ID
- **Persistence:** Zustand store with custom IndexedDB persistence middleware (not `zustand/persist` with localStorage)
- **Auto-save:** Debounced at 2 seconds after any change
- **Cell history:** Stored inline, capped at 20 entries per cell
- **Response TTL:** Cached execution responses expire after 24 hours (stale responses show a "re-execute" prompt)
- **Response size limit:** Responses truncated at 1MB for storage. Oversized responses get a placeholder: `{ "_truncated": true, "size_bytes": N, "preview": "<first 1KB>" }`. Cell shows "Response too large — re-execute to view full result."
- **Migration hooks:** Schema version stored in IndexedDB for future upgrades

---

## 3. Template Resolution Engine

### Syntax

```
{{ $.cells.0.response.workers[0].associateOID }}
{{ $.vars.worker.associateOID }}
{{ $.inputs.workerEmail }}
```

### Implementation

- **Regex:** `/\{\{\s*(\$\..+?)\s*\}\}/g`
- **Library:** `jsonpath-plus` — safe, no `eval()`
- **Resolution context** built fresh per cell execution:

```typescript
const context = {
  cells: {
    0: cells[0].last_execution?.response,
    1: cells[1].last_execution?.response,
  },
  vars: {
    worker: cellWithOutputName("worker")?.last_execution?.response,
  },
  inputs: {
    workerEmail: "nithish@aquera.com",
  },
};
```

- Single-value results inlined as strings
- Object/array results JSON-serialized
- Circular references impossible by design (sequential execution, can only reference prior cells)

### Error Handling

| Condition | Behavior |
|---|---|
| Referenced cell not executed | Red underline in editor + abort: "Cell 0 has not been executed" |
| JSONPath resolves to `undefined` | Abort: "Path $.vars.worker.foo resolved to undefined" |
| Invalid JSON after resolution | Abort: "Invalid JSON after template resolution" |

### Monaco Integration

- Custom tokenizer highlights `{{ }}` expressions in pink/magenta
- Hover tooltip shows resolved value (if referenced cell has been executed)
- Unresolved expressions show red underline with error tooltip

### Security

- Strict JSONPath only — no `eval()`, no `new Function()`
- Imported notebooks validated against Zod schema before any template is touched
- Template resolution is pure data lookup, no code execution

---

## 4. Component Architecture

### New Files

| File | Purpose |
|---|---|
| `stores/notebookStore.ts` | Zustand store — notebooks CRUD, cell management, execution state |
| `lib/templateEngine.ts` | Template regex, JSONPath resolution, context builder |
| `lib/notebookDb.ts` | IndexedDB wrapper via `idb` — persistence layer |
| `lib/notebookExport.ts` | Export/import logic, Zod schema validation, secret detection |
| `components/NotebooksTab.tsx` | Main tab component — split panel layout |
| `components/NotebookCellList.tsx` | Left panel — cell list with drag reorder, add/delete |
| `components/NotebookCellEditor.tsx` | Right panel top — tool selector (type-ahead) + args editor |
| `components/NotebookCellResult.tsx` | Right panel bottom — result viewer |
| `components/NotebookToolbar.tsx` | Notebook header — title, Run All, export/import, inputs |
| `components/NotebookVariablesDrawer.tsx` | Slide-out drawer — browsable output tree |
| `components/NotebookInputsPanel.tsx` | Notebook-level input variables editor |
| `components/CommandPalette.tsx` | `Cmd+K` overlay — fuzzy search across commands |

### Reused From Existing Code

- `JsonEditor` — args editing and result display (as-is)
- `useCallTool` hook — tool execution (as-is)
- `useTools` hook — tool list for type-ahead (as-is)
- `McpAppViewer` — UI tool results (as-is)
- `ScrollArea`, `Badge`, `Button`, `Card`, `Dialog`, `Input`, `Label` — all UI primitives
- `react-resizable-panels` — split panel layout
- `@monaco-editor/react` — custom tokenizer for `{{ }}` is additive
- Persona integration — inherited from `activeServer.activePersona`, no separate handling

### New Dependencies

| Package | Purpose | Size |
|---|---|---|
| `idb` | IndexedDB wrapper | ~3KB gzip |
| `jsonpath-plus` | JSONPath evaluation | ~8KB gzip |
| `zod` | Schema validation for import | ~13KB gzip |
| `@dnd-kit/core` + `@dnd-kit/sortable` | Drag-and-drop cell reorder | ~20KB gzip |

### Layout Wiring in `Layout.tsx`

- Add `NotebooksTab` as new `TabsTrigger` + `TabsContent`
- Icon: `BookOpen` from lucide-react
- Tab order: Tools, Resources, Prompts, Notebooks, Logs
- Keyboard shortcut: `Cmd+4` (Logs shifts to `Cmd+5`)

---

## 5. Cell Execution Flow

### Single Cell

1. User focuses a cell → `Cmd+Enter` or clicks Execute
2. Template engine scans `request_body` for `{{ }}` tokens
3. Resolve each token against context (prior cell responses + vars + inputs)
4. If any token fails → abort with inline error, highlight broken token
5. Parse resolved string as JSON → if invalid, abort
6. Call `useCallTool.mutateAsync({ serverId, name: cell.tool_name, arguments: resolvedArgs, personaEmail })`
7. Store `CellExecution` in `cell.last_execution`, push to `cell.history` (cap at 20)
8. Auto-save notebook to IndexedDB (debounced)

### Run All

1. `Cmd+Shift+Enter` or "Run All" button
2. If notebook has inputs → show confirmation dialog with current values (editable)
3. Execute cells sequentially: 0, 1, 2, ...
4. Progress indicator: "Running cell 2 of 5"
5. On failure: halt by default. "Continue on error" toggle overrides.
6. Each cell's result immediately available to subsequent cells
7. Total execution time displayed on completion

### Cell States

`idle | running | success | error` — shown as badges in the cell list. Running gets a spinner, success gets green check + duration, error gets red indicator.

---

## 6. Keyboard Shortcuts

### Reassigned

| Shortcut | Old Action | New Action |
|---|---|---|
| `Cmd+K` | Clear Logs | Command Palette |
| `Cmd+Shift+K` | (none) | Clear Logs |

### Global Shortcuts

| Shortcut | Action |
|---|---|
| `Cmd+K` | Command palette |
| `Cmd+1` | Tools tab |
| `Cmd+2` | Resources tab |
| `Cmd+3` | Prompts tab |
| `Cmd+4` | Notebooks tab |
| `Cmd+5` | Logs tab |
| `Cmd+Shift+K` | Clear logs |
| `Cmd+D` | Toggle theme |
| `Cmd+L` | Toggle logs |

### Notebook-Specific Shortcuts (when Notebooks tab focused)

| Shortcut | Action |
|---|---|
| `Cmd+Enter` | Execute focused cell |
| `Cmd+Shift+Enter` | Run All |
| `Cmd+N` | New cell below current |
| `Cmd+D` | Duplicate/fork current cell |
| `Cmd+Backspace` | Delete current cell (confirm if executed) |
| `Alt+↑` / `Alt+↓` | Move cell up/down |
| `j` / `k` | Navigate between cells (when not in editor) |
| `i` | Enter edit mode on focused cell |
| `Esc` | Exit edit mode / close drawers |
| `Cmd+B` | Toggle Variables drawer |

`j`/`k`/`i` only activate when cell list has focus and Monaco editor does not (gated by `isCellListFocused` state flag).

**Shortcut conflict resolution:** `Cmd+D` means "Duplicate cell" when Notebooks tab is active and "Toggle theme" otherwise. Notebook-specific shortcuts take precedence over global shortcuts when the Notebooks tab has focus.

### Command Palette (`Cmd+K`)

- Fuzzy search overlay, VS Code-style
- Commands: New Notebook, Import Notebook, Export Notebook, Add Cell, Run All, Run Cell, Switch Server, Go to Cell N, Toggle Variables, Toggle Theme, Clear Logs
- Recent commands surface at top
- `Esc` closes
- Standalone `CommandPalette.tsx`, rendered in `Layout.tsx`
- Command registry pattern: each tab registers its own commands

---

## 7. Export, Import & Sharing

### Export

1. "Export" button in toolbar + command palette
2. Transform notebook → export format (strip executions, replace server_id with server_ref)
3. **Secret detection:** Scan `request_body` strings for patterns (`Bearer `, `sk-`, `api_key`, `password`, `secret`). Warn if found.
4. Download as `<title>.mcpnb.json`

### Import

1. File picker or drag-and-drop onto Notebooks tab
2. Validate against Zod schema — clear error messages on failure
3. **Destructive tool warning:** Scan `tool_name` fields for `terminate`, `delete`, `remove`, `drop`. Warn if found.
4. **Server resolution:** If `server_ref.name` doesn't match any configured server, prompt user to select one from a dropdown
5. Create new notebook with fresh UUID, bind to selected server

### Duplicate

- Right-click cell list header or command palette → "Duplicate Notebook"
- Copy titled `<original> (copy)`, all cells, no cached executions, fresh UUID

---

## 8. History & Fork

### Cell Execution History

- Each cell stores up to 20 past executions in `cell.history[]`
- "History" button on active cell's result panel → opens dialog
- Each entry: timestamp, duration, status, request body (resolved), response body
- "Restore" copies entry's resolved request body back to args editor (as static JSON, templates stripped)
- "Diff" opens side-by-side Monaco diff editor: historical response vs. current

### Fork a Cell

- "Fork" button on active cell (also `Cmd+D`)
- Creates identical cell below source
- Copies `tool_name` and `request_body`
- Clears `output_name` (would conflict), `last_execution`, `history`
- Focus moves to new cell

---

## 9. Variables Drawer

- Slide-out from right edge, toggled via `Cmd+B` or toolbar button
- Tree view of resolution context:
  ```
  $.inputs
    workerEmail: "nithish@aquera.com"
    newProficiency: "Fluent"
  $.vars
    worker: { associateOID: "G3FEH...", ... }
    languages: [{ id: "lang-1", ... }]
  $.cells
    0: { associateOID: "G3FEH...", ... }
    1: [{ id: "lang-1", ... }]
  ```
- Nodes expandable/collapsible
- Click any leaf or node → copies JSONPath to clipboard: `{{ $.vars.worker.associateOID }}`
- Updates live after each cell execution
- Built with recursive React components (no tree library)
- Grayed out entries for cells not yet executed

---

## 10. Implementation Phases

Each phase is independently shippable. Architecture from Phase 1 supports all later phases without refactoring.

| Phase | Scope | Epics |
|---|---|---|
| **Phase 1 — MVP** | NotebooksTab shell, notebookStore, notebookDb, cell list, cell editor, cell execution (static request bodies), IndexedDB persistence | Epic 1, Epic 3.1 |
| **Phase 2 — Variables** | Template engine, Monaco `{{ }}` tokenizer, variables drawer, named variables, notebook inputs panel | Epic 2 |
| **Phase 3 — Sharing** | Export/import with Zod validation, secret detection, destructive tool warning, server resolution, duplicate | Epic 3.2–3.4 |
| **Phase 4 — Polish** | Cell history, fork, diff viewer, command palette, full keyboard shortcuts | Epic 4, Epic 5 |

---

## 11. Open Questions Resolved

| Question | Resolution |
|---|---|
| Cell referencing by index vs. ID | Support both `$.cells.0` and `$.vars.name`. Recommend named variables as primary mechanism. |
| Response size limits | Truncate at 1MB for storage with placeholder. Full result available via re-execution. |
| Secret handling on export | Detect common patterns and warn. User makes final decision. |
