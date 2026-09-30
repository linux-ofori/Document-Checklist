import { forwardRef } from 'react'
import { Loader2 } from 'lucide-react'
import { cn } from '../../utils/cn'

const VARIANTS = ['primary', 'secondary', 'outline', 'ghost', 'danger']
const SIZES = ['sm', 'md', 'lg']

export const Button = forwardRef(function Button(
  {
    variant = 'primary',
    size = 'md',
    isLoading = false,
    leadingIcon,
    trailingIcon,
    disabled = false,
    type = 'button',
    className,
    children,
    ...rest
  },
  ref,
) {
  const safeVariant = VARIANTS.includes(variant) ? variant : VARIANTS[0]
  const safeSize = SIZES.includes(size) ? size : SIZES[1]
  const iconSize = size === 'sm' ? 14 : 16

  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || isLoading}
      aria-busy={isLoading || undefined}
      className={cn('ui-btn', `ui-btn--${safeVariant}`, `ui-btn--${safeSize}`, className)}
      {...rest}
    >
      {isLoading ? (
        <Loader2 className="ui-btn__spinner" size={iconSize} aria-hidden="true" />
      ) : leadingIcon ? (
        <span className="ui-btn__icon" aria-hidden="true">
          {leadingIcon}
        </span>
      ) : null}

      <span className="ui-btn__label">{children}</span>

      {!isLoading && trailingIcon ? (
        <span className="ui-btn__icon" aria-hidden="true">
          {trailingIcon}
        </span>
      ) : null}
    </button>
  )
})