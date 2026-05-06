import { JSONPath } from 'jsonpath-plus';
import type { Cell, NotebookInput } from './notebookTypes';

const TEMPLATE_REGEX = /\{\{\s*(\$\..+?)\s*\}\}/g;

export type ResolutionContext = {
  cells: Record<number, unknown>;
  vars: Record<string, unknown>;
  inputs: Record<string, unknown>;
};

export function buildContext(
  cells: Cell[],
  inputs: NotebookInput[],
  inputValues: Record<string, unknown>,
  upToCellIndex: number
): ResolutionContext {
  const ctx: ResolutionContext = { cells: {}, vars: {}, inputs: {} };

  for (let i = 0; i < upToCellIndex; i++) {
    const cell = cells[i];
    if (cell.last_execution) {
      ctx.cells[i] = cell.last_execution.response;
      if (cell.output_name) {
        ctx.vars[cell.output_name] = cell.last_execution.response;
      }
    }
  }

  for (const input of inputs) {
    ctx.inputs[input.name] =
      inputValues[input.name] !== undefined
        ? inputValues[input.name]
        : input.defaultValue;
  }

  return ctx;
}

export type ResolveResult =
  | { ok: true; resolved: string }
  | { ok: false; error: string };

export function resolveTemplates(
  requestBody: string,
  context: ResolutionContext
): ResolveResult {
  let error: string | null = null;

  const resolved = requestBody.replace(TEMPLATE_REGEX, (match, path: string) => {
    if (error) return match;

    try {
      const results = JSONPath({ path, json: context, wrap: true });
      if (!results || results.length === 0) {
        error = `Path ${path} resolved to undefined`;
        return match;
      }
      const value = results[0];
      if (typeof value === 'string') return value;
      if (typeof value === 'number' || typeof value === 'boolean') return String(value);
      return JSON.stringify(value);
    } catch (e) {
      error = `Failed to resolve ${path}: ${e instanceof Error ? e.message : String(e)}`;
      return match;
    }
  });

  if (error) return { ok: false, error };
  return { ok: true, resolved };
}

export function extractTemplateTokens(requestBody: string): string[] {
  const tokens: string[] = [];
  let m: RegExpExecArray | null;
  const regex = new RegExp(TEMPLATE_REGEX.source, 'g');
  while ((m = regex.exec(requestBody)) !== null) {
    tokens.push(m[1]);
  }
  return tokens;
}

export function previewToken(
  path: string,
  context: ResolutionContext
): { value: unknown; found: boolean } {
  try {
    const results = JSONPath({ path, json: context, wrap: true });
    if (!results || results.length === 0) return { value: undefined, found: false };
    return { value: results[0], found: true };
  } catch {
    return { value: undefined, found: false };
  }
}
