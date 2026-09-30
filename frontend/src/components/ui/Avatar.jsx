import { useState } from 'react'
import { cn } from '../../utils/cn'
import { getInitials } from '../../utils/format'

const SIZES = ['xs', 'sm', 'md', 'lg']

export function Avatar({
  name = '',
  src,
  size = 'md',
  shape = 'circle',
  showStatus = false,
  className,
}) {
  const [hasImageError, setHasImageError] = useState(false)
  const safeSize = SIZES.includes(size) ? size : SIZES[2]
  const showImage = Boolean(src) && !hasImageError

  return (
    <span className="ui-avatar__wrapper">
      <span
        className={cn(
          'ui-avatar',
          `ui-avatar--${safeSize}`,
          shape === 'square' && 'ui-avatar--square',
          className,
        )}
        title={name || undefined}
      >
        {showImage ? (
          <img
            className="ui-avatar__image"
            src={src}
            alt={name || ''}
            onError={() => setHasImageError(true)}
          />
        ) : (
          <span aria-hidden={name ? 'true' : undefined}>{getInitials(name) || '?'}</span>
        )}
      </span>
      {showStatus ? <span className="ui-avatar__status" aria-hidden="true" /> : null}
    </span>
  )
}