import { cn } from '../../utils/cn'

const SPINNER_SIZES = ['sm', 'md', 'lg']

export function LoadingState({
  variant = 'spinner',
  size = 'md',
  label = 'Loading',
  showLabel = true,
  lines = 3,
  className,
}) {
  if (variant === 'skeleton') {
    return (
      <div className={cn('ui-loading', className)} role="status" aria-live="polite">
        <span className="ui-visually-hidden">{label}</span>
        <div className="ui-skeleton-stack" aria-hidden="true">
          {Array.from({ length: Math.max(lines, 1) }, (_, index) => (
            <span
              key={index}
              className="ui-skeleton"
              style={{ height: 12, width: `${100 - index * 12}%` }}
            />
          ))}
        </div>
      </div>
    )
  }

  const safeSize = SPINNER_SIZES.includes(size) ? size : SPINNER_SIZES[1]

  return (
    <div
      className={cn('ui-loading', className)}
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <span className={cn('ui-loading__spinner', `ui-loading__spinner--${safeSize}`)} aria-hidden="true" />
      {showLabel ? <span className="ui-caption">{label}</span> : null}
    </div>
  )
}