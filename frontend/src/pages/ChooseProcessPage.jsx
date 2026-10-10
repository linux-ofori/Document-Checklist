import { useMemo, useRef, useState } from 'react'
import { ArrowRight, CircleHelp, Search } from 'lucide-react'
import { AppLayout } from '../layouts/AppLayout'
import { ProcessCard } from '../components/product'
import { Alert, Button, Card, EmptyState, SearchInput, Select } from '../components/ui'
import { useAppData } from '../hooks/useAppData'
import { useActiveRoute } from '../hooks/useActiveRoute'
import { useDebouncedValue } from '../hooks/useDebouncedValue'
import { ROUTES, toRoutePath } from '../utils/routes'
import { pluralize } from '../utils/format'

const CATEGORY_OPTIONS = [
  { value: 'all', label: 'All categories' },
  { value: 'personal', label: 'Personal documents' },
  { value: 'business', label: 'Business and registration' },
  { value: 'education', label: 'Education' },
  { value: 'licensing', label: 'Licensing and permits' },
  { value: 'other', label: 'Other services' },
]

export function ChooseProcessPage() {
  const { navigate } = useActiveRoute()
  const { processes, startApplication } = useAppData()

  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('all')
  const [startingId, setStartingId] = useState(null)
  const [error, setError] = useState('')
  const startRequestIdRef = useRef(0)
  const debouncedQuery = useDebouncedValue(query, 200)

  const visibleProcesses = useMemo(() => {
    const term = debouncedQuery.trim().toLowerCase()

    return processes.filter((process) => {
      if (category !== 'all' && process.category !== category) return false
      if (!term) return true

      return [process.name, process.description, process.authority]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(term)
    })
  }, [processes, debouncedQuery, category])

  const handleStart = async (process) => {
    const requestId = ++startRequestIdRef.current
    setStartingId(process.id)
    setError('')

    try {
      const application = await startApplication(process.id)
      if (!application) return
      navigate(toRoutePath('application', { id: application.id }))
    } catch {
      setError('We could not start that application. Please try again.')
    } finally {
      if (startRequestIdRef.current === requestId) setStartingId(null)
    }
  }

  return (
    <AppLayout>
      <div className="app-page">
        <header className="page-section__title">
          <h1 className="ui-page-title">Start a new application</h1>
          <p className="ui-body">
            Choose the process you are applying for. We will build the checklist of documents the
            office expects, including anything optional you can skip.
          </p>
        </header>

        {error ? <Alert tone="danger" title="Something went wrong" description={error} /> : null}

        <Alert
          tone="info"
          icon={<CircleHelp size={18} aria-hidden="true" />}
          title="Already started this before?"
          description="Check your existing applications first. You can reuse any document you have already uploaded instead of gathering it again."
        />

        <div className="toolbar">
          <div className="toolbar__search">
            <SearchInput
              label="Search processes"
              placeholder="Search passports, business registration…"
              value={query}
              onValueChange={setQuery}
            />
          </div>

          <div className="toolbar__filters">
            <Select
              label="Category"
              value={category}
              onChange={(event) => setCategory(event.target.value)}
              options={CATEGORY_OPTIONS}
              wrapperClassName="toolbar__field"
            />
          </div>

          <span className="ui-caption toolbar__count">
            {pluralize(visibleProcesses.length, 'process', 'processes')}
          </span>
        </div>

        {visibleProcesses.length === 0 ? (
          <Card padding="spacious">
            <EmptyState
              icon={<Search size={22} aria-hidden="true" />}
              title="No processes match your search"
              description="Try a broader term, or clear the category filter to see everything we support."
              action={
                <Button
                  variant="outline"
                  size="md"
                  onClick={() => {
                    setQuery('')
                    setCategory('all')
                  }}
                >
                  Clear filters
                </Button>
              }
            />
          </Card>
        ) : (
          <div className="process-grid">
            {visibleProcesses.map((process) => (
              <ProcessCard
                key={process.id}
                process={process}
                onStart={handleStart}
                isStarting={startingId === process.id}
              />
            ))}
          </div>
        )}

        <Card
          title="Cannot find what you need?"
          description="Tell us the office or the process and we will add it to the list."
          padding="compact"
          action={
            <button
              type="button"
              className="page-section__link"
              onClick={() => navigate(ROUTES.applications)}
            >
              View my applications
              <ArrowRight size={15} aria-hidden="true" />
            </button>
          }
        >
          <p className="ui-body">
            We currently support {pluralize(processes.length, 'process', 'processes')} covering
            passports, business registration, driving licences, university admission and national ID
            applications. Anything else you can still track manually with a custom checklist.
          </p>
          <p className="ui-caption">
            Requirements last reviewed by our documentation team this year.
          </p>
        </Card>
      </div>
    </AppLayout>
  )
}
