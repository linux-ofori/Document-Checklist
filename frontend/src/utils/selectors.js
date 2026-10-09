import { getDocumentTypeLabel, getProcessById, getRequirementTemplate } from '../data'
import {
  APPLICATION_STATUS_LABELS,
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
      isRequired: item.isRequired ?? true,
      description: item.description ?? '',
      guidance: item.guidance ?? '',
      status: override?.status ?? 'missing',
      documentId: override?.documentId ?? null,
      completedAt: override?.completedAt ?? null,
    }
  })
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

  const checklistComplete = summary.total > 0 && summary.missing === 0 && summary.inProgress === 0
  const status = application.status === 'submitted' ? 'submitted' : checklistComplete ? 'completed' : 'in-progress'

  const nextRequired = requirements.find((item) => item.isRequired && item.status !== 'completed') ?? null
  const nextStep = checklistComplete
    ? 'Everything is complete. You can submit this application.'
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
