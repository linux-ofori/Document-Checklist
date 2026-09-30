import { APPLICATIONS } from '../data'
import { resolveAfter, resolvePayload } from './client'

export function fetchApplications() {
  return resolvePayload(APPLICATIONS, 420)
}

export function fetchApplication(applicationId) {
  return resolvePayload(
    APPLICATIONS.find((application) => application.id === applicationId) ?? null,
    200,
  )
}

export function saveRequirementStatus({ applicationId, requirementKey, status, documentId, completedAt }) {
  return resolveAfter(180).then(() => ({
    applicationId,
    requirementKey,
    status,
    documentId: documentId ?? null,
    completedAt: completedAt ?? null,
  }))
}
