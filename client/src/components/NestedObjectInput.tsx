import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { ChevronDown, ChevronRight, Plus, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

interface SchemaNode {
  type?: string
  properties?: Record<string, SchemaNode>
  items?: SchemaNode
  description?: string
  required?: string[]
  enum?: unknown[]
  default?: unknown
  additionalProperties?: boolean | SchemaNode
}

interface NestedObjectInputProps {
  schema: SchemaNode
  value: string
  onChange: (value: string) => void
  depth?: number
}

export function NestedObjectInput({ schema, value, onChange, depth = 0 }: NestedObjectInputProps) {
  const [obj, setObj] = useState<Record<string, unknown>>(() => {
    try { return JSON.parse(value) || {} } catch { return {} }
  })
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  useEffect(() => {
    try {
      const parsed = JSON.parse(value)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        setObj(parsed)
      }
    } catch { /* keep current */ }
  }, [value])

  const updateField = useCallback((key: string, fieldValue: unknown) => {
    const newObj = { ...obj, [key]: fieldValue }
    setObj(newObj)
    onChange(JSON.stringify(newObj, null, 2))
  }, [obj, onChange])

  const toggleCollapse = (key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  const properties = schema.properties || {}
  const required = schema.required || []

  if (Object.keys(properties).length === 0) {
    return null
  }

  return (
    <div className={cn(
      'space-y-2',
      depth > 0 && 'pl-3 border-l-2 border-primary/20 ml-1'
    )}>
      {Object.entries(properties).map(([key, propSchema]) => {
        const isRequired = required.includes(key)
        const currentValue = obj[key]

        return (
          <div key={key} className="space-y-1">
            <div className="flex items-center gap-1.5">
              {(propSchema.type === 'object' && propSchema.properties) && (
                <button
                  className="p-0.5 hover:bg-muted rounded"
                  onClick={() => toggleCollapse(key)}
                >
                  {collapsed.has(key)
                    ? <ChevronRight className="h-3 w-3 text-muted-foreground" />
                    : <ChevronDown className="h-3 w-3 text-muted-foreground" />
                  }
                </button>
              )}
              <Label className="text-xs flex items-center gap-1.5">
                {key}
                {isRequired && <span className="text-destructive text-[10px]">*</span>}
                <Badge variant="outline" className="text-[9px] px-1 py-0 h-3.5">
                  {propSchema.type || 'any'}
                </Badge>
              </Label>
            </div>
            {propSchema.description && (
              <p className="text-[10px] text-muted-foreground leading-tight">{propSchema.description}</p>
            )}

            {/* Nested object with properties */}
            {propSchema.type === 'object' && propSchema.properties && !collapsed.has(key) ? (
              <NestedObjectInput
                schema={propSchema}
                value={currentValue ? JSON.stringify(currentValue) : '{}'}
                onChange={(v) => {
                  try { updateField(key, JSON.parse(v)) } catch { updateField(key, {}) }
                }}
                depth={depth + 1}
              />
            ) : propSchema.type === 'object' && propSchema.properties && collapsed.has(key) ? (
              <div className="text-[10px] text-muted-foreground italic px-2">collapsed</div>
            ) : propSchema.type === 'boolean' ? (
              <select
                className="w-full h-8 px-2 text-xs rounded-md border border-border bg-background"
                value={currentValue === true ? 'true' : currentValue === false ? 'false' : ''}
                onChange={(e) => {
                  if (e.target.value === '') updateField(key, undefined)
                  else updateField(key, e.target.value === 'true')
                }}
              >
                <option value="">—</option>
                <option value="true">true</option>
                <option value="false">false</option>
              </select>
            ) : propSchema.enum ? (
              <select
                className="w-full h-8 px-2 text-xs rounded-md border border-border bg-background"
                value={currentValue != null ? String(currentValue) : ''}
                onChange={(e) => updateField(key, e.target.value)}
              >
                <option value="">Select...</option>
                {propSchema.enum.map((v, i) => (
                  <option key={i} value={String(v)}>{String(v)}</option>
                ))}
              </select>
            ) : propSchema.type === 'number' || propSchema.type === 'integer' ? (
              <Input
                className="h-8 text-xs"
                type="number"
                placeholder={`Enter ${key}`}
                value={currentValue != null ? String(currentValue) : ''}
                onChange={(e) => updateField(key, e.target.value ? Number(e.target.value) : undefined)}
              />
            ) : propSchema.type === 'array' ? (
              <ArrayInput
                schema={propSchema}
                value={Array.isArray(currentValue) ? currentValue : []}
                onChange={(v) => updateField(key, v)}
              />
            ) : (
              /* string or unknown type */
              <Input
                className="h-8 text-xs"
                placeholder={`Enter ${key}`}
                value={currentValue != null ? String(currentValue) : ''}
                onChange={(e) => updateField(key, e.target.value || undefined)}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}

function ArrayInput({ schema, value, onChange }: {
  schema: SchemaNode
  value: unknown[]
  onChange: (value: unknown[]) => void
}) {
  const itemSchema = schema.items || { type: 'string' }

  const addItem = () => {
    if (itemSchema.type === 'object' && itemSchema.properties) {
      onChange([...value, {}])
    } else if (itemSchema.type === 'number' || itemSchema.type === 'integer') {
      onChange([...value, 0])
    } else if (itemSchema.type === 'boolean') {
      onChange([...value, false])
    } else {
      onChange([...value, ''])
    }
  }

  const updateItem = (index: number, itemValue: unknown) => {
    const newArr = [...value]
    newArr[index] = itemValue
    onChange(newArr)
  }

  const removeItem = (index: number) => {
    onChange(value.filter((_, i) => i !== index))
  }

  return (
    <div className="space-y-1.5 pl-2 border-l-2 border-muted-foreground/20 ml-1">
      {value.map((item, index) => (
        <div key={index} className="flex items-start gap-1.5">
          <span className="text-[9px] text-muted-foreground mt-2 font-mono w-4">[{index}]</span>
          <div className="flex-1">
            {itemSchema.type === 'object' && itemSchema.properties ? (
              <NestedObjectInput
                schema={itemSchema}
                value={JSON.stringify(item || {})}
                onChange={(v) => {
                  try { updateItem(index, JSON.parse(v)) } catch { /* ignore */ }
                }}
                depth={2}
              />
            ) : (
              <Input
                className="h-7 text-xs"
                value={item != null ? String(item) : ''}
                onChange={(e) => updateItem(index, e.target.value)}
              />
            )}
          </div>
          <button
            className="p-1 mt-1 text-muted-foreground hover:text-destructive rounded"
            onClick={() => removeItem(index)}
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      ))}
      <button
        className="flex items-center gap-1 text-[10px] text-primary hover:text-primary/80 py-1"
        onClick={addItem}
      >
        <Plus className="h-3 w-3" />
        Add item
      </button>
    </div>
  )
}
