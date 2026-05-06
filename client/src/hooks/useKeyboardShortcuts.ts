import { useLogsStore } from '@/stores/logsStore'
import { useThemeStore } from '@/stores/themeStore'
import { useCallback, useEffect } from 'react'

interface ShortcutHandlers {
  onToggleTheme?: () => void
  onToggleLogs?: () => void
  onClearLogs?: () => void
  onSwitchToTools?: () => void
  onSwitchToResources?: () => void
  onSwitchToPrompts?: () => void
  onSwitchToNotebooks?: () => void
  onSwitchToLogs?: () => void
}

export function useKeyboardShortcuts(handlers: ShortcutHandlers = {}) {
  const { toggleTheme } = useThemeStore()
  const { toggleExpanded, clearLogs } = useLogsStore()

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      const isMod = event.metaKey || event.ctrlKey

      // Ignore if typing in an input (unless it's a mod combo)
      const target = event.target as HTMLElement
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) {
        return
      }

      // Cmd/Ctrl + D - Toggle dark mode (global, unless notebook tab overrides)
      if (isMod && event.key === 'd') {
        event.preventDefault()
        handlers.onToggleTheme?.() ?? toggleTheme()
        return
      }

      // Cmd/Ctrl + L - Toggle logs panel
      if (isMod && event.key === 'l') {
        event.preventDefault()
        handlers.onToggleLogs?.() ?? toggleExpanded()
        return
      }

      // Cmd/Ctrl + Shift + K - Clear logs (moved from Cmd+K)
      if (isMod && event.shiftKey && event.key === 'k') {
        event.preventDefault()
        handlers.onClearLogs?.() ?? clearLogs()
        return
      }

      // Number keys for tab switching (1-5)
      if (isMod && event.key === '1') {
        event.preventDefault()
        handlers.onSwitchToTools?.()
        return
      }

      if (isMod && event.key === '2') {
        event.preventDefault()
        handlers.onSwitchToResources?.()
        return
      }

      if (isMod && event.key === '3') {
        event.preventDefault()
        handlers.onSwitchToPrompts?.()
        return
      }

      if (isMod && event.key === '4') {
        event.preventDefault()
        handlers.onSwitchToNotebooks?.()
        return
      }

      if (isMod && event.key === '5') {
        event.preventDefault()
        handlers.onSwitchToLogs?.()
        return
      }
    },
    [handlers, toggleTheme, toggleExpanded, clearLogs]
  )

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])
}

export const keyboardShortcuts = [
  { keys: ['⌘/Ctrl', 'D'], description: 'Toggle dark mode' },
  { keys: ['⌘/Ctrl', 'L'], description: 'Toggle logs panel' },
  { keys: ['⌘/Ctrl', 'K'], description: 'Command palette' },
  { keys: ['⌘/Ctrl', '⇧', 'K'], description: 'Clear logs' },
  { keys: ['⌘/Ctrl', '1'], description: 'Switch to Tools tab' },
  { keys: ['⌘/Ctrl', '2'], description: 'Switch to Resources tab' },
  { keys: ['⌘/Ctrl', '3'], description: 'Switch to Prompts tab' },
  { keys: ['⌘/Ctrl', '4'], description: 'Switch to Notebooks tab' },
  { keys: ['⌘/Ctrl', '5'], description: 'Switch to Logs tab' },
]
