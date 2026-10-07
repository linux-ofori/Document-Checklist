import { useMemo, useState } from 'react'
import { CalendarClock, Info, Link2, Sparkles } from 'lucide-react'
import { Alert, Button, Dropzone, Input, Modal, Select } from '../ui'
import { useAppData } from '../../hooks/useAppData'
import { validateUploadForm } from '../../utils/validation'
import { formatFileSize, toDateInputValue, addMonths } from '../../utils/format'
import {
  ACCEPTED_UPLOAD_FORMATS,
  DOCUMENT_TYPES,
  DOCUMENT_TYPE_OPTIONS,
  MAX_UPLOAD_SIZE_MB,
  getDocumentTypeLabel,
} from '../../data'
import { findRequirementByType } from '../../utils/checklist'

const MIN_EXPIRY_DATE = toDateInputValue(new Date())

function getInitialValues(prefill) {
  return {
    name: prefill?.name ?? '',
    documentType: prefill?.documentType ?? '',
    applicationId: prefill?.applicationId ?? '',
    file: null,
    fileName: '',
    fileSizeKb: 0,
    expiryDate: '',
    note: '',
  }
}

export function UploadDocumentModal() {
  const { upload, closeUploadModal } = useAppData()

  if (!upload.isOpen) return null

  return (
    <Modal
      isOpen
      onClose={closeUploadModal}
      title="Upload a document"
      description="Add a file to your library. We will link it to the checklist item it satisfies."
      size="lg"
      footer={<UploadFormFooter />}
    >
      <UploadForm prefill={upload.prefill} />
    </Modal>
  )
}

function UploadFormFooter() {
  const { upload, closeUploadModal, isLoading } = useAppData()
  const isSubmitting = upload.isSubmitting

  return (
    <>
      <Button variant="ghost" size="md" onClick={closeUploadModal} disabled={isSubmitting}>
        Cancel
      </Button>
      <Button
        type="submit"
        variant="primary"
        size="md"
        form="upload-document-form"
        isLoading={isSubmitting}
        disabled={isLoading}
      >
        {isSubmitting ? 'Uploading' : 'Upload document'}
      </Button>
    </>
  )
}

function UploadForm({ prefill }) {
  const { upload, submitUpload, applicationViews } = useAppData()

  const [values, setValues] = useState(() => getInitialValues(prefill))
  const [errors, setErrors] = useState({})

  const isSubmitting = upload.isSubmitting

  const applicationOptions = useMemo(
    () =>
      applicationViews.map((application) => ({
        value: application.id,
        label: `${application.name} · ${application.progress}% complete`,
      })),
    [applicationViews],
  )

  const matchedRequirement = useMemo(() => {
    if (!values.applicationId || !values.documentType) return null

    const application = applicationViews.find((entry) => entry.id === values.applicationId)
    if (!application) return null

    return findRequirementByType(application.requirements, values.documentType)
  }, [applicationViews, values.applicationId, values.documentType])

  const clearError = (key) => {
    setErrors((current) => {
      if (!current[key]) return current
      const next = { ...current }
      delete next[key]
      return next
    })
  }

  const setValue = (key, value) => {
    setValues((current) => ({ ...current, [key]: value }))
    clearError(key)
  }

  const handleFile = (file) => {
    if (!file) {
      setValues((current) => ({ ...current, file: null, fileName: '', fileSizeKb: 0 }))
      return
    }

    setValues((current) => ({
      ...current,
      file,
      fileName: file.name,
      fileSizeKb: Math.max(1, Math.round(file.size / 1024)),
      name: current.name || file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' '),
    }))

    clearError('file')
  }

  const handleDocumentTypeChange = (documentType) => {
    const definition = DOCUMENT_TYPES.find((entry) => entry.value === documentType)
    const months = definition?.expiresAfterMonths ?? null

    setValues((current) => ({
      ...current,
      documentType,
      expiryDate: months ? toDateInputValue(addMonths(new Date(), months)) : '',
    }))

    clearError('documentType')
  }

  const handleSubmit = async (event) => {
    event.preventDefault()

    const validationErrors = validateUploadForm(values)
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors)
      return
    }

    await submitUpload(values)
  }

  return (
    <form id="upload-document-form" className="upload-form" onSubmit={handleSubmit} noValidate>
      <Dropzone
        file={
          values.fileName ? { name: values.fileName, meta: formatFileSize(values.fileSizeKb) } : null
        }
        onFileSelect={handleFile}
        onFileClear={() => setValues((current) => ({ ...current, file: null, fileName: '', fileSizeKb: 0 }))}
        formats={ACCEPTED_UPLOAD_FORMATS.join(', ')}
        maxSizeMb={MAX_UPLOAD_SIZE_MB}
      />

      {errors.file ? (
        <Alert tone="danger" title="Choose a file first" description={errors.file} />
      ) : null}

      <div className="upload-form__grid">
        <Input
          label="Document name"
          required
          value={values.name}
          placeholder="Ghana Card (Front and Back)"
          onChange={(event) => setValue('name', event.target.value)}
          error={errors.name}
          disabled={isSubmitting}
        />

        <Select
          label="Document type"
          required
          value={values.documentType}
          placeholder="Select a document type"
          onChange={(event) => handleDocumentTypeChange(event.target.value)}
          error={errors.documentType}
          disabled={isSubmitting}
          options={DOCUMENT_TYPE_OPTIONS}
        />

        <Select
          label="Associated application"
          required
          value={values.applicationId}
          placeholder="Select an application"
          onChange={(event) => setValue('applicationId', event.target.value)}
          error={errors.applicationId}
          disabled={isSubmitting}
          options={applicationOptions}
        />

        <Input
          label="Expiry date"
          type="date"
          hint="Leave blank if the document never expires."
          value={values.expiryDate}
          min={MIN_EXPIRY_DATE}
          onChange={(event) => setValue('expiryDate', event.target.value)}
          error={errors.expiryDate}
          disabled={isSubmitting}
        />
      </div>

      {matchedRequirement ? (
        <Alert
          tone="success"
          icon={<Link2 size={18} aria-hidden="true" />}
          title={`This will complete “${matchedRequirement.name}”`}
          description={`Uploading a ${getDocumentTypeLabel(
            values.documentType,
          ).toLowerCase()} marks ${matchedRequirement.name.toLowerCase()} as completed and updates your progress.`}
        />
      ) : (
        <Alert
          tone="info"
          icon={<Info size={18} aria-hidden="true" />}
          title="Saved to your document library"
          description="Pick an application so this document can be matched to a checklist item and reused later."
        />
      )}

      <div className="upload-form__tip">
        {values.fileName ? (
          <Sparkles size={15} aria-hidden="true" />
        ) : (
          <CalendarClock size={15} aria-hidden="true" />
        )}
        <span>
          {values.fileName
            ? 'Tip: name files clearly, for example “Ghana Card 2026”, so expiry reminders stay accurate.'
            : 'Adding expiry dates lets Smart Document Checklist warn you 60, 30 and 7 days before a document runs out.'}
        </span>
      </div>
    </form>
  )
}
