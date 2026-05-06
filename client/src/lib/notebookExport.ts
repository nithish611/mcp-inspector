import { z } from 'zod';
import type { Notebook, NotebookExport } from './notebookTypes';

const SECRET_PATTERNS = [/Bearer\s+\S+/i, /sk-\S+/, /api[_-]?key/i, /password/i, /secret/i];
const DESTRUCTIVE_PATTERNS = [/^terminate/i, /^delete/i, /^remove/i, /^drop/i];

export function detectSecrets(notebook: Notebook): string[] {
  const warnings: string[] = [];
  notebook.cells.forEach((cell, i) => {
    for (const pattern of SECRET_PATTERNS) {
      if (pattern.test(cell.request_body)) {
        warnings.push(`Cell ${i} ("${cell.tool_name}") may contain secrets (matched: ${pattern.source})`);
        break;
      }
    }
  });
  return warnings;
}

export function detectDestructiveTools(cells: Array<{ tool_name: string }>): string[] {
  const found: string[] = [];
  for (const cell of cells) {
    for (const pattern of DESTRUCTIVE_PATTERNS) {
      if (pattern.test(cell.tool_name)) {
        found.push(cell.tool_name);
        break;
      }
    }
  }
  return found;
}

export function exportNotebook(notebook: Notebook, serverName: string): NotebookExport {
  return {
    mcpnb_version: '1.0',
    id: notebook.id,
    title: notebook.title,
    created_at: notebook.created_at,
    updated_at: notebook.updated_at,
    server_ref: { name: serverName },
    inputs: notebook.inputs,
    cells: notebook.cells.map((c) => ({
      id: c.id,
      tool_name: c.tool_name,
      output_name: c.output_name,
      request_body: c.request_body,
      history: [] as [],
    })),
  };
}

const notebookExportSchema = z.object({
  mcpnb_version: z.literal('1.0'),
  id: z.string(),
  title: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
  server_ref: z.object({ name: z.string() }),
  inputs: z.array(
    z.object({
      name: z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/),
      type: z.enum(['string', 'number', 'boolean', 'json']),
      defaultValue: z.unknown(),
      description: z.string().optional(),
    })
  ),
  cells: z.array(
    z.object({
      id: z.string(),
      tool_name: z.string(),
      output_name: z.string().optional(),
      request_body: z.string(),
      history: z.array(z.unknown()),
    })
  ),
});

export type ImportResult =
  | { ok: true; data: z.infer<typeof notebookExportSchema> }
  | { ok: false; error: string };

export function validateImport(data: unknown): ImportResult {
  const result = notebookExportSchema.safeParse(data);
  if (!result.success) {
    const issue = result.error.issues[0];
    return { ok: false, error: `Invalid notebook: ${issue.path.join('.')} — ${issue.message}` };
  }
  return { ok: true, data: result.data };
}

export function importToNotebook(
  data: z.infer<typeof notebookExportSchema>,
  serverId: string
): Notebook {
  return {
    id: crypto.randomUUID(),
    mcpnb_version: '1.0',
    title: data.title,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    server_id: serverId,
    inputs: data.inputs,
    cells: data.cells.map((c) => ({
      id: crypto.randomUUID(),
      tool_name: c.tool_name,
      output_name: c.output_name,
      request_body: c.request_body,
      history: [],
    })),
  };
}
