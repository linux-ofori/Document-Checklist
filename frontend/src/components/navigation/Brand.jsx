import { cn } from '../../utils/cn'
import { APP_NAME, APP_SHORT_NAME, APP_TAGLINE } from '../../data/navigation'

export function Brand({ compact = false, className }) {
  return (
    <span className={cn('app-brand', compact && 'app-brand--compact', className)}>
      <span className="app-brand__mark" aria-hidden="true">
        {APP_SHORT_NAME}
      </span>
      {!compact ? (
        <span className="app-brand__text">
          <span className="app-brand__name">{APP_NAME}</span>
          <span className="app-brand__tagline">{APP_TAGLINE}</span>
        </span>
      ) : null}
    </span>
  )
}