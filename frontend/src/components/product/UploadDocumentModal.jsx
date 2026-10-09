import { useMemo, useRef, useState } from 'react'
import { CalendarClock, Info, Link2, Sparkles } from 'lucide-react'
import { Alert, Button, Dropzone, Input, Modal, Select } from '../ui'
import { useAppData } from '../../hooks/useAppData'
import {
  MAX_UPLOAD_SIZE_BYTES,
  validateUploadFile,
  validateUploadForm,
} from '../../utils/validation'
import {
  addMonths,
  formatDate,
  formatFileSize,
  toLocalDateInputValue,
} from '../../utils/format'
import {
  DOCUMENT_TYPES,
  DOCUMENT_TYPE_OPTIONS,
  getDocumentTypeLabel,
} from '../../data'
import { findRequirementByType, getDocumentApplicationIds } from '../../utils/checklist'

const MIN_EXPIRY_DATE = toLocalDateInputValue(new Date())

function getInitialValues(prefill) {
  return {
    name: prefill?.name ?? '',
    documentType: prefill?.documentType ?? '',
    applicationId: prefill?.applicationId ?? '',
    requirementKey: prefill?.requirementKey ?? '',
    file: null,
    fileName: '',
    fileSizeKb: 0,
    expiryDate: '',
    note: '',
  }
}

export function UploadDocumentModal() {
  const { upload } = useAppData()

  if (!upload.isOpen) return null

  return <UploadModalContent upload={upload} />
}

function UploadModalContent({ upload }) {
  const { closeUploadModal, error, isLoading, retryHydration } = useAppData()
  const [mode, setMode] = useState('upload')
  const [isReuseSubmitting, setIsReuseSubmitting] = useState(false)
  const isReplacement = Boolean(upload.prefill?.replacementTarget?.id)
  const isBusy = upload.isSubmitting || isReuseSubmitting
  const isReuseBlocked = mode === 'existing' && Boolean(error)

  const handleClose = () => {
    if (!isBusy) closeUploadModal()
  }

  return (
    <Modal
      isOpen
      onClose={handleClose}
      title={isReplacement ? 'Replace document' : 'Upload a document'}
      description={
        isReplacement
          ? 'Choose a replacement file. The existing document and checklist links will be preserved.'
          : 'Upload a new file or reuse a document already in your library.'
      }
      size="lg"
      closeOnOverlayClick={!isBusy}
      closeOnEscape={!isBusy}
      footer={(
        <UploadFormFooter
          isReplacement={isReplacement}
          mode={mode}
          isBusy={isBusy}
          isLoading={isLoading || isReuseBlocked}
          onCancel={handleClose}
        />
      )}
    >
      <UploadForm
        key={JSON.stringify([
          upload.prefill?.applicationId ?? '',
          upload.prefill?.requirementKey ?? '',
          upload.prefill?.documentType ?? '',
          upload.prefill?.replacementTarget?.id ?? '',
        ])}
        prefill={upload.prefill}
        mode={mode}
        setMode={setMode}
        isReuseSubmitting={isReuseSubmitting}
        setIsReuseSubmitting={setIsReuseSubmitting}
        error={error}
        retryHydration={retryHydration}
      />
    </Modal>
  )
}

function UploadFormFooter({ isReplacement, mode, isBusy, isLoading, onCancel }) {
  return (
    <>
      <Button variant="ghost" size="md" onClick={onCancel} disabled={isBusy}>
        Cancel
      </Button>
      <Button
        type="submit"
        variant="primary"
        size="md"
        form="upload-document-form"
        isLoading={isBusy}
        disabled={isLoading || isBusy}
      >
        {isBusy
          ? isReplacement ? 'Replacing' : mode === 'existing' ? 'Linking' : 'Uploading'
          : isReplacement ? 'Replace file' : mode === 'existing' ? 'Use selected document' : 'Upload document'}
      </Button>
    </>
  )
}

function UploadForm({
  prefill,
  mode,
  setMode,
  isReuseSubmitting,
  setIsReuseSubmitting,
  error,
  retryHydration,
}) {
  const {
    upload,
    submitUpload,
    replaceDocument,
    closeUploadModal,
    applicationViews,
    documentViews,
    isLoading,
    associateDocumentWithApplication,
    associateDocumentAndLinkRequirement,
    setRequirementStatus,
    showToast,
  } = useAppData()
  const replacementTarget = prefill?.replacementTarget
  const isReplacement = Boolean(replacementTarget?.id)
  const isChecklistContext = Boolean(prefill?.applicationId && prefill?.requirementKey)

  const [values, setValues] = useState(() => getInitialValues(prefill))
  const [errors, setErrors] = useState({})
  const [submissionError, setSubmissionError] = useState('')
  const [selectedDocumentId, setSelectedDocumentId] = useState('')
  const [associationComplete, setAssociationComplete] = useState(null)
  const isSubmittingRef = useRef(false)

  const isSubmitting = upload.isSubmitting
  const isBusy = isSubmitting || isReuseSubmitting
  const isReuseMode = !isReplacement && mode === 'existing'

  const applicationOptions = useMemo(
    () =>
      applicationViews.map((application) => ({
        value: application.id,
        label: `${application.name} · ${application.progress}% complete`,
      })),
    [applicationViews],
  )

  const eligibleDocuments = useMemo(() => {
    if (!values.applicationId) return []

    const targetRequirement = isChecklistContext
      ? applicationViews
        .find((application) => application.id === values.applicationId)
        ?.requirements.find((requirement) => requirement.key === prefill.requirementKey)
      : null
    return [...new Map(documentViews.map((document) => [document.id, document])).values()]
      .filter((document) => {
        const matchesRequirement = !isChecklistContext
          || document.documentType === prefill.documentType
        const alreadyAssociated = getDocumentApplicationIds(document).includes(values.applicationId)
        const canRetryRequirementLink = Boolean(
          isChecklistContext
          && targetRequirement
          && targetRequirement.type === document.documentType
          && targetRequirement.documentId !== document.id,
        )
        return matchesRequirement
          && Boolean(document.id)
          && (!alreadyAssociated || canRetryRequirementLink)
      })
  }, [
    applicationViews,
    documentViews,
    isChecklistContext,
    prefill,
    values.applicationId,
  ])

  const eligibleDocumentOptions = useMemo(
    () =>
      eligibleDocuments.map((document) => ({
        value: document.id,
        label: [
          document.name,
          document.typeLabel ?? getDocumentTypeLabel(document.documentType),
          document.fileName,
          document.expiresAt ? `Expires ${formatDate(document.expiresAt)}` : 'No expiry date',
          document.applicationName !== 'Not linked' ? document.applicationName : null,
        ].filter(Boolean).join(' · '),
      })),
    [eligibleDocuments],
  )

  const matchedRequirement = useMemo(() => {
    if (!values.applicationId || !values.documentType) return null

    const application = applicationViews.find((entry) => entry.id === values.applicationId)
    if (!application) return null

    if (values.requirementKey) {
      return application.requirements.find(
        (requirement) =>
          requirement.key === values.requirementKey
          && requirement.type === values.documentType,
      ) ?? null
    }

    return findRequirementByType(application.requirements, values.documentType)
  }, [applicationViews, values.applicationId, values.documentType, values.requirementKey])

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
      requirementKey: '',
      expiryDate: months ? toLocalDateInputValue(addMonths(new Date(), months)) : '',
    }))

    clearError('documentType')
  }

  const handleApplicationChange = (applicationId) => {
    setValues((current) => ({ ...current, applicationId, requirementKey: '' }))
    setSelectedDocumentId('')
    setAssociationComplete(null)
    clearError('applicationId')
    setSubmissionError('')
  }

  const handleModeChange = (nextMode) => {
    if (isBusy || associationComplete) return
    if (nextMode === 'existing' && isChecklistContext) {
      setValues((current) => ({
        ...current,
        applicationId: prefill.applicationId,
        documentType: prefill.documentType,
        requirementKey: prefill.requirementKey,
      }))
      setSelectedDocumentId('')
    }
    setMode(nextMode)
    setSubmissionError('')
  }

  const handleDocumentChange = (documentId) => {
    setSelectedDocumentId(documentId)
    setAssociationComplete(null)
    setSubmissionError('')
  }

  const handleReuseSubmit = async () => {
    const selectedDocument = eligibleDocuments.find((document) => document.id === selectedDocumentId)
    if (selectedDocumentId && !selectedDocument) {
      setSelectedDocumentId('')
      setAssociationComplete(null)
      setSubmissionError(
        'That document is no longer eligible for this application or checklist item. Choose an eligible document and try again.',
      )
      return
    }

    if (!values.applicationId || !selectedDocument) {
      setSubmissionError('Choose an application and an eligible document to continue.')
      return
    }

    if (isSubmittingRef.current || isBusy) return
    isSubmittingRef.current = true
    setIsReuseSubmitting(true)
    setSubmissionError('')

    const hasPendingAssociation = associationComplete?.documentId === selectedDocument.id
      && associationComplete.applicationId === values.applicationId
    const alreadyAssociated = getDocumentApplicationIds(selectedDocument).includes(values.applicationId)
    let associationSucceeded = hasPendingAssociation || alreadyAssociated
    if (isChecklistContext && alreadyAssociated && !hasPendingAssociation) {
      setAssociationComplete({
        documentId: selectedDocument.id,
        applicationId: values.applicationId,
      })
    }
    try {
      if (!hasPendingAssociation && !alreadyAssociated) {
        if (isChecklistContext) {
          const result = await associateDocumentAndLinkRequirement(
            selectedDocument.id,
            values.applicationId,
            prefill.requirementKey,
          )
          if (!result) return

          setAssociationComplete({
            documentId: selectedDocument.id,
            applicationId: values.applicationId,
          })
          associationSucceeded = true
          if (!result.linked) {
            setSubmissionError(
              `${selectedDocument.name} is attached to this application, but the checklist link was not confirmed. ${result.error?.message ?? 'Retry the checklist link without uploading or attaching the document again.'}`,
            )
            return
          }

          showToast(`${selectedDocument.name} attached and linked to the checklist.`)
          closeUploadModal()
          return
        }

        const associated = await associateDocumentWithApplication(
          selectedDocument.id,
          values.applicationId,
          { suppressErrorToast: true },
        )
        if (associated !== true) return
        associationSucceeded = true
      }

      if (isChecklistContext) {
        const linked = await setRequirementStatus(
          values.applicationId,
          prefill.requirementKey,
          'completed',
          selectedDocument.id,
          { suppressErrorToast: true, requireConfirmedResponse: true },
        )
        if (linked !== true) return
        showToast(`${selectedDocument.name} attached and linked to the checklist.`)
      }

      closeUploadModal()
    } catch (error) {
      if (associationSucceeded && isChecklistContext) {
        setSubmissionError(
          `${selectedDocument.name} is attached to this application, but the checklist link was not saved. Retry the checklist link without uploading or attaching the document again.`,
        )
      } else if (error instanceof TypeError) {
        setSubmissionError('We could not reach the server. Check your connection and try again.')
      } else if (error?.status === 401) {
        setSubmissionError('Your session has expired. Please sign in again.')
      } else if (error?.status === 404) {
        setSubmissionError('The document or application is no longer available. Refresh and try again.')
      } else if (error?.status === 409) {
        setSubmissionError('This document cannot be attached right now. Refresh your documents and try again.')
      } else if (error instanceof Error) {
        setSubmissionError(error.message)
      } else {
        setSubmissionError('We could not attach this document. Please try again.')
      }
    } finally {
      isSubmittingRef.current = false
      setIsReuseSubmitting(false)
    }
  }

  const handleSubmit = async (event) => {
    event.preventDefault()

    if (isReuseMode) {
      await handleReuseSubmit()
      return
    }

    const fileError = isReplacement ? validateUploadFile(values.file) : null
    const validationErrors = isReplacement
      ? (fileError ? { file: fileError } : {})
      : validateUploadForm(values)
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors)
      return
    }
    setErrors({})

    if (isSubmittingRef.current || isBusy) return

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
      {!isReplacement ? (
        <div
          className="upload-form__mode-choice"
          role="group"
          aria-label="Choose how to add a document"
        >
          <Button
            type="button"
            variant={mode === 'upload' ? 'primary' : 'outline'}
            size="sm"
            aria-pressed={mode === 'upload'}
            disabled={isBusy || Boolean(associationComplete)}
            onClick={() => handleModeChange('upload')}
          >
            Upload new
          </Button>
          <Button
            type="button"
            variant={mode === 'existing' ? 'primary' : 'outline'}
            size="sm"
            aria-pressed={mode === 'existing'}
            disabled={isBusy || Boolean(associationComplete)}
            onClick={() => handleModeChange('existing')}
          >
            Use existing
          </Button>
        </div>
      ) : null}

      {submissionError ? (
        <Alert
          tone="danger"
          title={
            isReplacement
              ? 'Replacement could not be completed'
              : isReuseMode && associationComplete
                ? 'Document attached, checklist link pending'
                : isReuseMode
                  ? 'Document could not be attached'
                  : 'Upload could not be completed'
          }
          description={
            isReuseMode
              ? submissionError
              : `${submissionError} Your file${isReplacement ? '' : ' and entered details'} have been kept so you can retry.`
          }
          action={
            isReuseMode && associationComplete && isChecklistContext ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isBusy}
                onClick={handleReuseSubmit}
              >
                Retry checklist link
              </Button>
            ) : undefined
          }
        />
      ) : null}

      {isReuseMode ? (
        <>
          {isChecklistContext ? (
            <Alert
              tone="info"
              title={`Checklist item: ${prefill.name}`}
              description={`The selected document must be a ${getDocumentTypeLabel(prefill.documentType).toLowerCase()}. It will be linked to this exact checklist item.`}
            />
          ) : (
            <Select
              label="Destination application"
              required
              value={values.applicationId}
              placeholder="Select an application"
              onChange={(event) => handleApplicationChange(event.target.value)}
              disabled={isLoading || Boolean(error) || isBusy || Boolean(associationComplete)}
              options={applicationOptions}
            />
          )}

          {isChecklistContext ? (
            <Alert
              tone="info"
              title="Destination application"
              description={applicationViews.find((application) => application.id === values.applicationId)?.name ?? 'The selected application'}
            />
          ) : null}

          {isLoading ? (
            <Alert
              tone="info"
              title="Loading documents"
              description="Please wait while your document library is loaded."
            />
          ) : error ? (
            <Alert
              tone="danger"
              title="Documents could not be loaded"
              description={error}
              action={(
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={isBusy}
                  onClick={retryHydration}
                >
                  Retry loading
                </Button>
              )}
            />
          ) : !values.applicationId ? (
            <Alert
              tone="info"
              title="Choose an application"
              description="Select the application where this existing document should be available."
            />
          ) : eligibleDocuments.length === 0 ? (
            <Alert
              tone="info"
              title="No eligible documents"
              description="There are no matching documents available to attach. Upload a new document, or choose another application."
            />
          ) : (
            <Select
              label="Existing document"
              required
              value={selectedDocumentId}
              placeholder="Select a document"
              onChange={(event) => handleDocumentChange(event.target.value)}
              disabled={isLoading || isBusy || Boolean(associationComplete)}
              options={eligibleDocumentOptions}
            />
          )}

          {selectedDocumentId ? (() => {
            const selectedDocument = documentViews.find((document) => document.id === selectedDocumentId)
            if (!selectedDocument) return null
            return (
              <Alert
                tone="info"
                title={selectedDocument.name}
                description={[
                  selectedDocument.fileName,
                  selectedDocument.typeLabel ?? getDocumentTypeLabel(selectedDocument.documentType),
                  selectedDocument.statusLabel,
                  selectedDocument.expiresAt
                    ? `Expires ${formatDate(selectedDocument.expiresAt)}`
                    : 'No expiry date',
                  selectedDocument.applicationName !== 'Not linked'
                    ? `Already linked to: ${selectedDocument.applicationName}`
                    : null,
                ].filter(Boolean).join(' · ')}
              />
            )
          })() : null}
        </>
      ) : (
        <>
          {errors.file ? (
            <Alert
              tone="danger"
              title={values.file ? 'File not accepted' : 'Choose a file'}
              description={errors.file}
            />
          ) : null}

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
            disabled={isBusy}
          />

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
          onChange={(event) => handleApplicationChange(event.target.value)}
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
        </>
      )}
    </form>
  )
}
