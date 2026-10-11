import { getDocumentTypeLabel, getProcessById, getRequirementTemplate } from '../data'
import {
  APPLICATION_STATUS_LABELS,
  APPLICATION_OUTCOME_LABELS,
  CHECKLIST_STATUSES,
  CHECKLIST_STATUS_LABELS,
  DOCUMENT_STATUS_LABELS,
  applicationBadgeStatus,
  calculateProgress,
  documentBadgeStatus,
  documentExpiryState,
  getDocumentApplicationIds,
  normalizeDocumentAssociations,
  summariseChecklist,
} from './checklist'

export function buildRequirements(application) {
  if (!application) return []

  const template = getRequirementTemplate(application.processId)
  const overrides = new Map((application.requirements ?? []).map((entry) => [entry.key, entry]))

  return template.map((item) => {
    const override = overrides.get(item.key)

    return {
      ...item,
      ...override,
      isRequired: typeof override?.isRequired === 'boolean'
        ? override.isRequired
        : item.isRequired ?? true,
      description: override?.description ?? item.description ?? '',
      guidance: override?.guidance ?? item.guidance ?? '',
      status: override?.status ?? 'missing',
      documentId: override?.documentId ?? null,
      completedAt: override?.completedAt ?? null,
    }
  })
}

function deriveFallbackReadiness(application, template, requirements) {
  const sourceRequirements = application.requirements
  if (
    !getProcessById(application.processId)
    || template.length === 0
    || !Array.isArray(sourceRequirements)
    || sourceRequirements.length !== template.length
  ) {
    return null
  }

  const templateByKey = new Map(template.map((item) => [item.key, item]))
  const sourceKeys = new Set()
  for (const requirement of sourceRequirements) {
    const templateRequirement = templateByKey.get(requirement?.key)
    if (
      typeof requirement?.key !== 'string'
      || !templateRequirement
      || sourceKeys.has(requirement.key)
      || (requirement.isRequired !== undefined && typeof requirement.isRequired !== 'boolean')
      || (
        typeof requirement.isRequired === 'boolean'
        && requirement.isRequired !== templateRequirement.isRequired
      )
      || (requirement.status !== undefined && !CHECKLIST_STATUSES.includes(requirement.status))
    ) {
      return null
    }
    sourceKeys.add(requirement.key)
  }

  if (
    sourceKeys.size !== templateByKey.size
    || template.some((item) => typeof item.isRequired !== 'boolean')
  ) {
    return null
  }

  return requirements
    .filter((item) => item.isRequired)
    .every((item) => item.status === 'completed')
}

export function buildApplicationView(application, documents = []) {
  if (!application) return null

  const requirements = buildRequirements(application)
  const summary = summariseChecklist(requirements)
  const progress = calculateProgress(requirements)
  const process = getProcessById(application.processId)
  const linkedDocuments = documents.filter((document) =>
    getDocumentApplicationIds(document).includes(application.id),
  )

  const status = ['in-progress', 'submitted', 'completed'].includes(application.status)
    ? application.status
    : 'in-progress'
  const readyToSubmit = typeof application.readyToSubmit === 'boolean'
    ? application.readyToSubmit
    : deriveFallbackReadiness(application, getRequirementTemplate(application.processId), requirements)

  const nextRequired = requirements.find((item) => item.isRequired && item.status !== 'completed') ?? null
  const nextStep = status === 'completed'
    ? application.outcome === 'accepted'
      ? 'Application completed with an accepted outcome.'
      : application.outcome === 'rejected'
        ? 'Application completed with a rejected outcome.'
        : 'Application process completed.'
    : status === 'submitted'
      ? application.outcome === 'pending'
        ? 'Application submitted and awaiting an outcome.'
        : 'Application submitted.'
      : readyToSubmit === null
        ? 'Submission readiness could not be confirmed from the available checklist data.'
        : readyToSubmit
          ? 'Required checklist items are complete. You can submit this application.'
          : (nextRequired
            ? `Add ${nextRequired.name.toLowerCase()} to keep this application moving.`
            : (application.nextStep ?? 'Finish the optional items when you are ready.'))

  return {
    ...application,
    process,
    requirements,
    summary,
    progress,
    status,
    readyToSubmit,
    outcomeLabel: APPLICATION_OUTCOME_LABELS[application.outcome] ?? null,
    statusLabel: APPLICATION_STATUS_LABELS[status] ?? 'In progress',
    badgeStatus: applicationBadgeStatus(status),
    documents: linkedDocuments,
    nextRequired,
    nextStep,
  }
}

export function buildDocumentView(document, applications = []) {
  if (!document) return null

  const normalizedDocument = normalizeDocumentAssociations(document)
  const linkedApplications = normalizedDocument.applicationIds
    .map((applicationId) => applications.find((entry) => entry.id === applicationId))
    .filter(Boolean)
  const application = linkedApplications.find(
    (entry) => entry.id === normalizedDocument.applicationId,
  ) ?? linkedApplications[0] ?? null
  const expiry = documentExpiryState(normalizedDocument)

  return {
    ...normalizedDocument,
    typeLabel: getDocumentTypeLabel(normalizedDocument.documentType),
    application,
    applications: linkedApplications,
    applicationNames: linkedApplications.map((entry) => entry.name),
    applicationName: linkedApplications.map((entry) => entry.name).join(', ') || 'Not linked',
    expiryState: expiry,
    isExpiring: expiry === 'expiring' || expiry === 'expired',
    isExpired: expiry === 'expired',
    statusLabel: DOCUMENT_STATUS_LABELS[document.status] ?? 'In review',
    badgeStatus: documentBadgeStatus(expiry === 'expired' ? 'expired' : document.status),
  }
}

export function buildNotificationView(notification, applications = [], documents = []) {
  if (!notification) return null

  const application = applications.find((entry) => entry.id === notification.applicationId) ?? null
  const document = documents.find((entry) => entry.id === notification.documentId) ?? null

  return {
    ...notification,
    application,
    document,
    applicationName: application?.name ?? null,
    documentName: document?.name ?? null,
    isOverdue: Boolean(
      notification.dueDate && new Date(notification.dueDate).getTime() < Date.now(),
    ),
  }
}

export function buildDashboardStats(applicationViews = [], notificationViews = []) {
  const summary = applicationViews.reduce(
    (totals, application) => {
      totals.completedDocuments += application.summary.completed
      totals.inProgressDocuments += application.summary.inProgress
      totals.missingDocuments += application.summary.missing
      return totals
    },
    { completedDocuments: 0, inProgressDocuments: 0, missingDocuments: 0 },
  )

  return {
    activeApplications: applicationViews.filter(
      (application) => application.status === 'in-progress' || application.status === 'submitted',
    ).length,
    completedApplications: applicationViews.filter((application) => application.status === 'completed')
      .length,
    completedDocuments: summary.completedDocuments,
    pendingDocuments: summary.inProgressDocuments + summary.missingDocuments,
    inProgressDocuments: summary.inProgressDocuments,
    missingDocuments: summary.missingDocuments,
    reminders: notificationViews.filter(
      (notification) => notification.kind !== 'system' && !notification.isRead,
    ).length,
    unreadNotifications: notificationViews.filter((notification) => !notification.isRead).length,
  }
}

export function sortByUpdatedAtDesc(items = []) {
  return [...items].sort(
    (a, b) => new Date(b.updatedAt ?? 0).getTime() - new Date(a.updatedAt ?? 0).getTime(),
  )
}

export function sortByCreatedAtDesc(items = []) {
  return [...items].sort(
    (a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime(),
  )
}

export const CHECKLIST_LABELS = CHECKLIST_STATUS_LABELS
