import { forwardRef } from 'react'
import { cn } from '../../utils/cn'

const VARIANTS = ['subtle', 'surface', 'danger']
const SIZES = ['sm', 'md', 'lg']

export const IconButton = forwardRef(function IconButton(
  { variant = 'subtle', size = 'md', label, className, children, ...rest },
  ref,
) {
  const safeVariant = VARIANTS.includes(variant) ? variant : VARIANTS[0]
  const safeSize = SIZES.includes(size) ? size : SIZES[1]

  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        'ui-icon-btn',
        `ui-icon-btn--${safeVariant}`,
        `ui-icon-btn--${safeSize}`,
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  )
})