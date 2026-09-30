import { createContext, useContext } from 'react'

export const RouterContext = createContext(null)

export function useOptionalRouter() {
  return useContext(RouterContext)
}
