import { request } from './client'

function requireFile(file) {
  if (
    typeof Blob === 'undefined'
    || !(file instanceof Blob)
    || typeof file.name !== 'string'
    || !file.name
  ) {
    throw new Error('Choose a file before uploading.')
  }
}

function documentFromResponse(payload) {
  if (!payload?.document) {
    throw new Error('The server returned an invalid document response.')
  }
  return payload.document
}

export async function fetchDocuments() {
  const payload = await request('documents')
  if (!Array.isArray(payload?.documents)) {
    throw new Error('The server returned an invalid documents response.')
  }
  return payload.documents
}

export async function fetchDocument(documentId) {
  const payload = await request(`documents/${encodeURIComponent(documentId)}`)
  return documentFromResponse(payload)
}

export async function uploadDocument({
  file,
  name,
  documentType,
  applicationId,
  expiresAt,
  expiryDate,
  note,
}) {
  requireFile(file)
  if (!name || !documentType) {
    throw new Error('Document name and type are required.')
  }

  const formData = new FormData()
  formData.append('file', file, file.name)
  formData.append('name', name)
  formData.append('documentType', documentType)

  if (applicationId) {
    formData.append('applicationId', applicationId)
  }
  const documentExpiry = expiresAt ?? expiryDate
  if (documentExpiry) {
    formData.append('expiresAt', documentExpiry)
  }
  if (note) {
    formData.append('note', note)
  }

  const payload = await request('documents', { method: 'POST', body: formData })
  return documentFromResponse(payload)
}

export async function updateDocumentRecord(documentId, patch) {
  const payload = await request(`documents/${encodeURIComponent(documentId)}`, {
    method: 'PUT',
    body: patch,
  })
  return documentFromResponse(payload)
}

export async function removeDocumentRecord(documentId) {
  return request(`documents/${encodeURIComponent(documentId)}`, { method: 'DELETE' })
}

export async function addDocumentApplication(documentId, applicationId) {
  const payload = await request(`documents/${encodeURIComponent(documentId)}/applications`, {
    method: 'POST',
    body: { applicationId },
  })
  return documentFromResponse(payload)
}

export async function removeDocumentApplication(documentId, applicationId) {
  const payload = await request(
    `documents/${encodeURIComponent(documentId)}/applications/${encodeURIComponent(applicationId)}`,
    { method: 'DELETE' },
  )
  return documentFromResponse(payload)
}

export function fetchDocumentFile(documentId) {
  return request(`documents/${encodeURIComponent(documentId)}/file`, {
    responseType: 'blob',
  })
}

export async function replaceDocumentFile(documentId, file) {
  requireFile(file)

  const formData = new FormData()
  formData.append('file', file, file.name)

  const payload = await request(`documents/${encodeURIComponent(documentId)}/file`, {
    method: 'PUT',
    body: formData,
  })
  return documentFromResponse(payload)
}
