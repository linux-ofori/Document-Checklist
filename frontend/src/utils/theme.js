export const THEME_STORAGE_KEY = 'document-checklist:theme'
export const THEME_ATTRIBUTE = 'data-theme'
export const THEMES = { LIGHT: 'light', DARK: 'dark' }
export const DEFAULT_THEME = THEMES.LIGHT

const THEME_COLORS = {
  [THEMES.LIGHT]: '#f7f8fa',
  [THEMES.DARK]: '#10141b',
}

export function isTheme(value) {
  return value === THEMES.LIGHT || value === THEMES.DARK
}

export function getSystemTheme() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return DEFAULT_THEME
  }

  return window.matchMedia('(prefers-color-scheme: dark)').matches ? THEMES.DARK : THEMES.LIGHT
}

export function getStoredTheme() {
  if (typeof window === 'undefined') return null

  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY)
    return isTheme(stored) ? stored : null
  } catch {
    return null
  }
}

export function storeTheme(theme) {
  if (typeof window === 'undefined' || !isTheme(theme)) return

  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme)
  } catch {
    // Storage can be unavailable (private mode, blocked cookies) - the theme still applies for the session.
  }
}

export function resolveInitialTheme() {
  return getStoredTheme() ?? getSystemTheme()
}

export function applyTheme(theme) {
  if (typeof document === 'undefined') return

  const resolvedTheme = isTheme(theme) ? theme : DEFAULT_THEME
  const root = document.documentElement

  root.setAttribute(THEME_ATTRIBUTE, resolvedTheme)
  root.style.colorScheme = resolvedTheme

  const themeColorMeta = document.querySelector('meta[name="theme-color"]')
  if (themeColorMeta) {
    themeColorMeta.setAttribute('content', THEME_COLORS[resolvedTheme])
  }
}

