import { createContext, useContext } from 'react'

export const ThemeContext = createContext(null)

export function useOptionalTheme() {
  return useContext(ThemeContext)
}