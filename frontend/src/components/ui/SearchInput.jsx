import { forwardRef, useId } from 'react'
import { Search, X } from 'lucide-react'
import { cn } from '../../utils/cn'

export const SearchInput = forwardRef(function SearchInput(
  { label = 'Search', value, onValueChange, onClear, id, className, wrapperClassName, ...rest },
  ref,
) {
  const generatedId = useId()
  const controlId = id ?? generatedId

  return (
    <div className={cn('ui-field', 'ui-search', wrapperClassName)}>
      <label className="ui-visually-hidden" htmlFor={controlId}>
        {label}
      </label>

      <span className="ui-search__icon" aria-hidden="true">
        <Search size={16} />
      </span>

      <input
        ref={ref}
        id={controlId}
        type="search"
        className={cn('ui-field__control', 'ui-search__control', className)}
        value={value}
        onChange={(event) => onValueChange?.(event.target.value)}
        {...rest}
      />

      {value ? (
        <button
          type="button"
          className="ui-search__clear"
          onClick={() => {
            onValueChange?.('')
            onClear?.()
          }}
        >
          <X size={15} aria-hidden="true" />
          <span className="ui-visually-hidden">Clear search</span>
        </button>
      ) : null}
    </div>
  )
})
