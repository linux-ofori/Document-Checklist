import { Moon, Sun } from 'lucide-react'
import { cn } from '../../utils/cn'
import { useTheme } from '../../hooks/useTheme'

export function ThemeToggle({ className, label, showLabel = false }) {
  const { isDark, toggleTheme } = useTheme()

  const actionLabel = isDark ? 'Switch to light theme' : 'Switch to dark theme'
  const accessibleLabel = label ?? actionLabel

  return (
    <button
      type="button"
      className={cn('ui-theme-toggle', showLabel && 'ui-theme-toggle--labelled', className)}
      onClick={toggleTheme}
      aria-label={accessibleLabel}
      aria-pressed={isDark}
      title={accessibleLabel}
    >
      {isDark ? (
        <Moon size={18} aria-hidden="true" />
      ) : (
        <Sun size={18} aria-hidden="true" />
      )}
      {showLabel ? (
        <span className="ui-theme-toggle__text">{isDark ? 'Dark' : 'Light'}</span>
      ) : null}
    </button>
  )
}