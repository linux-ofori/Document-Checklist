import { useContext } from 'react'
import { RouterContext } from '../context/RouterContext'

export function useActiveRoute() {
  const router = useContext(RouterContext)

  if (!router) {
    throw new Error('useActiveRoute must be used inside a RouterProvider.')
  }

  return router
}
