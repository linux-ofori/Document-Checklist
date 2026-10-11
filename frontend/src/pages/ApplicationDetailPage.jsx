import { useMemo, useRef, useState } from 'react'
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
  Select,
  StatusBadge,
  TabGroup,
} from '../components/ui'
import { useAppData } from '../hooks/useAppData'
import { useActiveRoute } from '../hooks/useActiveRoute'
import { ROUTES } from '../utils/routes'
import { APPLICATION_OUTCOME_LABELS } from '../utils/checklist'
import {
  formatCalendarDate,
  formatCountdown,
  formatDate,
  formatRelativeTime,
  pluralize,
} from '../utils/format'
import { groupRequirementsByStatus } from '../utils/checklist'

const OUTCOME_OPTIONS = Object.entries(APPLICATION_OUTCOME_LABELS).map(([value, label]) => ({
  value,
  label,
}))

export function ApplicationDetailPage({ applicationId }) {
  const { navigate } = useActiveRoute()
  const {
    getApplicationById,
    getDocumentById,
    toggleRequirement,
    setRequirementStatus,
    submitApplication,
    updateApplicationDecision,
    showToast,
    openUploadModal,
    openDocumentPreview,
    openAssistant,
    isLoading,
  } = useAppData()

  const [updatingKeys, setUpdatingKeys] = useState(() => new Set())
  const [isSubmittingApplication, setIsSubmittingApplication] = useState(false)
  const [isSavingDecision, setIsSavingDecision] = useState(false)
  const [decisionDraftState, setDecisionDraftState] = useState(null)
  const pendingRequirementKeysRef = useRef(new Set())
  const submissionInFlightRef = useRef(false)
  const decisionInFlightRef = useRef(false)

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
  const decisionDraft = decisionDraftState?.applicationId === application.id
    && decisionDraftState.baseOutcome === application.outcome
    ? decisionDraftState.value
    : application.outcome ?? ''
  const isChecklistComplete = summary.missing === 0 && summary.inProgress === 0
  const requiredItemsRemaining = requirements.filter(
    (requirement) => requirement.isRequired && requirement.status !== 'completed',
  ).length

  const handleSubmitApplication = async () => {
    if (submissionInFlightRef.current || !application.readyToSubmit) return
    submissionInFlightRef.current = true
    setIsSubmittingApplication(true)
    try {
      await submitApplication(application.id)
    } catch {
      // Provider surfaces the API error through the shared toast.
    } finally {
      submissionInFlightRef.current = false
      setIsSubmittingApplication(false)
    }
  }

  const handleSaveDecision = async () => {
    if (
      decisionInFlightRef.current
      || !APPLICATION_OUTCOME_LABELS[decisionDraft]
      || decisionDraft === application.outcome
    ) return
    decisionInFlightRef.current = true
    setIsSavingDecision(true)
    try {
      await updateApplicationDecision(application.id, decisionDraft)
    } catch {
      // Provider surfaces the API error through the shared toast.
    } finally {
      decisionInFlightRef.current = false
      setIsSavingDecision(false)
    }
  }

  const getRequirementUpdateKey = (requirementKey) =>
    JSON.stringify([application.id, requirementKey])

  const startRequirementUpdate = (requirementKey) => {
    const updateKey = getRequirementUpdateKey(requirementKey)
    if (pendingRequirementKeysRef.current.has(updateKey)) return null

    pendingRequirementKeysRef.current.add(updateKey)
    setUpdatingKeys((current) => new Set(current).add(updateKey))
    return updateKey
  }

  const finishRequirementUpdate = (updateKey) => {
    pendingRequirementKeysRef.current.delete(updateKey)
    setUpdatingKeys((current) => {
      const next = new Set(current)
      next.delete(updateKey)
      return next
    })
  }

  const runUpdate = async (requirement, nextStatus) => {
    const updateKey = startRequirementUpdate(requirement.key)
    if (updateKey === null) return false

    try {
      if (nextStatus === undefined) {
        await toggleRequirement(application.id, requirement.key, requirement.status)
      } else {
        await setRequirementStatus(application.id, requirement.key, nextStatus)
      }
    } finally {
      finishRequirementUpdate(updateKey)
    }
  }

  const handleUnlinkDocument = async (requirement) => {
    const updateKey = startRequirementUpdate(requirement.key)
    if (updateKey === null) return false

    try {
      const updated = await setRequirementStatus(
        application.id,
        requirement.key,
        requirement.status,
        null,
        { requireConfirmedResponse: true },
      )
      if (updated) showToast('Document unlinked from checklist.')
    } finally {
      finishRequirementUpdate(updateKey)
    }
  }

  const handleUpload = (requirement) => {
    openUploadModal({
      applicationId: application.id,
      documentType: requirement?.type ?? '',
      name: requirement?.name ?? '',
      requirementKey: requirement?.key,
    })
  }

  const handleReplaceDocument = (document) => {
    if (document?.id) {
      openUploadModal({ replacementTarget: document })
    }
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
            onReplaceDocument={handleReplaceDocument}
            onUnlinkDocument={handleUnlinkDocument}
            onViewDocument={(document) => openDocumentPreview(document.id)}
            isUpdating={updatingKeys.has(getRequirementUpdateKey(requirement.key))}
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

        {application.status === 'completed' ? (
          <Alert
            tone="success"
            icon={<CircleCheck size={18} aria-hidden="true" />}
            title="Application completed"
            description={application.outcome
              ? `Owner-recorded institution outcome: ${APPLICATION_OUTCOME_LABELS[application.outcome] ?? application.outcome}.`
              : 'The application process has been marked completed.'}
          />
        ) : application.status === 'submitted' ? (
          <Alert
            tone="info"
            icon={<Clock size={18} aria-hidden="true" />}
            title="Application submitted"
            description={application.outcome === 'pending'
              ? 'The owner-recorded outcome is pending; the application remains submitted.'
              : 'This application has been submitted. Checklist completion does not change its submitted status.'}
          />
        ) : application.readyToSubmit === true ? (
          <Alert
            tone="success"
            icon={<CircleCheck size={18} aria-hidden="true" />}
            title="Required checklist items are complete"
            description="You can submit when you are ready. Optional items and attached documents do not block submission."
          />
        ) : application.readyToSubmit === null ? (
          <Alert
            tone="info"
            icon={<TriangleAlert size={18} aria-hidden="true" />}
            title="Submission readiness could not be confirmed"
            description="Refresh the application data before submitting. The checklist may not contain every required item."
          />
        ) : (
          <Alert
            tone="info"
            icon={<TriangleAlert size={18} aria-hidden="true" />}
            title={application.nextStep}
            description={`${requiredItemsRemaining} required ${
              requiredItemsRemaining === 1 ? 'item remains' : 'items remain'
            } incomplete. Progress includes all ${summary.total} checklist items. ${
              application.dueDate ? formatCountdown(application.dueDate) : 'No deadline set.'
            }`}
          />
        )}

        {application.status === 'in-progress' ? (
          <Card
            title="Submit application"
            description={application.readyToSubmit
              ? 'Submission is allowed because all required checklist items are complete.'
              : application.readyToSubmit === false
                ? 'Complete the remaining required checklist items before submitting.'
                : 'Readiness is unknown. Refresh the application data before submitting.'}
            padding="compact"
          >
            <Button
              variant="primary"
              size="md"
              leadingIcon={<Upload size={16} aria-hidden="true" />}
              isLoading={isSubmittingApplication}
              disabled={!application.readyToSubmit || isSubmittingApplication}
              onClick={handleSubmitApplication}
            >
              Submit application
            </Button>
          </Card>
        ) : null}

        {application.status === 'submitted' || application.status === 'completed' ? (
          <Card
            title="Institution outcome"
            description="Record the outcome communicated to you by the institution. Saving here does not contact or verify with the institution."
            padding="compact"
          >
            <p className="ui-body">
              Current owner-recorded outcome:{' '}
              <strong>
                {application.outcome
                  ? APPLICATION_OUTCOME_LABELS[application.outcome] ?? application.outcome
                  : 'Not recorded'}
              </strong>
              {application.outcome === 'pending'
                ? ' — the application remains submitted.'
                : application.outcome === 'accepted' || application.outcome === 'rejected'
                  ? ' — the application is completed.'
                  : ''}
            </p>
            <div className="form-actions">
              <Select
                label="Institution outcome"
                hint="Pending keeps the application submitted; accepted or rejected marks it completed."
                value={decisionDraft}
                onChange={(event) => setDecisionDraftState({
                  applicationId: application.id,
                  baseOutcome: application.outcome,
                  value: event.target.value,
                })}
                options={OUTCOME_OPTIONS}
                disabled={isSavingDecision}
              />
              <Button
                variant="outline"
                size="md"
                isLoading={isSavingDecision}
                disabled={
                  isSavingDecision
                  || !APPLICATION_OUTCOME_LABELS[decisionDraft]
                  || decisionDraft === application.outcome
                }
                onClick={handleSaveDecision}
              >
                Save outcome
              </Button>
            </div>
          </Card>
        ) : null}

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
                variant={isChecklistComplete ? 'success' : 'primary'}
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
                          {document.expiresAt
                            ? formatCalendarDate(document.expiresAt)
                            : 'No expiry'}
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
                    <span className="mini-list__meta">
                      {application.readyToSubmit
                        ? 'Required items ready to submit'
                        : 'Required items outstanding'}
                    </span>
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
