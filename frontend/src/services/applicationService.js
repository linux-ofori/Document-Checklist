import { request } from './client'

function applicationFromResponse(payload) {
  if (!payload?.application) {
    throw new Error('The server returned an invalid application response.')
  }
  return payload.application
}

export async function fetchApplications() {
  const payload = await request('applications')
  if (!Array.isArray(payload?.applications)) {
    throw new Error('The server returned an invalid applications response.')
  }
  return payload.applications
}

export async function fetchApplication(applicationId) {
  const payload = await request(`applications/${encodeURIComponent(applicationId)}`)
  return applicationFromResponse(payload)
}

export async function createApplication({ processId, name }) {
  const body = { processId }
  if (name !== undefined) {
    body.name = name
  }

  const payload = await request('applications', { method: 'POST', body })
  return applicationFromResponse(payload)
}

export async function saveRequirementStatus({
  applicationId,
  requirementKey,
  status,
  documentId,
}) {
  const body = { status }
  if (documentId !== undefined) {
    body.documentId = documentId
  }

  return request(
    `applications/${encodeURIComponent(applicationId)}/requirements/${encodeURIComponent(requirementKey)}`,
    { method: 'PATCH', body },
  )
}
