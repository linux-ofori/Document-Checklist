import { useEffect } from 'react'

export function useBodyScrollLock(isLocked) {
  useEffect(() => {
    if (!isLocked) return undefined

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [isLocked])
}