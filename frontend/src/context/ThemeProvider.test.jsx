import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ThemeToggle } from '../components/ui/ThemeToggle'
import { useTheme } from '../hooks/useTheme'
import { ThemeProvider } from './ThemeProvider'
import { THEME_STORAGE_KEY, THEMES } from '../utils/theme'

function ThemeState() {
  const { theme } = useTheme()
  return <output data-testid="active-theme">{theme}</output>
}

function renderTheme() {
  return render(
    <ThemeProvider>
      <ThemeToggle showLabel />
      <ThemeState />
    </ThemeProvider>,
  )
}

function mockSystemTheme(matches) {
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches })))
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  window.localStorage.clear()
  document.documentElement.removeAttribute('data-theme')
  document.documentElement.style.colorScheme = ''
})

describe('ThemeProvider', () => {
  it('prefers a valid stored theme over the system preference', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, THEMES.DARK)
    mockSystemTheme(false)

    renderTheme()

    expect(screen.getByTestId('active-theme').textContent).toBe(THEMES.DARK)
    expect(document.documentElement.getAttribute('data-theme')).toBe(THEMES.DARK)
  })

  it.each([
    ['missing', null],
    ['invalid', 'sepia'],
  ])('uses the system theme when stored theme is %s', (_label, storedTheme) => {
    if (storedTheme !== null) {
      window.localStorage.setItem(THEME_STORAGE_KEY, storedTheme)
    }
    mockSystemTheme(true)

    renderTheme()

    expect(screen.getByTestId('active-theme').textContent).toBe(THEMES.DARK)
    expect(document.documentElement.getAttribute('data-theme')).toBe(THEMES.DARK)
  })

  it('falls back to light when the system theme cannot be read', () => {
    vi.stubGlobal('matchMedia', undefined)

    renderTheme()

    expect(screen.getByTestId('active-theme').textContent).toBe(THEMES.LIGHT)
    expect(document.documentElement.getAttribute('data-theme')).toBe(THEMES.LIGHT)
  })

  it('toggles the active theme and persists the selected value', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, THEMES.LIGHT)
    mockSystemTheme(true)
    renderTheme()

    fireEvent.click(screen.getByRole('button', { name: 'Switch to dark theme' }))

    expect(screen.getByTestId('active-theme').textContent).toBe(THEMES.DARK)
    expect(document.documentElement.getAttribute('data-theme')).toBe(THEMES.DARK)
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe(THEMES.DARK)
  })

  it('changes the active theme for the session if local storage fails', () => {
    mockSystemTheme(false)
    const originalSetItem = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (key, value) {
      if (key === THEME_STORAGE_KEY) {
        throw new Error('Storage is unavailable.')
      }
      return originalSetItem.call(this, key, value)
    })
    renderTheme()

    fireEvent.click(screen.getByRole('button', { name: 'Switch to dark theme' }))

    expect(screen.getByTestId('active-theme').textContent).toBe(THEMES.DARK)
    expect(document.documentElement.getAttribute('data-theme')).toBe(THEMES.DARK)
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBeNull()
  })
})
