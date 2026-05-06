import { useThemeStore } from '@/stores/themeStore'
import Editor, { OnMount } from '@monaco-editor/react'
import { useEffect, useRef } from 'react'

export interface CompletionItem {
  label: string
  insertText: string
  detail?: string
}

interface JsonEditorProps {
  value: string
  onChange?: (value: string) => void
  readOnly?: boolean
  height?: string | number
  schema?: object
  completionItems?: CompletionItem[]
}

export function JsonEditor({
  value,
  onChange,
  readOnly = false,
  height = '200px',
  schema,
  completionItems,
}: JsonEditorProps) {
  const { theme } = useThemeStore()
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null)
  const completionDisposableRef = useRef<{ dispose: () => void } | null>(null)

  const handleEditorDidMount: OnMount = (editor, monaco) => {
    editorRef.current = editor

    // Configure JSON schema validation if provided
    if (schema) {
      monaco.languages.json.jsonDefaults.setDiagnosticsOptions({
        validate: true,
        schemas: [
          {
            uri: 'http://myserver/schema.json',
            fileMatch: ['*'],
            schema,
          },
        ],
      })
    }

    // Register template completion provider for {{ }} expressions
    if (completionItems && completionItems.length > 0) {
      completionDisposableRef.current?.dispose()
      completionDisposableRef.current = monaco.languages.registerCompletionItemProvider('json', {
        triggerCharacters: ['{', '.', '$'],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        provideCompletionItems: (model: any, position: any) => {
          const textUntilPosition = model.getValueInRange({
            startLineNumber: position.lineNumber,
            startColumn: 1,
            endLineNumber: position.lineNumber,
            endColumn: position.column,
          })

          // Check if we're inside or starting a {{ }} template
          const templateMatch = textUntilPosition.match(/\{\{\s*(\$[\w.\[\]]*)?$/)
          if (!templateMatch) return { suggestions: [] }

          const word = model.getWordUntilPosition(position)
          const range = {
            startLineNumber: position.lineNumber,
            endLineNumber: position.lineNumber,
            startColumn: word.startColumn,
            endColumn: word.endColumn,
          }

          const suggestions = completionItems.map((item) => ({
            label: item.label,
            kind: monaco.languages.CompletionItemKind.Variable,
            insertText: item.insertText,
            detail: item.detail || '',
            range,
            sortText: item.label,
          }))

          return { suggestions }
        },
      })
    }
  }

  // Update completions when items change
  useEffect(() => {
    return () => {
      completionDisposableRef.current?.dispose()
    }
  }, [])

  const handleChange = (newValue: string | undefined) => {
    if (onChange && newValue !== undefined) {
      onChange(newValue)
    }
  }

  useEffect(() => {
    // Update editor value when prop changes
    if (editorRef.current) {
      const currentValue = editorRef.current.getValue()
      if (currentValue !== value) {
        editorRef.current.setValue(value)
      }
    }
  }, [value])

  // Determine if height is a percentage
  const isPercentageHeight = typeof height === 'string' && height.includes('%')
  
  return (
    <div 
      className="rounded-md border border-input overflow-hidden"
      style={isPercentageHeight ? { height, display: 'flex', flexDirection: 'column' } : undefined}
    >
      <Editor
        height={isPercentageHeight ? '100%' : height}
        defaultLanguage="json"
        value={value}
        onChange={handleChange}
        onMount={handleEditorDidMount}
        theme={theme === 'dark' ? 'vs-dark' : 'light'}
        options={{
          readOnly,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          fontSize: 13,
          lineNumbers: 'on',
          folding: true,
          automaticLayout: true,
          tabSize: 2,
          wordWrap: 'on',
          formatOnPaste: true,
          formatOnType: true,
          stickyScroll: { enabled: false },
          scrollbar: {
            vertical: 'auto',
            horizontal: 'auto',
          },
        }}
      />
    </div>
  )
}
