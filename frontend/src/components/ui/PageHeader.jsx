import { cn } from '../../utils/cn'

export function PageHeader({ title, subtitle, actions, className, textClassName, actionsClassName }) {
  return (
    <header className={cn('ui-page-header', className)}>
      <div className={cn('ui-page-header__text', textClassName)}>
        {title ? <h1 className="ui-page-title">{title}</h1> : null}
        {subtitle ? <p className="ui-body">{subtitle}</p> : null}
      </div>

      {actions ? (
        <div className={cn('ui-page-header__actions', actionsClassName)}>{actions}</div>
      ) : null}
    </header>
  )
}