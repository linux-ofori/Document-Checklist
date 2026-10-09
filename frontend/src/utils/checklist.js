export const CHECKLIST_STATUSES = ['completed', 'in-progress', 'missing']

export const CHECKLIST_STATUS_LABELS = {
  completed: 'Completed',
  'in-progress': 'In progress',
  missing: 'Missing',
}

export const CHECKLIST_STATUS_WEIGHT = {
  completed: 1,
  'in-progress': 0.5,
  missing: 0,
}

export const APPLICATION_STATUS_LABELS = {
  draft: 'Draft',
  'in-progress': 'In progress',
  submitted: 'Submitted',
  completed: 'Completed',
}

export const DOCUMENT_STATUS_LABELS = {
  verified: 'Verified',
  'in-review': 'In review',
  'expiring': 'Expiring',
  expired: 'Expired',
  draft: 'Draft',
}

const BADGE_FOR_APPLICATION_STATUS = {
  draft: 'neutral',
  'in-progress': 'pending',
  submitted: 'in-progress',
  completed: 'completed',
}

const BADGE_FOR_DOCUMENT_STATUS = {
  verified: 'completed',
  'in-review': 'in-progress',
  expiring: 'expired',
  expired: 'expired',
  draft: 'neutral',
}

export function summariseChecklist(requirements = []) {
  const summary = {
    total: requirements.length,
    completed: 0,
    inProgress: 0,
    missing: 0,
    required: 0,
    completedRequired: 0,
  }

  for (const requirement of requirements) {
    if (requirement.isRequired) summary.required += 1
    if (requirement.status === 'completed') {
      summary.completed += 1
      if (requirement.isRequired) summary.completedRequired += 1
    } else if (requirement.status === 'in-progress') {
      summary.inProgress += 1
    } else {
      summary.missing += 1
    }
  }

  return summary
}

export function calculateProgress(requirements = []) {
  const { total } = summariseChecklist(requirements)
  if (total === 0) return 0

  const weighted = requirements.reduce(
    (totalWeight, requirement) => totalWeight + (CHECKLIST_STATUS_WEIGHT[requirement.status] ?? 0),
    0,
  )

  return Math.round((weighted / total) * 100)
}

export function groupRequirementsByStatus(requirements = []) {
  return {
    completed: requirements.filter((item) => item.status === 'completed'),
    inProgress: requirements.filter((item) => item.status === 'in-progress'),
    missing: requirements.filter((item) => item.status === 'missing'),
  }
}

export function deriveApplicationStatus(application) {
  if (!application) return 'draft'

  const { total, missing, inProgress } = summariseChecklist(application.requirements ?? [])
  if (total === 0) return 'draft'
  if (missing === 0 && inProgress === 0) return 'completed'
  if (missing > 0 || inProgress > 0) return 'in-progress'

  return 'draft'
}

export function applicationBadgeStatus(status) {
  return BADGE_FOR_APPLICATION_STATUS[status] ?? 'neutral'
}

export function documentBadgeStatus(status) {
  return BADGE_FOR_DOCUMENT_STATUS[status] ?? 'neutral'
}

export function isDocumentExpired(document, now = new Date()) {
  if (!document?.expiresAt) return false
  const expiry = new Date(document.expiresAt)
  if (Number.isNaN(expiry.getTime())) return false
  return expiry.getTime() < now.getTime()
}

export function documentExpiryState(document, now = new Date()) {
  if (!document?.expiresAt) return 'none'

  const expiry = new Date(document.expiresAt)
  if (Number.isNaN(expiry.getTime())) return 'none'

  const diffDays = Math.ceil((expiry.getTime() - now.getTime()) / 86400000)
  if (diffDays < 0) return 'expired'
  if (diffDays <= 45) return 'expiring'

  return 'valid'
}

export function findRequirementByType(requirements = [], type) {
  return requirements.find((requirement) => requirement.type === type) ?? null
}

export function getDocumentApplicationIds(document) {
  const applicationIds = Array.isArray(document?.applicationIds)
    ? document.applicationIds
    : [document?.applicationId]
  return [...new Set(applicationIds.filter((id) => typeof id === 'string' && id.trim()))]
}

export function normalizeDocumentAssociations(document) {
  const applicationIds = getDocumentApplicationIds(document)
  const applicationId = applicationIds.includes(document?.applicationId)
    ? document.applicationId
    : applicationIds[0] ?? null

  return { ...document, applicationIds, applicationId }
}

export function searchDocuments(documents, query, applications) {
  const term = String(query ?? '').trim().toLowerCase()
  if (!term) return documents

  return documents.filter((document) => {
    const linkedApplicationNames = applications
      .filter((application) => getDocumentApplicationIds(document).includes(application.id))
      .map((application) => application.name)
    const haystack = [
      document.name,
      document.documentType,
      document.typeLabel,
      document.fileName,
      ...linkedApplicationNames,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()

    return haystack.includes(term)
  })
}
