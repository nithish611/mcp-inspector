import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { getCellState, type Cell } from '@/lib/notebookTypes';
import { cn } from '@/lib/utils';
import { useNotebookStore } from '@/stores/notebookStore';
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  AlertCircle,
  CheckCircle2,
  GripVertical,
  Loader2,
  Plus,
} from 'lucide-react';

interface SortableCellProps {
  cell: Cell;
  index: number;
  isActive: boolean;
  onClick: () => void;
}

function SortableCell({ cell, index, isActive, onClick }: SortableCellProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: cell.id });

  const state = getCellState(cell);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'flex items-center gap-1.5 p-2 rounded-md border cursor-pointer transition-colors group',
        isActive
          ? 'border-primary bg-primary/5'
          : 'border-border hover:border-primary/50 hover:bg-muted/50'
      )}
      onClick={onClick}
    >
      <button
        className="cursor-grab active:cursor-grabbing text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-3.5 w-3.5" />
      </button>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-muted-foreground font-mono">[{index}]</span>
          <span className="text-xs font-mono font-medium truncate">
            {cell.tool_name || 'Select tool...'}
          </span>
        </div>
        {cell.output_name && (
          <span className="text-[10px] text-muted-foreground">
            → {cell.output_name}
          </span>
        )}
      </div>

      <div className="shrink-0">
        {state === 'running' && <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500" />}
        {state === 'success' && (
          <div className="flex items-center gap-1">
            <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
            {cell.last_execution && (
              <span className="text-[10px] text-muted-foreground">
                {cell.last_execution.duration_ms}ms
              </span>
            )}
          </div>
        )}
        {state === 'error' && <AlertCircle className="h-3.5 w-3.5 text-red-500" />}
      </div>
    </div>
  );
}

export function NotebookCellList() {
  const {
    activeCellId,
    setActiveCell,
    addCell,
    reorderCells,
    getActiveNotebook,
  } = useNotebookStore();

  const notebook = getActiveNotebook();
  const cells = notebook?.cells || [];

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = cells.findIndex((c) => c.id === active.id);
    const newIndex = cells.findIndex((c) => c.id === over.id);
    if (oldIndex >= 0 && newIndex >= 0) {
      reorderCells(oldIndex, newIndex);
    }
  };

  if (!notebook) return null;

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Cells
        </span>
        <Badge variant="secondary" className="text-[10px]">
          {cells.length}
        </Badge>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-2 space-y-1">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext items={cells.map((c) => c.id)} strategy={verticalListSortingStrategy}>
              {cells.map((cell, i) => (
                <SortableCell
                  key={cell.id}
                  cell={cell}
                  index={i}
                  isActive={cell.id === activeCellId}
                  onClick={() => setActiveCell(cell.id)}
                />
              ))}
            </SortableContext>
          </DndContext>

          <Button
            variant="ghost"
            size="sm"
            className="w-full border border-dashed border-border text-muted-foreground hover:text-foreground text-xs mt-2"
            onClick={() => addCell(cells[cells.length - 1]?.id)}
          >
            <Plus className="h-3.5 w-3.5 mr-1" />
            Add Cell
          </Button>
        </div>
      </ScrollArea>
    </div>
  );
}
