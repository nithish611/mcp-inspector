import type { CompletionItem } from '@/components/JsonEditor';
import type { Cell, NotebookInput } from './notebookTypes';

function flattenPaths(
  obj: unknown,
  prefix: string,
  depth: number,
  maxDepth: number,
  results: CompletionItem[]
) {
  if (depth >= maxDepth || obj === null || obj === undefined) return;

  if (Array.isArray(obj)) {
    results.push({
      label: prefix,
      insertText: `{{ ${prefix} }}`,
      detail: `Array(${obj.length})`,
    });
    obj.forEach((item, i) => {
      flattenPaths(item, `${prefix}[${i}]`, depth + 1, maxDepth, results);
    });
  } else if (typeof obj === 'object') {
    results.push({
      label: prefix,
      insertText: `{{ ${prefix} }}`,
      detail: `Object(${Object.keys(obj as object).length} keys)`,
    });
    for (const [key, val] of Object.entries(obj as object)) {
      flattenPaths(val, `${prefix}.${key}`, depth + 1, maxDepth, results);
    }
  } else {
    const display =
      typeof obj === 'string'
        ? obj.length > 30
          ? `"${obj.slice(0, 30)}..."`
          : `"${obj}"`
        : String(obj);
    results.push({
      label: prefix,
      insertText: `{{ ${prefix} }}`,
      detail: display,
    });
  }
}

export function buildCompletionItems(
  cells: Cell[],
  currentCellIndex: number,
  inputs: NotebookInput[],
  inputValues: Record<string, unknown>
): CompletionItem[] {
  const items: CompletionItem[] = [];
  const MAX_DEPTH = 4;

  // $.inputs.*
  for (const input of inputs) {
    const value =
      inputValues[input.name] !== undefined
        ? inputValues[input.name]
        : input.defaultValue;
    items.push({
      label: `$.inputs.${input.name}`,
      insertText: `{{ $.inputs.${input.name} }}`,
      detail: value !== undefined ? String(value) : `(${input.type})`,
    });
  }

  // $.vars.* and $.cells.N from prior cells
  for (let i = 0; i < currentCellIndex; i++) {
    const cell = cells[i];
    const response = cell.last_execution?.response;

    // $.cells.N
    if (response !== undefined) {
      flattenPaths(response, `$.cells.${i}`, 0, MAX_DEPTH, items);
    } else {
      items.push({
        label: `$.cells.${i}`,
        insertText: `{{ $.cells.${i} }}`,
        detail: '(not executed)',
      });
    }

    // $.vars.<name>
    if (cell.output_name) {
      if (response !== undefined) {
        flattenPaths(response, `$.vars.${cell.output_name}`, 0, MAX_DEPTH, items);
      } else {
        items.push({
          label: `$.vars.${cell.output_name}`,
          insertText: `{{ $.vars.${cell.output_name} }}`,
          detail: '(not executed)',
        });
      }
    }
  }

  return items;
}
