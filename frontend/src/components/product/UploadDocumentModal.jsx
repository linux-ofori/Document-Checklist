import { useMemo, useRef, useState } from 'react'
import { CalendarClock, Info, Link2, Sparkles } from 'lucide-react'
import { Alert, Button, Dropzone, Input, Modal, Select } from '../ui'
import { useAppData } from '../../hooks/useAppData'
import { validateUploadForm } from '../../utils/validation'
import { formatFileSize, toDateInputValue, addMonths } from '../../utils/format'
import {
  DOCUMENT_TYPES,
  DOCUMENT_TYPE_OPTIONS,
  getDocumentTypeLabel,
} from '../../data'
import { findRequirementByType } from '../../utils/checklist'
import { MAX_UPLOAD_SIZE_BYTES, validateUploadFile } from '../../utils/validation'

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
  const isReplacement = Boolean(upload.prefill?.replacementTarget?.id)

  if (!upload.isOpen) return null

  const handleClose = () => {
    if (!upload.isSubmitting) closeUploadModal()
  }

  return (
    <Modal
      isOpen
      onClose={handleClose}
      title={isReplacement ? 'Replace document' : 'Upload a document'}
      description={
        isReplacement
          ? 'Choose a replacement file. The existing document and checklist links will be preserved.'
          : 'Add a file to your library. We will link it to the checklist item it satisfies.'
      }
      size="lg"
      closeOnOverlayClick={!upload.isSubmitting}
      closeOnEscape={!upload.isSubmitting}
      footer={<UploadFormFooter isReplacement={isReplacement} />}
    >
      <UploadForm prefill={upload.prefill} />
    </Modal>
  )
}

function UploadFormFooter({ isReplacement }) {
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
        disabled={isLoading || isSubmitting}
      >
        {isSubmitting
          ? isReplacement ? 'Replacing' : 'Uploading'
          : isReplacement ? 'Replace file' : 'Upload document'}
      </Button>
    </>
  )
}

function UploadForm({ prefill }) {
  const { upload, submitUpload, replaceDocument, closeUploadModal, applicationViews } = useAppData()
  const replacementTarget = prefill?.replacementTarget
  const isReplacement = Boolean(replacementTarget?.id)

  const [values, setValues] = useState(() => getInitialValues(prefill))
  const [errors, setErrors] = useState({})
  const [submissionError, setSubmissionError] = useState('')
  const isSubmittingRef = useRef(false)

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
    setSubmissionError('')
  }

  const handleFile = (file) => {
    if (!file) {
      setValues((current) => ({ ...current, file: null, fileName: '', fileSizeKb: 0 }))
      clearError('file')
      setSubmissionError('')
      return
    }

    const fileError = validateUploadFile(file)
    if (fileError) {
      setValues((current) => ({ ...current, file: null, fileName: '', fileSizeKb: 0 }))
      setErrors((current) => ({ ...current, file: fileError }))
      setSubmissionError('')
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
    setSubmissionError('')
  }

  const handleFileError = (message) => {
    setErrors((current) => ({ ...current, file: message }))
    setSubmissionError('')
  }

  const handleFileClear = () => {
    setValues((current) => ({ ...current, file: null, fileName: '', fileSizeKb: 0 }))
    clearError('file')
    setSubmissionError('')
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

    const fileError = isReplacement ? validateUploadFile(values.file) : null
    const validationErrors = isReplacement
      ? (fileError ? { file: fileError } : {})
      : validateUploadForm(values)
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors)
      return
    }
    setErrors({})

    if (isSubmittingRef.current || isSubmitting) return

    isSubmittingRef.current = true
    setSubmissionError('')
    try {
      if (isReplacement) {
        await replaceDocument(replacementTarget.id, values.file)
        closeUploadModal()
      } else {
        await submitUpload(values)
      }
    } catch (error) {
      if (isReplacement) {
        if (error instanceof TypeError) {
          setSubmissionError('Could not replace this file. Please check your connection and try again.')
        } else if (error?.status === 400) {
          setSubmissionError('Please check the selected file and try again.')
        } else if (error?.status === 401) {
          setSubmissionError('Your session has expired. Please sign in again.')
        } else if (error?.status === 403) {
          setSubmissionError('You do not have permission to replace this file.')
        } else if (error?.status === 404) {
          setSubmissionError('This document is no longer available.')
        } else if (error?.status === 413) {
          setSubmissionError('The selected file is too large. Maximum size is 5 MiB.')
        } else {
          setSubmissionError('Could not replace this file. Please try again.')
        }
      } else if (error instanceof TypeError) {
        setSubmissionError('We could not reach the server. Check your connection and retry.')
      } else if (error?.status === 400) {
        const details = Array.isArray(error.details)
          ? error.details.filter(
              (detail) =>
                typeof detail === 'string'
                && detail.trim()
                && !/(?:stack|traceback|filesystem|storage key|database|sql|internal|exception| at .+:\d+)/i.test(detail)
                && !/(?:[A-Z]:\\|\/(?:home|var|tmp|etc|srv|mnt|opt)\/)/i.test(detail),
            )
          : []
        setSubmissionError(
          details.length > 0
            ? `Please check the document information and try again. ${details.join(' ')}`
            : 'Please check the document information and file, then try again.',
        )
      } else if (error?.status === 413) {
        setSubmissionError('The file is too large. Please choose a file no larger than 5 MiB.')
      } else if (error?.status === 401) {
        setSubmissionError('Your session has expired. Please sign in again and try again.')
      } else if (error?.status === 403) {
        setSubmissionError('You do not have permission to upload this document.')
      } else if (error?.status === 404) {
        setSubmissionError('The selected application could not be found. Please refresh and try again.')
      } else {
        setSubmissionError('Something went wrong while uploading the document. Please try again.')
      }
    } finally {
      isSubmittingRef.current = false
    }
  }

  return (
    <form id="upload-document-form" className="upload-form" onSubmit={handleSubmit} noValidate>
      <Dropzone
        file={
          values.fileName ? { name: values.fileName, meta: formatFileSize(values.fileSizeKb) } : null
        }
        onFileSelect={handleFile}
        onFileClear={handleFileClear}
        onFileError={handleFileError}
        formats="PDF, JPG, JPEG, PNG"
        accept=".pdf,.jpg,.jpeg,.png"
        maxSizeMiB={MAX_UPLOAD_SIZE_BYTES / (1024 * 1024)}
        disabled={isSubmitting}
      />

      {errors.file ? (
        <Alert
          tone="danger"
          title={values.file ? 'File not accepted' : 'Choose a file'}
          description={errors.file}
        />
      ) : null}
      {submissionError ? (
        <Alert
          tone="danger"
          title={isReplacement ? 'Replacement could not be completed' : 'Upload could not be completed'}
          description={`${submissionError} Your file${isReplacement ? '' : ' and entered details'} have been kept so you can retry.`}
        />
      ) : null}

      {isReplacement ? (
        <Alert
          tone="info"
          title={`Replacing ${replacementTarget.name}`}
          description={[
            replacementTarget.fileName,
            replacementTarget.typeLabel ?? replacementTarget.documentType,
            replacementTarget.applicationName,
          ].filter(Boolean).join(' · ')}
        />
      ) : (
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
      )}

      {!isReplacement ? (
        <>
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
        </>
      ) : null}
    </form>
  )
}
