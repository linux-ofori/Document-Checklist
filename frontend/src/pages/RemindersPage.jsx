import { useMemo } from 'react'
import { Bell, BellOff, CheckCheck, Sparkles } from 'lucide-react'
import { AppLayout } from '../layouts/AppLayout'
import { NotificationCard, StatCard } from '../components/product'
import { Alert, Button, Card, EmptyState, TabGroup } from '../components/ui'
import { useAppData } from '../hooks/useAppData'
import { useActiveRoute } from '../hooks/useActiveRoute'
import { NOTIFICATION_KIND_LABELS } from '../data'
import { ROUTES, toRoutePath } from '../utils/routes'
import { pluralize } from '../utils/format'

function sortByDueDate(items) {
  return [...items].sort((a, b) => {
    const aDate = a.dueDate ? new Date(a.dueDate).getTime() : Number.MAX_SAFE_INTEGER
    const bDate = b.dueDate ? new Date(b.dueDate).getTime() : Number.MAX_SAFE_INTEGER
    return aDate - bDate
  })
}

export function RemindersPage() {
  const { navigate } = useActiveRoute()
  const { notificationViews, markNotificationRead, markAllNotificationsRead, openAssistant } =
    useAppData()

  const counts = useMemo(
    () => ({
      total: notificationViews.length,
      unread: notificationViews.filter((notification) => !notification.isRead).length,
      overdue: notificationViews.filter((notification) => notification.isOverdue).length,
      expiry: notificationViews.filter((notification) => notification.kind === 'expiry').length,
      missing: notificationViews.filter((notification) => notification.kind === 'missing-document')
        .length,
      application: notificationViews.filter((notification) => notification.kind === 'application')
        .length,
    }),
    [notificationViews],
  )

  const renderList = (items, emptyTitle, emptyDescription) => {
    if (items.length === 0) {
      return (
        <Card padding="spacious">
          <EmptyState
            icon={<BellOff size={22} aria-hidden="true" />}
            title={emptyTitle}
            description={emptyDescription}
          />
        </Card>
      )
    }

    return (
      <ul className="notification-list">
        {sortByDueDate(items).map((notification) => (
          <NotificationCard
            key={notification.id}
            notification={notification}
            onRead={markNotificationRead}
            onOpenApplication={(entry) =>
              navigate(toRoutePath('application', { id: entry.applicationId }))
            }
          />
        ))}
      </ul>
    )
  }

  const byKind = (kind) => notificationViews.filter((item) => item.kind === kind)
  const unread = notificationViews.filter((item) => !item.isRead)

  return (
    <AppLayout
      actions={
        <>
          <Button
            variant="ghost"
            size="md"
            leadingIcon={<Sparkles size={16} aria-hidden="true" />}
            onClick={openAssistant}
          >
            Ask AI
          </Button>
          <Button
            variant="outline"
            size="md"
            leadingIcon={<CheckCheck size={16} aria-hidden="true" />}
            onClick={markAllNotificationsRead}
            disabled={counts.unread === 0}
          >
            Mark all as read
          </Button>
        </>
      }
    >
      <div className="app-page">
        <header className="page-section__title">
          <h1 className="ui-page-title">Reminders</h1>
          <p className="ui-body">
            Expiry warnings, missing documents and application deadlines, all in one place.
          </p>
        </header>

        <div className="stat-grid">
          <StatCard
            label="Needs attention"
            value={counts.unread}
            hint={`${pluralize(counts.total, 'reminder')} in total`}
            icon={<Bell size={18} />}
            tone={counts.unread > 0 ? 'danger' : 'neutral'}
          />
          <StatCard
            label="Overdue"
            value={counts.overdue}
            hint="Already past the due date"
            icon={<Bell size={18} />}
            tone={counts.overdue > 0 ? 'warning' : 'neutral'}
          />
          <StatCard
            label="Expiry reminders"
            value={counts.expiry}
            hint="Documents with a date on them"
            icon={<Bell size={18} />}
            tone="secondary"
          />
        </div>

        {counts.unread === 0 ? (
          <Alert
            tone="success"
            icon={<CheckCheck size={18} aria-hidden="true" />}
            title="You are all caught up"
            description="Every reminder has been read. Add expiry dates to your documents and we will keep watching them for you."
          />
        ) : (
          <Alert
            tone="info"
            icon={<Bell size={18} aria-hidden="true" />}
            title={`${pluralize(counts.unread, 'reminder')} waiting for you`}
            description="We check document expiry dates every morning, so anything new shows up here the day it becomes a problem."
            action={
              <Button variant="ghost" size="sm" onClick={() => navigate(ROUTES.documents)}>
                Open library
              </Button>
            }
          />
        )}

        <TabGroup
          label="Reminder filters"
          tabs={[
            {
              id: 'open',
              label: 'Needs attention',
              count: counts.unread,
              render: () =>
                renderList(
                  unread,
                  'Nothing needs attention',
                  'Every reminder has been read. We will tell you the moment something changes.',
                ),
            },
            {
              id: 'expiry',
              label: NOTIFICATION_KIND_LABELS.expiry,
              count: counts.expiry,
              render: () =>
                renderList(
                  byKind('expiry'),
                  'No expiry reminders',
                  'Add an expiry date to a document and we will start warning you before it runs out.',
                ),
            },
            {
              id: 'missing-document',
              label: NOTIFICATION_KIND_LABELS['missing-document'],
              count: counts.missing,
              render: () =>
                renderList(
                  byKind('missing-document'),
                  'Nothing is missing',
                  'All required documents are attached to the checklists you are working on.',
                ),
            },
            {
              id: 'application',
              label: NOTIFICATION_KIND_LABELS.application,
              count: counts.application,
              render: () =>
                renderList(
                  byKind('application'),
                  'No application reminders',
                  'Deadlines and appointment dates will appear here once you set a due date.',
                ),
            },
            {
              id: 'all',
              label: 'All',
              count: counts.total,
              render: () =>
                renderList(
                  notificationViews,
                  'No reminders yet',
                  'Reminders are created when a document is close to expiring or a checklist item is still missing.',
                ),
            },
          ]}
        />
      </div>
    </AppLayout>
  )
}
