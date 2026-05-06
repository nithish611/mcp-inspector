import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import type { NotebookInput } from '@/lib/notebookTypes';
import { useNotebookStore } from '@/stores/notebookStore';
import { Plus, Trash2 } from 'lucide-react';

const INPUT_NAME_REGEX = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

const TYPE_OPTIONS = [
  { value: 'string', label: 'string' },
  { value: 'number', label: 'number' },
  { value: 'boolean', label: 'boolean' },
  { value: 'json', label: 'json' },
];

export function NotebookInputsPanel() {
  const { getActiveNotebook, updateInputs, inputValues, setInputValues } =
    useNotebookStore();

  const notebook = getActiveNotebook();
  if (!notebook) return null;

  const inputs = notebook.inputs;

  const handleAddInput = () => {
    const name = `input${inputs.length + 1}`;
    updateInputs([
      ...inputs,
      { name, type: 'string', defaultValue: '', description: '' },
    ]);
  };

  const handleRemoveInput = (index: number) => {
    updateInputs(inputs.filter((_, i) => i !== index));
  };

  const handleUpdateInput = (index: number, updates: Partial<NotebookInput>) => {
    updateInputs(
      inputs.map((input, i) => (i === index ? { ...input, ...updates } : input))
    );
  };

  const handleValueChange = (name: string, value: string) => {
    setInputValues({ ...inputValues, [name]: value });
  };

  const hasDuplicateNames = () => {
    const names = inputs.map((i) => i.name);
    return new Set(names).size !== names.length;
  };

  return (
    <div className="border-b border-border px-3 py-2 bg-muted/20">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            Notebook Inputs
          </span>
          <Badge variant="secondary" className="text-[10px]">
            {inputs.length}
          </Badge>
          {hasDuplicateNames() && (
            <Badge variant="destructive" className="text-[10px]">
              Duplicate names
            </Badge>
          )}
        </div>
        <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={handleAddInput}>
          <Plus className="h-3 w-3 mr-1" />
          Add
        </Button>
      </div>

      {inputs.length === 0 ? (
        <p className="text-xs text-muted-foreground py-1">
          No inputs defined. Add inputs to parameterize this notebook.
        </p>
      ) : (
        <div className="space-y-2">
          {inputs.map((input, i) => (
            <div key={i} className="flex items-start gap-2">
              <div className="flex-1 grid grid-cols-[1fr_80px_1fr_1fr] gap-2 items-center">
                <Input
                  value={input.name}
                  onChange={(e) => handleUpdateInput(i, { name: e.target.value })}
                  placeholder="name"
                  className={`h-7 text-xs font-mono ${
                    !INPUT_NAME_REGEX.test(input.name) ? 'border-destructive' : ''
                  }`}
                />
                <Select
                  value={input.type}
                  onChange={(e) =>
                    handleUpdateInput(i, { type: e.target.value as NotebookInput['type'] })
                  }
                  options={TYPE_OPTIONS}
                  className="h-7 text-xs"
                />
                <Input
                  value={String(input.defaultValue ?? '')}
                  onChange={(e) => handleUpdateInput(i, { defaultValue: e.target.value })}
                  placeholder="default"
                  className="h-7 text-xs"
                />
                <Input
                  value={
                    inputValues[input.name] !== undefined
                      ? String(inputValues[input.name])
                      : String(input.defaultValue ?? '')
                  }
                  onChange={(e) => handleValueChange(input.name, e.target.value)}
                  placeholder="current value"
                  className="h-7 text-xs bg-background"
                />
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-destructive shrink-0"
                onClick={() => handleRemoveInput(i)}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          ))}
          <div className="flex text-[10px] text-muted-foreground gap-2 pl-0.5">
            <span className="flex-1">Name</span>
            <span className="w-20">Type</span>
            <span className="flex-1">Default</span>
            <span className="flex-1">Value</span>
            <span className="w-7" />
          </div>
        </div>
      )}
    </div>
  );
}
