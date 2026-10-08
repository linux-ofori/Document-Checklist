import { Bell } from 'lucide-react'
import { Avatar, IconButton, ThemeToggle } from '../ui'
import { cn } from '../../utils/cn'

export function TopHeader({
  title,
  user,
  actions,
  unreadCount = null,
  onOpenReminders,
  onOpenProfile,
  className,
}) {
  return (
    <header className={cn('app-topbar', className)}>
      <div className="app-topbar__lead">
        <h2 className="ui-section-title app-topbar__title">{title}</h2>
      </div>

      <div className="app-topbar__actions">
        {actions}

        <ThemeToggle />

        <span className="app-topbar__bell">
          <IconButton
            label={
              unreadCount === null
                ? 'Notifications unavailable'
                : unreadCount > 0
                  ? `Notifications, ${unreadCount} unread`
                  : 'Notifications'
            }
            variant="subtle"
            size="md"
            onClick={onOpenReminders}
          >
            <Bell size={18} aria-hidden="true" />
          </IconButton>
          {unreadCount > 0 ? (
            <span className="app-topbar__badge" aria-hidden="true">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          ) : null}
        </span>

        <a
          href="/profile"
          className="app-topbar__user"
          onClick={(event) => {
            event.preventDefault()
            onOpenProfile?.()
          }}
        >
          <Avatar name={user.name} size="sm" />
          <span className="ui-visually-hidden">Open your profile</span>
        </a>
      </div>
    </header>
  )
}
