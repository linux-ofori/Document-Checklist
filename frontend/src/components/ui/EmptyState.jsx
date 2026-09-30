import { cn } from '../../utils/cn'

export function EmptyState({ icon, title, description, action, className, children }) {
  return (
    <div className={cn('ui-empty-state', className)}>
      {icon ? (
        <span className="ui-empty-state__icon" aria-hidden="true">
          {icon}
        </span>
      ) : null}

      {title ? <h3 className="ui-card-title">{title}</h3> : null}
      {description ? <p className="ui-body">{description}</p> : null}
      {children}

      {action ? <div className="ui-empty-state__actions">{action}</div> : null}
    </div>
  )
}