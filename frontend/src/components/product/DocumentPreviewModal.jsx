import { CalendarDays, FileText, Info, Link2, Paperclip, Upload } from 'lucide-react'
import { Button, KeyValueList, Modal, StatusBadge } from '../ui'
import { useAppData } from '../../hooks/useAppData'
import { formatDate, formatDateTime, formatFileSize } from '../../utils/format'

export function DocumentPreviewModal() {
  const { preview, closeDocumentPreview, getDocumentById, openUploadModal } = useAppData()
  const document = preview.documentId ? getDocumentById(preview.documentId) : null

  return (
    <Modal
      isOpen={preview.isOpen && Boolean(document)}
      onClose={closeDocumentPreview}
      title={document?.name}
      description={document?.fileName}
      size="lg"
      footer={
        <>
          <Button variant="ghost" size="md" onClick={closeDocumentPreview}>
            Close
          </Button>
          {document?.application ? (
            <Button
              variant="outline"
              size="md"
              leadingIcon={<Upload size={16} aria-hidden="true" />}
              onClick={() => {
                closeDocumentPreview()
                openUploadModal({
                  applicationId: document.applicationId,
                  documentType: document.documentType,
                  name: document.name,
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
          <div className="document-preview__canvas" role="img" aria-label={`Preview of ${document.name}`}>
            <FileText size={40} aria-hidden="true" />
            <p className="document-preview__filename">{document.fileName}</p>
            <p className="ui-caption">
              {formatFileSize(document.fileSizeKb)} · Uploaded {formatDateTime(document.uploadedAt)}
            </p>
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

            <p className="ui-caption document-preview__hint">
              <Info size={14} aria-hidden="true" />
              This preview is generated locally. Connect storage later to stream the real file.
            </p>
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
