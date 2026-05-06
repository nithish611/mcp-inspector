export type CellExecution = {
  executed_at: string;
  duration_ms: number;
  status: "success" | "error";
  request_body_resolved: unknown;
  response: unknown;
  error?: { code: string; message: string };
};

export type Cell = {
  id: string;
  tool_name: string;
  output_name?: string;
  request_body: string;
  last_execution?: CellExecution;
  history: CellExecution[];
};

export type NotebookInput = {
  name: string;
  type: "string" | "number" | "boolean" | "json";
  defaultValue: unknown;
  description?: string;
};

export type Notebook = {
  id: string;
  mcpnb_version: "1.0";
  title: string;
  created_at: string;
  updated_at: string;
  server_id: string;
  inputs: NotebookInput[];
  cells: Cell[];
};

export type CellState = "idle" | "running" | "success" | "error";

export function getCellState(cell: Cell): CellState {
  if (!cell.last_execution) return "idle";
  return cell.last_execution.status;
}

export type NotebookExport = {
  mcpnb_version: "1.0";
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  server_ref: { name: string };
  inputs: NotebookInput[];
  cells: Array<{
    id: string;
    tool_name: string;
    output_name?: string;
    request_body: string;
    history: [];
  }>;
};
