import { DOCUMENTS } from '../data'
import { createId, resolveAfter, resolvePayload } from './client'

export function fetchDocuments() {
  return resolvePayload(DOCUMENTS, 460)
}

export function uploadDocument({ name, documentType, applicationId, fileName, fileSizeKb, expiryDate, note }) {
  return resolveAfter(880).then(() => ({
    id: createId('doc'),
    name: name ?? fileName ?? 'New document',
    documentType,
    applicationId: applicationId || null,
    status: 'in-review',
    fileName: fileName ?? 'uploaded-document.pdf',
    fileSizeKb: fileSizeKb ?? 512,
    uploadedAt: new Date().toISOString(),
    expiresAt: expiryDate ? new Date(expiryDate).toISOString() : null,
    note: note ?? null,
  }))
}

export function updateDocumentRecord(documentId, patch) {
  return resolveAfter(240).then(() => ({ id: documentId, ...patch }))
}

export function removeDocumentRecord(documentId) {
  return resolveAfter(320).then(() => ({ id: documentId, deleted: true }))
}
