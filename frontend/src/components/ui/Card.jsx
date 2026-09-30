import { cn } from '../../utils/cn'

const PADDING = ['flush', 'compact', 'comfortable', 'spacious']

export function Card({
  title,
  description,
  action,
  footer,
  padding = 'comfortable',
  className,
  headerClassName,
  bodyClassName,
  children,
  ...rest
}) {
  const safePadding = PADDING.includes(padding) ? padding : PADDING[2]
  const hasHeader = Boolean(title || description || action)

  return (
    <section
      className={cn('ui-card', `ui-card--${safePadding}`, className)}
      {...rest}
    >
      {hasHeader ? (
        <header className={cn('ui-card__header', headerClassName)}>
          <div className="ui-card__header-text">
            {title ? <h3 className="ui-card-title">{title}</h3> : null}
            {description ? <p className="ui-body">{description}</p> : null}
          </div>
          {action ? <div className="ui-card__header-action">{action}</div> : null}
        </header>
      ) : null}

      <div className={cn('ui-card__body', bodyClassName)}>{children}</div>

      {footer ? <footer className="ui-card__footer">{footer}</footer> : null}
    </section>
  )
}