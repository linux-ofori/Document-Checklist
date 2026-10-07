import { useEffect, useRef, useState } from 'react'
import { CalendarDays, Download, FileText, Info, Link2, Paperclip, Upload } from 'lucide-react'
import { Button, KeyValueList, Modal, StatusBadge } from '../ui'
import { useAppData } from '../../hooks/useAppData'
import { formatDate, formatDateTime, formatFileSize } from '../../utils/format'
import { fetchDocumentFile } from '../../services'

const MIME_TYPE_BY_EXTENSION = {
  '.pdf': 'application/pdf',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
}

const SUPPORTED_MIME_TYPES = new Set(Object.values(MIME_TYPE_BY_EXTENSION))

export function DocumentPreviewModal() {
  const { preview, closeDocumentPreview, getDocumentById, openUploadModal } = useAppData()
  const document = preview.documentId ? getDocumentById(preview.documentId) : null
  const isOpen = preview.isOpen && Boolean(document)
  const [fileState, setFileState] = useState({ documentId: null, status: 'idle' })
  const objectUrlRef = useRef(null)
  const requestIdRef = useRef(0)

  useEffect(() => {
    const requestId = ++requestIdRef.current
    let active = true
    let objectUrl = null

    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current)
      objectUrlRef.current = null
    }

    if (isOpen && document?.id) {
      const loadFile = async () => {
        try {
          const blob = await fetchDocumentFile(document.id)
          if (!active || requestIdRef.current !== requestId) return

          const extension = document.fileName?.slice(document.fileName.lastIndexOf('.')).toLowerCase()
          const extensionMimeType = MIME_TYPE_BY_EXTENSION[extension]
          if (!(blob instanceof Blob) || blob.size === 0 || !extensionMimeType) {
            setFileState({ documentId: document.id, status: 'unavailable' })
            return
          }

          const blobMimeType = blob.type.split(';')[0].trim().toLowerCase()
          const useExtensionMimeType =
            !blobMimeType || blobMimeType === 'application/octet-stream'
          if (
            !useExtensionMimeType
            && (!SUPPORTED_MIME_TYPES.has(blobMimeType) || blobMimeType !== extensionMimeType)
          ) {
            setFileState({ documentId: document.id, status: 'unavailable' })
            return
          }

          const mimeType = useExtensionMimeType ? extensionMimeType : blobMimeType
          objectUrl = URL.createObjectURL(blob.type === mimeType ? blob : blob.slice(0, blob.size, mimeType))
          objectUrlRef.current = objectUrl
          setFileState({ documentId: document.id, status: 'ready', objectUrl, mimeType })
        } catch (error) {
          if (!active || requestIdRef.current !== requestId) return

          let message = 'Could not load this file. Please try again.'
          if (error?.status === 401) {
            message = 'Your session has expired. Please sign in again.'
          } else if (error?.status === 403) {
            message = 'You do not have permission to access this file.'
          } else if (error?.status === 404) {
            message = 'This file is currently unavailable.'
          } else if (error instanceof TypeError) {
            message = 'Could not load this file. Please check your connection and try again.'
          }
          setFileState({ documentId: document.id, status: 'error', message })
        }
      }

      loadFile()
    }

    return () => {
      active = false
      if (objectUrl && objectUrlRef.current === objectUrl) {
        URL.revokeObjectURL(objectUrl)
        objectUrlRef.current = null
      }
    }
  }, [document?.id, document?.fileName, isOpen])

  const currentFileState =
    fileState.documentId === document?.id ? fileState : { status: 'loading' }
  const handleClose = () => {
    requestIdRef.current += 1
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current)
      objectUrlRef.current = null
    }
    setFileState({ documentId: null, status: 'idle' })
    closeDocumentPreview()
  }
  const handleDownload = () => {
    if (currentFileState.status !== 'ready') return

    const link = window.document.createElement('a')
    link.href = currentFileState.objectUrl
    link.download = document.fileName || document.name
    window.document.body.appendChild(link)
    link.click()
    link.remove()
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={document?.name}
      description={document?.fileName}
      size="lg"
      footer={
        <>
          <Button variant="ghost" size="md" onClick={handleClose}>
            Close
          </Button>
          {currentFileState.status === 'ready' ? (
            <Button
              variant="outline"
              size="md"
              leadingIcon={<Download size={16} aria-hidden="true" />}
              onClick={handleDownload}
            >
              Download copy
            </Button>
          ) : null}
          {document?.application ? (
            <Button
              variant="outline"
              size="md"
              leadingIcon={<Upload size={16} aria-hidden="true" />}
              onClick={() => {
                handleClose()
                openUploadModal({
                  replacementTarget: document,
                })
              }}
            >
              Replace file
            </Button>
          ) : null}
        </>
      }
    >
      {document ? (
        <div className="document-preview">
          <div className="document-preview__canvas">
            {currentFileState.status === 'ready' && currentFileState.mimeType === 'application/pdf' ? (
              <iframe
                title={`Preview of ${document.name}`}
                src={currentFileState.objectUrl}
                style={{ width: '100%', height: 'min(60vh, 560px)', border: 0 }}
              />
            ) : currentFileState.status === 'ready' ? (
              <img
                src={currentFileState.objectUrl}
                alt={`Preview of ${document.name}`}
                style={{ maxWidth: '100%', maxHeight: '60vh', objectFit: 'contain' }}
              />
            ) : currentFileState.status === 'loading' ? (
              <p role="status">Loading document preview…</p>
            ) : currentFileState.status === 'error' ? (
              <p role="alert">{currentFileState.message}</p>
            ) : currentFileState.status === 'unavailable' ? (
              <p role="status">This file is unavailable or cannot be previewed.</p>
            ) : (
              <>
                <FileText size={40} aria-hidden="true" />
                <p className="document-preview__filename">{document.fileName}</p>
              </>
            )}
            {currentFileState.status !== 'loading' ? (
              <p className="ui-caption">
                {formatFileSize(document.fileSizeKb)} · Uploaded {formatDateTime(document.uploadedAt)}
              </p>
            ) : null}
          </div>

          <div className="document-preview__meta">
            <KeyValueList
              columns={2}
              items={[
                { id: 'type', label: 'Document type', value: document.typeLabel },
                { id: 'status', label: 'Verification', value: document.statusLabel },
                { id: 'application', label: 'Application', value: document.applicationName },
                {
                  id: 'expiry',
                  label: 'Expiry date',
                  value: document.expiresAt ? formatDate(document.expiresAt) : 'Does not expire',
                },
              ]}
            />

            <div className="document-preview__badges">
              <StatusBadge status={document.badgeStatus}>{document.statusLabel}</StatusBadge>
              {document.isExpiring ? <StatusBadge status="expired">Renew soon</StatusBadge> : null}
            </div>

            {document.note ? (
              <p className="document-preview__note">
                <Paperclip size={14} aria-hidden="true" />
                {document.note}
              </p>
            ) : null}

            {currentFileState.status === 'ready' ? (
              <p className="ui-caption document-preview__hint">
                <Info size={14} aria-hidden="true" />
                Previewing the stored document.
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </Modal>
  )
}

export function DocumentMetaLine({ document }) {
  return (
    <span className="document-meta-line">
      <Link2 size={13} aria-hidden="true" />
      {document.applicationName}
      <CalendarDays size={13} aria-hidden="true" />
      {formatDate(document.expiresAt, 'No expiry')}
    </span>
  )
}
