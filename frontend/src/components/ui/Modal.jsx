import { useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { cn } from '../../utils/cn'
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock'
import { IconButton } from './IconButton'

const SIZES = ['sm', 'md', 'lg']
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ')

export function Modal({
  isOpen,
  onClose,
  title,
  description,
  size = 'md',
  footer,
  closeOnOverlayClick = true,
  closeOnEscape = true,
  className,
  children,
}) {
  const dialogRef = useRef(null)
  const previouslyFocusedRef = useRef(null)
  const titleId = useId()
  const descriptionId = useId()

  useBodyScrollLock(isOpen)

  useEffect(() => {
    if (!isOpen) return undefined

    previouslyFocusedRef.current = document.activeElement

    const dialog = dialogRef.current
    const focusTarget = dialog?.querySelector('[data-autofocus]') ?? dialog
    focusTarget?.focus()

    const handleKeyDown = (event) => {
      if (event.key === 'Escape' && closeOnEscape) {
        event.preventDefault()
        onClose?.()
        return
      }

      if (event.key !== 'Tab' || !dialog) return

      const focusable = Array.from(dialog.querySelectorAll(FOCUSABLE_SELECTOR))
      if (focusable.length === 0) return

      const first = focusable[0]
      const last = focusable[focusable.length - 1]

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      previouslyFocusedRef.current?.focus?.()
    }
  }, [isOpen, onClose, closeOnEscape])

  if (!isOpen) return null

  const safeSize = SIZES.includes(size) ? size : SIZES[1]

  return createPortal(
    <div
      className="ui-modal-overlay"
      onMouseDown={(event) => {
        if (closeOnOverlayClick && event.target === event.currentTarget) {
          onClose?.()
        }
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className={cn('ui-modal', `ui-modal--${safeSize}`, className)}
      >
        {title || description ? (
          <header className="ui-modal__header">
            <div className="ui-modal__header-text">
              {title ? (
                <h2 className="ui-card-title" id={titleId}>
                  {title}
                </h2>
              ) : null}
              {description ? (
                <p className="ui-body" id={descriptionId}>
                  {description}
                </p>
              ) : null}
            </div>
            <IconButton label="Close dialog" onClick={onClose}>
              <X size={18} aria-hidden="true" />
            </IconButton>
          </header>
        ) : null}

        <div className="ui-modal__body">{children}</div>

        {footer ? <footer className="ui-modal__footer">{footer}</footer> : null}
      </div>
    </div>,
    document.body,
  )
}