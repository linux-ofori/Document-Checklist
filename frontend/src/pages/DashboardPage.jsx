import {
  ArrowRight,
  Bell,
  CircleCheck,
  CircleDashed,
  FileStack,
  FolderOpen,
  Sparkles,
} from 'lucide-react'
import { AppLayout } from '../layouts/AppLayout'
import { ApplicationCard, QuickActions, StatCard } from '../components/product'
import { Alert, Button, Card, EmptyState, LoadingState, StatusBadge } from '../components/ui'
import { useAppData } from '../hooks/useAppData'
import { useActiveRoute } from '../hooks/useActiveRoute'
import { ROUTES, toRoutePath } from '../utils/routes'
import { formatRelativeTime, pluralize } from '../utils/format'

function SectionHead({ title, description, actionLabel, onAction }) {
  return (
    <div className="page-section__head">
      <div className="page-section__title">
        <h2 className="ui-section-title">{title}</h2>
        {description ? <p className="ui-caption">{description}</p> : null}
      </div>

      {actionLabel ? (
        <button type="button" className="page-section__link" onClick={onAction}>
          {actionLabel}
          <ArrowRight size={15} aria-hidden="true" />
        </button>
      ) : null}
    </div>
  )
}

export function DashboardPage() {
  const { navigate } = useActiveRoute()
  const { profile, stats, recentApplications, recentDocuments, isLoading } = useAppData()

  const firstName = String(profile?.name ?? '').split(' ')[0] || 'there'

  return (
    <AppLayout
      actions={
        <>
          <Button
            variant="outline"
            size="md"
            leadingIcon={<FolderOpen size={16} aria-hidden="true" />}
            onClick={() => navigate(ROUTES.documents)}
          >
            My documents
          </Button>
          <Button
            variant="primary"
            size="md"
            leadingIcon={<Sparkles size={16} aria-hidden="true" />}
            onClick={() => navigate(ROUTES.chooseProcess)}
          >
            Start new application
          </Button>
        </>
      }
    >
      <div className="app-page">
        <header className="page-section">
          <div className="page-section__title">
            <h1 className="ui-page-title">Good to see you, {firstName}</h1>
            <p className="ui-body">
              {isLoading
                ? 'Loading your documentation workspace.'
                : stats.pendingDocuments > 0
                  ? `You have ${pluralize(stats.pendingDocuments, 'document')} left to sort out across ${pluralize(
                      stats.activeApplications,
                      'application',
                    )}.`
                  : 'Everything is up to date. Nothing is missing and nothing is expiring soon.'}
            </p>
          </div>
        </header>

        {isLoading ? (
          <LoadingState variant="skeleton" lines={4} label="Loading your dashboard" />
        ) : (
          <div className="stat-grid">
            <StatCard
              label="Active applications"
              value={stats.activeApplications}
              hint={`${stats.completedApplications} completed`}
              icon={<FileStack size={18} />}
              tone="primary"
              onClick={() => navigate(ROUTES.applications)}
            />

            <StatCard
              label="Documents collected"
              value={stats.completedDocuments}
              hint="Reused across every application"
              icon={<CircleCheck size={18} />}
              tone="success"
              onClick={() => navigate(ROUTES.documents)}
            />

            <StatCard
              label="Still to do"
              value={stats.pendingDocuments}
              hint={`${stats.missingDocuments} missing, ${stats.inProgressDocuments} in progress`}
              icon={<CircleDashed size={18} />}
              tone="warning"
              onClick={() => navigate(ROUTES.applications)}
            />

            <StatCard
              label="Open reminders"
              value={stats.reminders}
              hint={stats.reminders > 0 ? 'Need attention this week' : 'You are all caught up'}
              icon={<Bell size={18} />}
              tone={stats.reminders > 0 ? 'danger' : 'neutral'}
              onClick={() => navigate(ROUTES.reminders)}
            />
          </div>
        )}

        <Card
          title="Quick actions"
          description="Jump straight into the thing you came here to do."
          padding="compact"
        >
          <QuickActions />
        </Card>

        {!isLoading && stats.missingDocuments > 0 ? (
          <Alert
            tone="warning"
            icon={<Bell size={18} aria-hidden="true" />}
            title={`${pluralize(stats.missingDocuments, 'document')} still missing`}
            description="Uploading a document you already have can clear several checklist items across your applications at once."
          />
        ) : null}

        <section className="page-section">
          <SectionHead
            title="Your applications"
            description="The checklists you are actively working on."
            actionLabel="View all"
            onAction={() => navigate(ROUTES.applications)}
          />

          {recentApplications.length === 0 ? (
            <Card padding="spacious">
              <EmptyState
                icon={<FileStack size={22} aria-hidden="true" />}
                title="No applications yet"
                description="Start with the process you are applying for and we will build the full checklist for you."
                action={
                  <Button variant="primary" size="md" onClick={() => navigate(ROUTES.chooseProcess)}>
                    Start new application
                  </Button>
                }
              />
            </Card>
          ) : (
            <div className="application-grid">
              {recentApplications.map((application) => (
                <ApplicationCard
                  key={application.id}
                  application={application}
                  onOpen={() => navigate(toRoutePath('application', { id: application.id }))}
                />
              ))}
            </div>
          )}
        </section>

        <section className="page-section">
          <SectionHead
            title="Recently added documents"
            description="The files you uploaded most recently."
            actionLabel="Open library"
            onAction={() => navigate(ROUTES.documents)}
          />

          {recentDocuments.length === 0 ? (
            <Card padding="spacious">
              <EmptyState
                icon={<FolderOpen size={22} aria-hidden="true" />}
                title="Your library is empty"
                description="Upload a passport photograph or a birth certificate once, then reuse it on every application."
                action={
                  <Button variant="primary" size="md" onClick={() => navigate(ROUTES.documents)}>
                    Go to documents
                  </Button>
                }
              />
            </Card>
          ) : (
            <Card padding="compact">
              <ul className="mini-list">
                {recentDocuments.map((document) => (
                  <li key={document.id} className="mini-list__item">
                    <span className="mini-list__icon" aria-hidden="true">
                      <FolderOpen size={16} />
                    </span>

                    <span className="mini-list__body">
                      <span className="mini-list__title">{document.name}</span>
                      <span className="mini-list__meta">
                        {document.typeLabel} · {document.applicationName} · Added{' '}
                        {formatRelativeTime(document.uploadedAt)}
                      </span>
                    </span>

                    <span className="mini-list__aside">
                      <StatusBadge status={document.badgeStatus}>{document.statusLabel}</StatusBadge>
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </section>
      </div>
    </AppLayout>
  )
}
