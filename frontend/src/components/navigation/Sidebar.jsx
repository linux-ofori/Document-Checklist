import { Plus } from 'lucide-react'
import { cn } from '../../utils/cn'
import { Avatar, ThemeToggle } from '../ui'
import { Brand } from './Brand'
import { NavigationList } from './NavigationList'

export function Sidebar({
  primaryItems,
  secondaryItems,
  primaryCta,
  user,
  path,
  onNavigate,
  className,
}) {
  const isCtaActive = path === primaryCta?.href

  return (
    <aside className={cn('app-sidebar', className)} aria-label="Primary sidebar">
      <div className="app-sidebar__brand">
        <a
          href="/dashboard"
          className="app-sidebar__brand-link"
          onClick={(event) => {
            event.preventDefault()
            onNavigate?.('/dashboard')
          }}
        >
          <Brand />
        </a>
      </div>

      <div className="app-sidebar__nav">
        {primaryCta ? (
          <button
            type="button"
            className={cn('app-sidebar__cta', isCtaActive && 'app-sidebar__cta--active')}
            onClick={() => onNavigate?.(primaryCta.href)}
          >
            <Plus size={16} aria-hidden="true" />
            <span className="ui-nav-text">{primaryCta.label}</span>
          </button>
        ) : null}

        <nav aria-label="Primary navigation">
          <NavigationList items={primaryItems} path={path} onNavigate={onNavigate} />
        </nav>
      </div>

      <div className="app-sidebar__footer">
        <a
          href="/profile"
          className="app-sidebar__user"
          onClick={(event) => {
            event.preventDefault()
            onNavigate?.('/profile')
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
            onNavigate={onNavigate}
            className="app-nav--secondary"
          />
        </nav>
      </div>
    </aside>
  )
}
