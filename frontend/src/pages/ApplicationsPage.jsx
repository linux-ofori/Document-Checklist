import { useMemo, useState } from 'react'
import { FileStack, Plus, Search } from 'lucide-react'
import { AppLayout } from '../layouts/AppLayout'
import { ApplicationCard, StatCard } from '../components/product'
import {
  Button,
  Card,
  EmptyState,
  SearchInput,
  Select,
  TabGroup,
} from '../components/ui'
import { useAppData } from '../hooks/useAppData'
import { useActiveRoute } from '../hooks/useActiveRoute'
import { useDebouncedValue } from '../hooks/useDebouncedValue'
import { ROUTES, toRoutePath } from '../utils/routes'
import { pluralize } from '../utils/format'

const FILTERS = [
  { value: 'all', label: 'All statuses' },
  { value: 'in-progress', label: 'In progress' },
  { value: 'completed', label: 'Completed' },
  { value: 'submitted', label: 'Submitted' },
]

const SORTS = [
  { value: 'recent', label: 'Recently updated' },
  { value: 'progress', label: 'Highest progress' },
  { value: 'name', label: 'Name (A–Z)' },
  { value: 'due', label: 'Deadline' },
]

export function ApplicationsPage() {
  const { navigate } = useActiveRoute()
  const { applicationViews } = useAppData()

  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('all')
  const [sort, setSort] = useState('recent')
  const debouncedQuery = useDebouncedValue(query, 200)

  const counts = useMemo(
    () => ({
      all: applicationViews.length,
      active: applicationViews.filter((application) => application.status === 'in-progress').length,
      completed: applicationViews.filter((application) => application.status === 'completed').length,
      submitted: applicationViews.filter((application) => application.status === 'submitted').length,
    }),
    [applicationViews],
  )

  const visibleApplications = useMemo(() => {
    const term = debouncedQuery.trim().toLowerCase()

    const filtered = applicationViews.filter((application) => {
      if (status !== 'all' && application.status !== status) return false
      if (!term) return true

      return [application.name, application.reference, application.process?.name]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(term)
    })

    const sorted = [...filtered]

    if (sort === 'progress') {
      sorted.sort((a, b) => b.progress - a.progress)
    } else if (sort === 'name') {
      sorted.sort((a, b) => a.name.localeCompare(b.name))
    } else if (sort === 'due') {
      sorted.sort((a, b) => {
        if (!a.dueDate) return 1
        if (!b.dueDate) return -1
        return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime()
      })
    } else {
      sorted.sort(
        (a, b) => new Date(b.updatedAt ?? 0).getTime() - new Date(a.updatedAt ?? 0).getTime(),
      )
    }

    return sorted
  }, [applicationViews, debouncedQuery, status, sort])

  const openApplication = (application) => {
    navigate(toRoutePath('application', { id: application.id }))
  }

  return (
    <AppLayout
      actions={
        <Button
          variant="primary"
          size="md"
          leadingIcon={<Plus size={16} aria-hidden="true" />}
          onClick={() => navigate(ROUTES.chooseProcess)}
        >
          Start new application
        </Button>
      }
    >
      <div className="app-page">
        <header className="page-section__title">
          <h1 className="ui-page-title">Applications</h1>
          <p className="ui-body">
            Every process you are preparing for, with a checklist for each one.
          </p>
        </header>

        <div className="stat-grid">
          <StatCard
            label="Total applications"
            value={counts.all}
            icon={<FileStack size={18} />}
            tone="primary"
          />
          <StatCard
            label="In progress"
            value={counts.active}
            icon={<FileStack size={18} />}
            tone="warning"
          />
          <StatCard
            label="Completed"
            value={counts.completed}
            icon={<FileStack size={18} />}
            tone="success"
          />
        </div>

        <div className="toolbar">
          <div className="toolbar__search">
            <SearchInput
              label="Search applications"
              placeholder="Search by name or reference"
              value={query}
              onValueChange={setQuery}
            />
          </div>

          <div className="toolbar__filters">
            <Select
              label="Status"
              value={status}
              onChange={(event) => setStatus(event.target.value)}
              options={FILTERS}
              wrapperClassName="toolbar__field"
            />
            <Select
              label="Sort by"
              value={sort}
              onChange={(event) => setSort(event.target.value)}
              options={SORTS}
              wrapperClassName="toolbar__field"
            />
          </div>

          <span className="ui-caption toolbar__count">
            {pluralize(visibleApplications.length, 'application')}
          </span>
        </div>

        {visibleApplications.length === 0 ? (
          <Card padding="spacious">
            <EmptyState
              icon={query || status !== 'all' ? <Search size={22} aria-hidden="true" /> : <FileStack size={22} aria-hidden="true" />}
              title={
                query || status !== 'all'
                  ? 'No applications match your filters'
                  : 'No applications yet'
              }
              description={
                query || status !== 'all'
                  ? 'Try a different search term, or clear the status filter.'
                  : 'Pick the process you are applying for and we will build the checklist, so you know exactly what to collect.'
              }
              action={
                query || status !== 'all' ? (
                  <Button
                    variant="outline"
                    size="md"
                    onClick={() => {
                      setQuery('')
                      setStatus('all')
                    }}
                  >
                    Clear filters
                  </Button>
                ) : (
                  <Button
                    variant="primary"
                    size="md"
                    onClick={() => navigate(ROUTES.chooseProcess)}
                  >
                    Start new application
                  </Button>
                )
              }
            />
          </Card>
        ) : (
          <TabGroup
            label="Application views"
            tabs={[
              {
                id: 'cards',
                label: 'Cards',
                render: () => (
                  <div className="application-grid">
                    {visibleApplications.map((application) => (
                      <ApplicationCard
                        key={application.id}
                        application={application}
                        onOpen={openApplication}
                      />
                    ))}
                  </div>
                ),
              },
              {
                id: 'compact',
                label: 'Compact',
                render: () => (
                  <div className="application-list">
                    {visibleApplications.map((application) => (
                      <ApplicationCard
                        key={application.id}
                        application={application}
                        onOpen={openApplication}
                        compact
                      />
                    ))}
                  </div>
                ),
              },
            ]}
          />
        )}
      </div>
    </AppLayout>
  )
}
