import { useId, useState } from 'react'
import { cn } from '../../utils/cn'

export function TabGroup({ tabs, initialTabId, className, panelClassName, label = 'Sections' }) {
  const generatedId = useId()
  const [activeId, setActiveId] = useState(() => initialTabId ?? tabs[0]?.id)
  const activeTab = tabs.find((tab) => tab.id === activeId) ?? tabs[0]

  if (!activeTab) return null

  return (
    <div className={cn('ui-tabgroup', className)}>
      <div className="ui-tabs__list" role="tablist" aria-label={label}>
        {tabs.map((tab) => {
          const isActive = tab.id === activeTab.id

          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              id={`${generatedId}-tab-${tab.id}`}
              aria-selected={isActive}
              aria-controls={`${generatedId}-panel-${tab.id}`}
              tabIndex={isActive ? 0 : -1}
              className={cn('ui-tabs__tab', isActive && 'ui-tabs__tab--active')}
              onClick={() => setActiveId(tab.id)}
            >
              <span className="ui-tabs__tab-label">{tab.label}</span>
              {typeof tab.count === 'number' ? (
                <span className={cn('ui-tabs__tab-count', isActive && 'ui-tabs__tab-count--active')}>
                  {tab.count}
                </span>
              ) : null}
            </button>
          )
        })}
      </div>

      <div
        role="tabpanel"
        id={`${generatedId}-panel-${activeTab.id}`}
        aria-labelledby={`${generatedId}-tab-${activeTab.id}`}
        tabIndex={0}
        className={cn('ui-tabpanel', panelClassName)}
      >
        {activeTab.render?.()}
      </div>
    </div>
  )
}
