import { useMemo, useState } from 'react'
import {
  ArrowLeft,
  CircleCheck,
  Clock,
  FileStack,
  Hourglass,
  Paperclip,
  Sparkles,
  TriangleAlert,
  Upload,
} from 'lucide-react'
import { AppLayout } from '../layouts/AppLayout'
import { ChecklistItem, ProcessIcon } from '../components/product'
import {
  Alert,
  Button,
  Card,
  EmptyState,
  KeyValueList,
  LoadingState,
  ProgressBar,
  StatusBadge,
  TabGroup,
} from '../components/ui'
import { useAppData } from '../hooks/useAppData'
import { useActiveRoute } from '../hooks/useActiveRoute'
import { ROUTES } from '../utils/routes'
import { formatCountdown, formatDate, formatRelativeTime, pluralize } from '../utils/format'
import { groupRequirementsByStatus } from '../utils/checklist'

export function ApplicationDetailPage({ applicationId }) {
  const { navigate } = useActiveRoute()
  const {
    getApplicationById,
    getDocumentById,
    toggleRequirement,
    setRequirementStatus,
    openUploadModal,
    openDocumentPreview,
    openAssistant,
    isLoading,
  } = useAppData()

  const [updatingKey, setUpdatingKey] = useState(null)

  const application = getApplicationById(applicationId)

  const groups = useMemo(
    () => groupRequirementsByStatus(application?.requirements ?? []),
    [application?.requirements],
  )

  if (isLoading && !application) {
    return (
      <AppLayout>
        <LoadingState label="Loading your checklist" />
      </AppLayout>
    )
  }

  if (!application) {
    return (
      <AppLayout>
        <Card padding="spacious">
          <EmptyState
            icon={<FileStack size={22} aria-hidden="true" />}
            title="We could not find that application"
            description="It may have been removed, or the link may be out of date."
            action={
              <Button variant="primary" size="md" onClick={() => navigate(ROUTES.applications)}>
                Back to applications
              </Button>
            }
          />
        </Card>
      </AppLayout>
    )
  }

  const { process, summary, requirements, documents } = application
  const isComplete = summary.missing === 0 && summary.inProgress === 0

  const runUpdate = async (requirement, nextStatus) => {
    setUpdatingKey(requirement.key)
    try {
      if (nextStatus === undefined) {
        await toggleRequirement(application.id, requirement.key, requirement.status)
      } else {
        await setRequirementStatus(application.id, requirement.key, nextStatus)
      }
    } finally {
      setUpdatingKey(null)
    }
  }

  const handleUpload = (requirement) => {
    openUploadModal({
      applicationId: application.id,
      documentType: requirement?.type ?? '',
      name: requirement?.name ?? '',
    })
  }

  const getLinkedDocument = (requirement) =>
    requirement.documentId ? getDocumentById(requirement.documentId) : null

  const renderChecklist = (items, emptyMessage) => {
    if (items.length === 0) {
      return (
        <div className="checklist-group">
          <p className="ui-caption">{emptyMessage}</p>
        </div>
      )
    }

    return (
      <ul className="checklist">
        {items.map((requirement) => (
          <ChecklistItem
            key={requirement.key}
            requirement={requirement}
            linkedDocument={getLinkedDocument(requirement)}
            onToggle={(item) => runUpdate(item)}
            onSetStatus={(item, status) => runUpdate(item, status)}
            onUpload={handleUpload}
            onViewDocument={(document) => openDocumentPreview(document.id)}
            isUpdating={updatingKey === requirement.key}
          />
        ))}
      </ul>
    )
  }

  return (
    <AppLayout
      actions={
        <>
          <Button
            variant="ghost"
            size="md"
            leadingIcon={<ArrowLeft size={16} aria-hidden="true" />}
            onClick={() => navigate(ROUTES.applications)}
          >
            All applications
          </Button>
          <Button
            variant="primary"
            size="md"
            leadingIcon={<Upload size={16} aria-hidden="true" />}
            onClick={() => handleUpload()}
          >
            Upload document
          </Button>
        </>
      }
    >
      <div className="app-page">
        <header className="application-detail__header">
          <span className="application-detail__icon" aria-hidden="true">
            <ProcessIcon icon={process?.icon} size={22} />
          </span>

          <div className="application-detail__heading">
            <h1 className="ui-page-title">{application.name}</h1>
            <p className="ui-caption">
              {application.reference} · {process?.authority} · Updated{' '}
              {formatRelativeTime(application.updatedAt)}
            </p>
          </div>

          <StatusBadge status={application.badgeStatus}>{application.statusLabel}</StatusBadge>
        </header>

        {isComplete ? (
          <Alert
            tone="success"
            icon={<CircleCheck size={18} aria-hidden="true" />}
            title="Everything on this checklist is done"
            description="You can submit this application. We will keep an eye on any documents that expire while you wait."
          />
        ) : (
          <Alert
            tone="info"
            icon={<Sparkles size={18} aria-hidden="true" />}
            title={application.nextStep}
            description={`${summary.completed} of ${summary.total} items complete. ${
              application.dueDate ? formatCountdown(application.dueDate) : 'No deadline set.'
            }`}
          />
        )}

        <div className="dashboard-grid">
          <div className="page-section">
            <Card
              title="Checklist progress"
              description={process?.name}
              padding="compact"
              action={
                <Button
                  variant="ghost"
                  size="sm"
                  leadingIcon={<Sparkles size={14} aria-hidden="true" />}
                  onClick={openAssistant}
                >
                  Ask AI
                </Button>
              }
            >
              <ProgressBar
                value={application.progress}
                label={`${application.progress}% complete`}
                variant={isComplete ? 'success' : 'primary'}
                size="lg"
              />

              <div className="summary-strip">
                <div className="summary-strip__item summary-strip__item--success">
                  <span className="summary-strip__count">{summary.completed}</span>
                  <span className="ui-caption">Completed</span>
                </div>
                <div className="summary-strip__item summary-strip__item--progress">
                  <span className="summary-strip__count">{summary.inProgress}</span>
                  <span className="ui-caption">In progress</span>
                </div>
                <div className="summary-strip__item summary-strip__item--missing">
                  <span className="summary-strip__count">{summary.missing}</span>
                  <span className="ui-caption">Missing</span>
                </div>
              </div>
            </Card>

            <TabGroup
              label="Checklist filters"
              tabs={[
                {
                  id: 'all',
                  label: 'All items',
                  count: requirements.length,
                  render: () => (
                    <div className="checklist-group">
                      {renderChecklist(requirements, 'This checklist is empty.')}
                    </div>
                  ),
                },
                {
                  id: 'missing',
                  label: 'Missing',
                  count: groups.missing.length,
                  render: () => (
                    <div className="checklist-group">
                      {renderChecklist(
                        groups.missing,
                        'Nothing is missing. Every requirement has a document attached.',
                      )}
                    </div>
                  ),
                },
                {
                  id: 'progress',
                  label: 'In progress',
                  count: groups.inProgress.length,
                  render: () => (
                    <div className="checklist-group">
                      {renderChecklist(
                        groups.inProgress,
                        'Nothing is in progress. Mark an item as started when you begin collecting it.',
                      )}
                    </div>
                  ),
                },
                {
                  id: 'completed',
                  label: 'Completed',
                  count: groups.completed.length,
                  render: () => (
                    <div className="checklist-group">
                      {renderChecklist(groups.completed, 'No items completed yet.')}
                    </div>
                  ),
                },
              ]}
            />
          </div>

          <aside className="page-section">
            <Card title="Application details" padding="compact">
              <KeyValueList
                columns={1}
                items={[
                  { id: 'reference', label: 'Reference', value: application.reference },
                  { id: 'process', label: 'Process', value: process?.name },
                  { id: 'authority', label: 'Handled by', value: process?.authority },
                  { id: 'turnaround', label: 'Turnaround', value: process?.turnaround },
                  {
                    id: 'created',
                    label: 'Started',
                    value: formatDate(application.createdAt),
                  },
                  {
                    id: 'due',
                    label: 'Deadline',
                    value: application.dueDate ? formatDate(application.dueDate) : 'No deadline',
                  },
                  {
                    id: 'next',
                    label: 'Next action',
                    value: application.nextStep,
                  },
                ]}
              />
            </Card>

            <Card
              title="Linked documents"
              description={pluralize(documents.length, 'file') + ' in your library'}
              padding="compact"
              action={
                <Button
                  variant="ghost"
                  size="sm"
                  leadingIcon={<Paperclip size={14} aria-hidden="true" />}
                  onClick={() => handleUpload()}
                >
                  Add
                </Button>
              }
            >
              {documents.length === 0 ? (
                <p className="ui-caption">
                  Nothing uploaded for this application yet. Uploading a file here keeps it
                  connected to this checklist.
                </p>
              ) : (
                <ul className="mini-list">
                  {documents.map((document) => (
                    <li key={document.id} className="mini-list__item">
                      <span className="mini-list__icon" aria-hidden="true">
                        <Paperclip size={16} />
                      </span>

                      <span className="mini-list__body">
                        <span className="mini-list__title">{document.name}</span>
                        <span className="mini-list__meta">
                          {document.fileName} · {document.statusLabel}
                        </span>
                      </span>

                      <span className="mini-list__aside">
                        <StatusBadge status={document.badgeStatus}>
                          {document.expiresAt ? formatDate(document.expiresAt) : 'No expiry'}
                        </StatusBadge>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card title="At a glance" padding="compact">
              <ul className="mini-list">
                <li className="mini-list__item">
                  <span className="mini-list__icon mini-list__icon--success" aria-hidden="true">
                    <CircleCheck size={16} />
                  </span>
                  <span className="mini-list__body">
                    <span className="mini-list__title">
                      {summary.completed} documents accepted
                    </span>
                    <span className="mini-list__meta">Ready to submit</span>
                  </span>
                </li>

                <li className="mini-list__item">
                  <span className="mini-list__icon mini-list__icon--progress" aria-hidden="true">
                    <Hourglass size={16} />
                  </span>
                  <span className="mini-list__body">
                    <span className="mini-list__title">{summary.inProgress} items in progress</span>
                    <span className="mini-list__meta">Started but not uploaded yet</span>
                  </span>
                </li>

                <li className="mini-list__item">
                  <span className="mini-list__icon mini-list__icon--missing" aria-hidden="true">
                    <TriangleAlert size={16} />
                  </span>
                  <span className="mini-list__body">
                    <span className="mini-list__title">{summary.missing} items still missing</span>
                    <span className="mini-list__meta">
                      {summary.required} required items in this checklist
                    </span>
                  </span>
                </li>

                <li className="mini-list__item">
                  <span className="mini-list__icon" aria-hidden="true">
                    <Clock size={16} />
                  </span>
                  <span className="mini-list__body">
                    <span className="mini-list__title">
                      {application.dueDate
                        ? formatCountdown(application.dueDate)
                        : 'No deadline set'}
                    </span>
                    <span className="mini-list__meta">
                      {application.dueDate ? formatDate(application.dueDate) : 'Submit whenever ready'}
                    </span>
                  </span>
                </li>
              </ul>
            </Card>
          </aside>
        </div>
      </div>
    </AppLayout>
  )
}
