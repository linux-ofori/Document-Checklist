import { createContext, useContext } from 'react'

export const AppDataContext = createContext(null)

export function useOptionalAppData() {
  return useContext(AppDataContext)
}
