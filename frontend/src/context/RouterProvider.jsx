import { useMemo } from 'react'
import { RouterContext } from './RouterContext'
import { useRouterState } from '../hooks/useRouterState'

export function RouterProvider({ children }) {
  const router = useRouterState()
  const value = useMemo(() => router, [router])

  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>
}
