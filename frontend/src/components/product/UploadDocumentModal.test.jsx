import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { UploadDocumentModal } from './UploadDocumentModal'

const uploadHarness = vi.hoisted(() => ({
  context: {},
}))

vi.mock('../../hooks/useAppData', () => ({
  useAppData: () => uploadHarness.context,
}))

const application = {
  id: 'application-one',
  name: 'Passport Application',
  progress: 10,
  requirements: [{ key: 'identity-card', name: 'Ghana Card', type: 'identity-card' }],
}
const reusableDocument = {
  id: 'document-one',
  name: 'Identity document',
  documentType: 'identity-card',
  typeLabel: 'Identity card',
  fileName: 'identity.pdf',
  expiresAt: null,
  applicationName: 'Not linked',
  applicationIds: [],
  statusLabel: 'Valid',
}

function setup(overrides = {}) {
  uploadHarness.context = {
    upload: {
      isOpen: true,
      isSubmitting: false,
      prefill: {
        applicationId: application.id,
        requirementKey: 'identity-card',
        documentType: 'identity-card',
        name: 'Ghana Card',
      },
    },
    closeUploadModal: vi.fn(),
    error: null,
    isLoading: false,
    retryHydration: vi.fn(),
    submitUpload: vi.fn().mockResolvedValue({ id: 'uploaded-document' }),
    replaceDocument: vi.fn().mockResolvedValue({ id: 'document-one' }),
    applicationViews: [application],
    documentViews: [reusableDocument],
    associateDocumentWithApplication: vi.fn().mockResolvedValue(true),
    associateDocumentAndLinkRequirement: vi.fn(),
    setRequirementStatus: vi.fn().mockResolvedValue(true),
    showToast: vi.fn(),
    ...overrides,
  }
  return render(<UploadDocumentModal />)
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('UploadDocumentModal', () => {
  it('uploads a valid document and closes only after the provider succeeds', async () => {
    setup({
      upload: { isOpen: true, isSubmitting: false, prefill: null },
      submitUpload: vi.fn().mockResolvedValue({ id: 'uploaded-document' }),
    })
    fireEvent.change(document.body.querySelector('input[type="file"]'), {
      target: { files: [new File(['identity'], 'identity.pdf', { type: 'application/pdf' })] },
    })
    fireEvent.change(screen.getByLabelText(/^Document type/), {
      target: { value: 'identity-card' },
    })
    fireEvent.change(screen.getByLabelText(/^Associated application/), {
      target: { value: application.id },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Upload document' }))

    await waitFor(() => expect(uploadHarness.context.submitUpload).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'identity',
        documentType: 'identity-card',
        applicationId: application.id,
      }),
    ))
  })

  it('replaces the selected file for the existing document', async () => {
    const replacementTarget = {
      ...reusableDocument,
      applicationName: 'Passport Application',
    }
    setup({
      upload: {
        isOpen: true,
        isSubmitting: false,
        prefill: { replacementTarget },
      },
    })
    const replacementFile = new File(['replacement'], 'replacement.pdf', {
      type: 'application/pdf',
    })
    fireEvent.change(document.body.querySelector('input[type="file"]'), {
      target: { files: [replacementFile] },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Replace file' }))

    await waitFor(() => expect(uploadHarness.context.replaceDocument)
      .toHaveBeenCalledWith('document-one', replacementFile))
    expect(uploadHarness.context.closeUploadModal).toHaveBeenCalledOnce()
  })

  it('does not duplicate association when retrying a failed checklist link', async () => {
    const associateDocumentAndLinkRequirement = vi.fn().mockResolvedValue({
      linked: false,
      error: new Error('Checklist link not confirmed'),
    })
    const setRequirementStatus = vi.fn().mockResolvedValue(true)
    setup({ associateDocumentAndLinkRequirement, setRequirementStatus })

    fireEvent.click(screen.getByRole('button', { name: 'Use existing' }))
    fireEvent.change(screen.getByLabelText(/^Existing document/), {
      target: { value: 'document-one' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Use selected document' }))

    expect(await screen.findByRole('button', { name: 'Retry checklist link' })).toBeTruthy()
    expect(associateDocumentAndLinkRequirement).toHaveBeenCalledWith(
      'document-one',
      'application-one',
      'identity-card',
    )
    expect(uploadHarness.context.closeUploadModal).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Retry checklist link' }))
    await waitFor(() => expect(setRequirementStatus).toHaveBeenCalledWith(
      'application-one',
      'identity-card',
      'completed',
      'document-one',
      { suppressErrorToast: true, requireConfirmedResponse: true },
    ))
    expect(associateDocumentAndLinkRequirement).toHaveBeenCalledOnce()
    expect(uploadHarness.context.closeUploadModal).toHaveBeenCalledOnce()
  })
})
