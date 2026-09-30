import { cn } from '../../utils/cn'

export function KeyValueList({ items, columns = 2, className, itemClassName }) {
  const visibleItems = items.filter(
    (item) => item.value !== undefined && item.value !== null && item.value !== '',
  )

  if (visibleItems.length === 0) return null

  return (
    <dl className={cn('ui-keyvalues', `ui-keyvalues--cols-${columns}`, className)}>
      {visibleItems.map((item) => (
        <div key={item.id ?? item.label} className={cn('ui-keyvalues__item', itemClassName)}>
          <dt className="ui-caption">{item.label}</dt>
          <dd className="ui-keyvalues__value">{item.value}</dd>
        </div>
      ))}
    </dl>
  )
}
