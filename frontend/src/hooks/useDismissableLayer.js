import { useEffect, useState } from 'react'

export function useDismissableLayer(isActive, onDismiss) {
  const [container, setContainer] = useState(null)

  useEffect(() => {
    if (!isActive) return undefined

    const handlePointerDown = (event) => {
      if (container && !container.contains(event.target)) onDismiss?.()
    }

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onDismiss?.()
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('touchstart', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('touchstart', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isActive, container, onDismiss])

  return setContainer
}
