import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DocumentsPage } from './DocumentsPage'

const documentsHarness = vi.hoisted(() => ({
  context: {},
}))

vi.mock('../hooks/useAppData', () => ({
  useAppData: () => documentsHarness.context,
}))

vi.mock('../layouts/AppLayout', () => ({
  AppLayout: ({ actions, children }) => (
    <div>
      <header>{actions}</header>
      <main>{children}</main>
    </div>
  ),
}))

vi.mock('../components/product', () => ({
  DocumentList: ({ documents, onRename, onRefreshExpiry, onDetachApplication, onRemove }) => {
    const document = documents[0]
    if (!document) return null
    return (
      <div>
        <span>{document.name}</span>
        <button onClick={() => onRename(document)}>Rename document</button>
        <button onClick={() => onRefreshExpiry(document)}>Update expiry</button>
        <button onClick={() => onDetachApplication(document, document.linkedApplications[0])}>
          Detach document
        </button>
        <button onClick={() => onRemove(document)}>Delete document</button>
      </div>
    )
  },
  StatCard: ({ label, value }) => <div>{label}: {value}</div>,
}))

const application = { id: 'application-one', name: 'Passport Application' }
const document = {
  id: 'document-one',
  name: 'Identity document',
  documentType: 'identity-card',
  fileName: 'identity.pdf',
  expiryState: 'none',
  expiresAt: null,
  linkedApplications: [application],
  applicationName: application.name,
  isExpiring: false,
  isExpired: false,
}

function setup(overrides = {}) {
  documentsHarness.context = {
    documentViews: [document],
    applicationViews: [application],
    openUploadModal: vi.fn(),
    openDocumentPreview: vi.fn(),
    updateDocument: vi.fn().mockResolvedValue(true),
    detachDocumentFromApplication: vi.fn().mockResolvedValue(undefined),
    removeDocument: vi.fn().mockResolvedValue(true),
    ...overrides,
  }
  return render(<DocumentsPage />)
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('DocumentsPage', () => {
  it('saves a renamed document through the provider', async () => {
    setup()

    fireEvent.click(screen.getByRole('button', { name: 'Rename document' }))
    fireEvent.change(screen.getByLabelText('Document name'), {
      target: { value: 'Updated identity' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save name' }))

    await waitFor(() => expect(documentsHarness.context.updateDocument).toHaveBeenCalledWith(
      'document-one',
      { name: 'Updated identity' },
      'Renamed to Updated identity.',
    ))
  })

  it('saves a changed expiry date through the provider', async () => {
    setup()

    fireEvent.click(screen.getByRole('button', { name: 'Update expiry' }))
    fireEvent.change(screen.getByLabelText('Expiry date'), {
      target: { value: '2027-01-01' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save expiry date' }))

    await waitFor(() => expect(documentsHarness.context.updateDocument).toHaveBeenCalledWith(
      'document-one',
      { expiresAt: expect.stringMatching(/^2027-01-01T/) },
      'Expiry date updated. Reminders rescheduled.',
    ))
  })

  it('keeps the detach confirmation open after a provider failure and allows retry', async () => {
    documentsHarness.context = {
      documentViews: [document],
      applicationViews: [application],
      openUploadModal: vi.fn(),
      openDocumentPreview: vi.fn(),
      updateDocument: vi.fn().mockResolvedValue(true),
      detachDocumentFromApplication: vi.fn()
        .mockRejectedValueOnce(new Error('Conflict'))
        .mockResolvedValueOnce(undefined),
      removeDocument: vi.fn().mockResolvedValue(true),
    }
    render(<DocumentsPage />)

    fireEvent.click(screen.getByRole('button', { name: 'Detach document' }))
    fireEvent.click(screen.getByRole('button', { name: 'Detach from application' }))
    await waitFor(() => expect(documentsHarness.context.detachDocumentFromApplication)
      .toHaveBeenCalledTimes(1))
    expect(screen.getByRole('heading', { name: 'Detach document from application?' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Detach from application' }))
    await waitFor(() => expect(documentsHarness.context.detachDocumentFromApplication)
      .toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.queryByRole('heading', {
      name: 'Detach document from application?',
    })).toBeNull())
  })

  it('confirms deletion and closes the prompt only after provider success', async () => {
    setup()

    fireEvent.click(screen.getByRole('button', { name: 'Delete document' }))
    const dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete document' }))

    await waitFor(() => expect(documentsHarness.context.removeDocument)
      .toHaveBeenCalledWith('document-one'))
  })
})
