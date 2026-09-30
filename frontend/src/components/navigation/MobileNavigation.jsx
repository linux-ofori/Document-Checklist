import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Menu, Plus, X } from 'lucide-react'
import { Avatar, IconButton, ThemeToggle } from '../ui'
import { cn } from '../../utils/cn'
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock'
import { Brand } from './Brand'
import { NavigationList } from './NavigationList'

export function MobileNavigation({
  isOpen,
  onOpenChange,
  primaryItems,
  secondaryItems,
  primaryCta,
  user,
  path,
  onNavigate,
}) {
  const drawerRef = useRef(null)
  const menuButtonRef = useRef(null)

  useBodyScrollLock(isOpen)

  useEffect(() => {
    if (!isOpen) return undefined

    const drawer = drawerRef.current
    drawer?.focus()

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        onOpenChange(false)
        menuButtonRef.current?.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)

    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onOpenChange])

  const handleNavigate = (href) => {
    onNavigate?.(href)
    onOpenChange(false)
  }

  return createPortal(
    <>
      <header className="app-mobilebar">
        <IconButton
          ref={menuButtonRef}
          label={isOpen ? 'Close navigation menu' : 'Open navigation menu'}
          variant="subtle"
          size="md"
          aria-expanded={isOpen}
          aria-controls="mobile-navigation-drawer"
          onClick={() => onOpenChange(!isOpen)}
        >
          {isOpen ? (
            <X size={20} aria-hidden="true" />
          ) : (
            <Menu size={20} aria-hidden="true" />
          )}
        </IconButton>

        <a
          href="/dashboard"
          className="app-mobilebar__brand"
          onClick={(event) => {
            event.preventDefault()
            handleNavigate('/dashboard')
          }}
        >
          <Brand />
        </a>

        <a
          href="/profile"
          className="app-mobilebar__avatar"
          onClick={(event) => {
            event.preventDefault()
            handleNavigate('/profile')
          }}
        >
          <Avatar name={user.name} size="sm" />
          <span className="ui-visually-hidden">Open your profile</span>
        </a>
      <ThemeToggle />
        </header>

      {isOpen ? (
        <div className="app-drawer-layer">
          <div
            className="app-drawer-overlay"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) onOpenChange(false)
            }}
          />

          <div
            id="mobile-navigation-drawer"
            ref={drawerRef}
            className={cn('app-drawer')}
            role="dialog"
            aria-modal="true"
            aria-label="Navigation menu"
            tabIndex={-1}
          >
            <div className="app-drawer__header">
              <Brand />
              <IconButton label="Close navigation menu" onClick={() => onOpenChange(false)}>
                <X size={18} aria-hidden="true" />
              </IconButton>
            </div>

            {primaryCta ? (
              <div className="app-drawer__cta">
                <button
                  type="button"
                  className="app-drawer__cta-button"
                  onClick={() => handleNavigate(primaryCta.href)}
                >
                  <Plus size={16} aria-hidden="true" />
                  <span className="ui-nav-text">{primaryCta.label}</span>
                </button>
              </div>
            ) : null}

            <div className="app-drawer__nav">
              <nav aria-label="Primary navigation">
                <NavigationList items={primaryItems} path={path} onNavigate={handleNavigate} />
              </nav>
            </div>

            <div className="app-drawer__footer">
              <a
                href="/profile"
                className="app-sidebar__user"
                onClick={(event) => {
                  event.preventDefault()
                  handleNavigate('/profile')
                }}
              >
                <Avatar name={user.name} size="sm" />
                <span className="app-sidebar__user-text">
                  <span className="app-sidebar__user-name">{user.name}</span>
                  <span className="app-sidebar__user-role">{user.role}</span>
                </span>
              </a>

              <div className="app-sidebar__theme">
                  <ThemeToggle showLabel />
                </div>

                <nav aria-label="Secondary navigation">
                <NavigationList
                  items={secondaryItems}
                  path={path}
                  onNavigate={handleNavigate}
                  className="app-nav--secondary"
                />
              </nav>
            </div>
          </div>
        </div>
      ) : null}
    </>,
    document.body,
  )
}
