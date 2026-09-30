import { useCallback, useEffect, useMemo, useState } from 'react'

function readPath() {
  if (typeof window === 'undefined') return '/'
  return window.location.pathname
}

export function useRouterState() {
  const [path, setPath] = useState(readPath)

  useEffect(() => {
    const handlePopState = () => setPath(readPath())

    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  const navigate = useCallback((nextPath) => {
    if (!nextPath || nextPath === window.location.pathname) return

    window.history.pushState({}, '', nextPath)
    setPath(nextPath)
    window.scrollTo({ top: 0, behavior: 'auto' })
  }, [])

  const isActive = useCallback(
    (href) => path === href || (href !== '/' && path.startsWith(`${href}/`)),
    [path],
  )

  return useMemo(() => ({ path, navigate, isActive }), [path, navigate, isActive])
}
