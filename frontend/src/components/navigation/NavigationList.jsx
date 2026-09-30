import { cn } from '../../utils/cn'

export function NavigationList({ items, path, onNavigate, className }) {
  return (
    <ul className={cn('app-nav', className)}>
      {items.map((item) => {
        const Icon = item.icon
        const isActive = path === item.href || (item.href !== '/' && path.startsWith(`${item.href}/`))

        return (
          <li key={item.id}>
            <a
              href={item.href}
              className={cn('app-nav__link', isActive && 'app-nav__link--active')}
              aria-current={isActive ? 'page' : undefined}
              onClick={(event) => {
                event.preventDefault()
                onNavigate?.(item.href)
              }}
            >
              <Icon className="app-nav__icon" size={18} aria-hidden="true" />
              <span className="ui-nav-text">{item.label}</span>
            </a>
          </li>
        )
      })}
    </ul>
  )
}