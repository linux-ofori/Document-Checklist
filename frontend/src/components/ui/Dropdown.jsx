import { useState } from 'react'
import { MoreHorizontal } from 'lucide-react'
import { cn } from '../../utils/cn'
import { useDismissableLayer } from '../../hooks/useDismissableLayer'
import { IconButton } from './IconButton'

export function Dropdown({
  label = 'More actions',
  items,
  align = 'right',
  triggerIcon,
  className,
  menuClassName,
}) {
  const [isOpen, setIsOpen] = useState(false)
  const setContainer = useDismissableLayer(isOpen, () => setIsOpen(false))

  return (
    <div className={cn('ui-dropdown', className)} ref={setContainer}>
      <IconButton
        label={label}
        variant="subtle"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((value) => !value)}
      >
        {triggerIcon ?? <MoreHorizontal size={18} aria-hidden="true" />}
      </IconButton>

      {isOpen ? (
        <div
          className={cn('ui-dropdown__menu', `ui-dropdown__menu--${align}`, menuClassName)}
          role="menu"
        >
          {items.map((item) => {
            if (item.type === 'divider') {
              return <span key={item.id} className="ui-dropdown__divider" role="separator" />
            }

            return (
              <button
                key={item.id}
                type="button"
                role="menuitem"
                className={cn(
                  'ui-dropdown__item',
                  item.isDestructive && 'ui-dropdown__item--destructive',
                  item.isDisabled && 'ui-dropdown__item--disabled',
                )}
                disabled={item.isDisabled}
                onClick={() => {
                  setIsOpen(false)
                  item.onSelect?.()
                }}
              >
                {item.icon ? (
                  <span className="ui-dropdown__item-icon" aria-hidden="true">
                    {item.icon}
                  </span>
                ) : null}
                <span className="ui-dropdown__item-label">{item.label}</span>
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
