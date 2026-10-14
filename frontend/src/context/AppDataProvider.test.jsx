import { useContext } from 'react'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppDataProvider } from './AppDataProvider'
import { AppDataContext } from './AppDataContext'

const providerHarness = vi.hoisted(() => ({
  auth: {
    status: 'authenticated',
    user: { id: 'user-one', email: 'one@example.test' },
    updateUser: vi.fn(),
    signOut: vi.fn(),
  },
  services: {
    fetchApplications: vi.fn(),
    fetchDocuments: vi.fn(),
    fetchNotifications: vi.fn(),
    fetchProcesses: vi.fn(),
    isNotification: vi.fn(),
    addDocumentApplication: vi.fn(),
    readAllNotifications: vi.fn(),
    readNotification: vi.fn(),
    removeDocumentApplication: vi.fn(),
    removeDocumentRecord: vi.fn(),
    savePassword: vi.fn(),
    savePreferences: vi.fn(),
    saveProfile: vi.fn(),
    updateDocumentRecord: vi.fn(),
    uploadDocument: vi.fn(),
    replaceDocumentFile: vi.fn(),
    createApplicationRecord: vi.fn(),
    saveRequirementStatus: vi.fn(),
    submitApplication: vi.fn(),
    updateApplicationDecision: vi.fn(),
    hasPersistentAuthToken: vi.fn(),
    storeAuthToken: vi.fn(),
    askAssistantQuestion: vi.fn(),
  },
}))

vi.mock('./AuthProvider', () => ({
  useAuth: () => providerHarness.auth,
}))

vi.mock('../services', () => ({
  createId: vi.fn(() => 'toast-test-id'),
  ...providerHarness.services,
}))

vi.mock('../components/product/GlobalOverlays', () => ({
  GlobalOverlays: () => null,
}))

const application = {
  id: 'application-one',
  processId: 'passport',
  status: 'in-progress',
  readyToSubmit: false,
  requirements: [{
    key: 'identity-card',
    name: 'Ghana Card',
    type: 'identity-card',
    isRequired: true,
    status: 'missing',
    documentId: null,
    completedAt: null,
  }],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const notice = {
  id: 'notice-one',
  kind: 'document-expiry',
  title: 'Document expiring',
  body: 'Your document expires soon.',
  severity: 'warning',
  isRead: false,
  applicationId: null,
  documentId: 'document-one',
  dueDate: '2026-12-01T00:00:00.000Z',
  createdAt: '2026-11-01T00:00:00.000Z',
}

function renderProvider() {
  const provider = ({ children }) => (
    <AppDataProvider>{children}</AppDataProvider>
  )
  const result = renderHook(() => useContext(AppDataContext), { wrapper: provider })
  return { ...result, getContext: () => result.result.current }
}

async function waitForProviderReady(provider) {
  await waitFor(() => expect(provider.getContext().status).toBe('ready'))
}

beforeEach(() => {
  providerHarness.auth = {
    status: 'authenticated',
    user: { id: 'user-one', email: 'one@example.test' },
    updateUser: vi.fn(),
    signOut: vi.fn(),
  }
  Object.values(providerHarness.services).forEach((mock) => mock.mockReset())
  providerHarness.services.fetchProcesses.mockResolvedValue([])
  providerHarness.services.fetchApplications.mockResolvedValue([application])
  providerHarness.services.fetchDocuments.mockResolvedValue([])
  providerHarness.services.fetchNotifications.mockResolvedValue([])
  providerHarness.services.isNotification.mockImplementation((entry) => Boolean(entry?.id))
  providerHarness.services.hasPersistentAuthToken.mockReturnValue(false)
  providerHarness.services.storeAuthToken.mockReturnValue(true)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('AppDataProvider regression coverage', () => {
  it('creates an application and exposes the confirmed server record', async () => {
    const created = { ...application, id: 'application-two', status: 'in-progress' }
    providerHarness.services.createApplicationRecord.mockResolvedValue(created)
    const provider = renderProvider()
    await waitForProviderReady(provider)

    let result
    await act(async () => {
      result = await provider.getContext().startApplication('passport')
    })

    expect(providerHarness.services.createApplicationRecord).toHaveBeenCalledWith({
      processId: 'passport',
    })
    expect(result).toEqual(created)
    expect(provider.getContext().applications).toContainEqual(created)
  })

  it('persists checklist status and preserves state after a failed update', async () => {
    const provider = renderProvider()
    await waitForProviderReady(provider)
    providerHarness.services.saveRequirementStatus.mockResolvedValueOnce({
      requirement: { key: 'identity-card', status: 'completed', documentId: null },
    }).mockRejectedValueOnce(new TypeError('offline'))

    await act(async () => {
      await provider.getContext().setRequirementStatus(
        'application-one',
        'identity-card',
        'completed',
      )
    })
    expect(provider.getContext().getApplicationById('application-one')
      .requirements.find((entry) => entry.key === 'identity-card').status).toBe('completed')

    await act(async () => {
      await expect(provider.getContext().setRequirementStatus(
        'application-one',
        'identity-card',
        'missing',
      )).rejects.toThrow('offline')
    })
    expect(provider.getContext().getApplicationById('application-one')
      .requirements.find((entry) => entry.key === 'identity-card').status).toBe('completed')
    expect(provider.getContext().toast).toMatchObject({
      message: 'offline',
      tone: 'warning',
    })
  })

  it('submits ready applications and records the server outcome', async () => {
    providerHarness.services.fetchApplications.mockResolvedValueOnce([
      { ...application, readyToSubmit: true },
    ])
    providerHarness.services.submitApplication.mockResolvedValue({
      ...application,
      status: 'submitted',
      outcome: 'pending',
      submittedAt: '2026-11-01T00:00:00.000Z',
    })
    providerHarness.services.updateApplicationDecision.mockResolvedValue({
      ...application,
      status: 'completed',
      outcome: 'accepted',
      decisionRecordedAt: '2026-11-02T00:00:00.000Z',
    })
    const provider = renderProvider()
    await waitForProviderReady(provider)

    await act(async () => provider.getContext().submitApplication('application-one'))
    expect(provider.getContext().getApplicationById('application-one')).toMatchObject({
      status: 'submitted',
      outcome: 'pending',
    })
    await act(async () => provider.getContext().updateApplicationDecision(
      'application-one',
      'accepted',
    ))
    expect(provider.getContext().getApplicationById('application-one')).toMatchObject({
      status: 'completed',
      outcome: 'accepted',
    })
  })

  it('does not mutate application state when submission fails', async () => {
    providerHarness.services.fetchApplications.mockResolvedValueOnce([
      { ...application, readyToSubmit: true },
    ])
    providerHarness.services.submitApplication.mockRejectedValue(new Error('Submission unavailable'))
    const provider = renderProvider()
    await waitForProviderReady(provider)

    await act(async () => {
      await expect(provider.getContext().submitApplication('application-one'))
        .rejects.toThrow('Submission unavailable')
    })
    expect(provider.getContext().getApplicationById('application-one').status).toBe('in-progress')
    expect(provider.getContext().toast).toMatchObject({
      message: 'Submission unavailable',
      tone: 'warning',
    })
  })

  it('keeps an uploaded document when its separate checklist-link request fails', async () => {
    const uploaded = {
      id: 'document-one',
      name: 'Identity document',
      documentType: 'identity-card',
      fileName: 'identity.pdf',
      applicationId: 'application-one',
      applicationIds: ['application-one'],
      uploadedAt: '2026-11-01T00:00:00.000Z',
      expiresAt: null,
    }
    providerHarness.services.uploadDocument.mockResolvedValue(uploaded)
    providerHarness.services.saveRequirementStatus.mockRejectedValue(new TypeError('offline'))
    const provider = renderProvider()
    await waitForProviderReady(provider)

    await act(async () => {
      await expect(provider.getContext().submitUpload({
        file: new File(['content'], 'identity.pdf', { type: 'application/pdf' }),
        name: uploaded.name,
        documentType: uploaded.documentType,
        applicationId: 'application-one',
      })).rejects.toThrow('offline')
    })

    expect(provider.getContext().documents).toContainEqual(uploaded)
    expect(provider.getContext().getApplicationById('application-one')
      .requirements.find((entry) => entry.key === 'identity-card').status).toBe('missing')
    expect(provider.getContext().toast.message).toContain('was uploaded, but its checklist link could not be saved')
  })

  it('adds a document and completes its matching checklist requirement after confirmation', async () => {
    const uploaded = {
      id: 'document-one',
      name: 'Identity document',
      documentType: 'identity-card',
      fileName: 'identity.pdf',
      applicationId: 'application-one',
      applicationIds: ['application-one'],
      uploadedAt: '2026-11-01T00:00:00.000Z',
      expiresAt: null,
    }
    providerHarness.services.uploadDocument.mockResolvedValue(uploaded)
    providerHarness.services.saveRequirementStatus.mockResolvedValue({
      requirement: {
        key: 'identity-card',
        status: 'completed',
        documentId: 'document-one',
        completedAt: uploaded.uploadedAt,
      },
    })
    const provider = renderProvider()
    await waitForProviderReady(provider)

    await act(async () => provider.getContext().submitUpload({
      file: new File(['content'], 'identity.pdf', { type: 'application/pdf' }),
      name: uploaded.name,
      documentType: uploaded.documentType,
      applicationId: 'application-one',
    }))

    expect(provider.getContext().documents).toContainEqual(uploaded)
    expect(provider.getContext().getApplicationById('application-one')
      .requirements.find((entry) => entry.key === 'identity-card')).toMatchObject({
      status: 'completed',
      documentId: 'document-one',
    })
    expect(provider.getContext().upload.isOpen).toBe(false)
  })

  it('refreshes and retries notifications, then applies read-all state', async () => {
    providerHarness.services.fetchNotifications
      .mockRejectedValueOnce(new TypeError('offline'))
      .mockResolvedValueOnce([notice])
      .mockResolvedValueOnce([{ ...notice, isRead: true }])
    providerHarness.services.readAllNotifications.mockResolvedValue(1)
    const provider = renderProvider()
    await waitFor(() => expect(provider.getContext().notificationsStatus).toBe('error'))
    expect(provider.getContext().notificationsError).toBe(
      'We could not load notifications. Please try again.',
    )

    act(() => provider.getContext().retryNotifications())
    await waitFor(() => expect(provider.getContext().notificationsStatus).toBe('ready'))
    expect(provider.getContext().notificationViews).toHaveLength(1)

    await act(async () => provider.getContext().markAllNotificationsRead())
    await waitFor(() => expect(provider.getContext().notificationViews[0].isRead).toBe(true))
    expect(providerHarness.services.readAllNotifications).toHaveBeenCalledOnce()
  })

  it('marks one notification read and refreshes the updated server state', async () => {
    providerHarness.services.fetchNotifications
      .mockResolvedValueOnce([notice])
      .mockResolvedValueOnce([{ ...notice, isRead: true }])
    providerHarness.services.readNotification.mockResolvedValue({
      ...notice,
      isRead: true,
    })
    const provider = renderProvider()
    await waitFor(() => {
      expect(provider.getContext().notificationsStatus).toBe('ready')
      expect(provider.getContext().notificationViews).toHaveLength(1)
    })

    await act(async () => provider.getContext().markNotificationRead('notice-one'))

    expect(providerHarness.services.readNotification).toHaveBeenCalledWith('notice-one')
    await waitFor(() => expect(provider.getContext().notificationViews[0].isRead).toBe(true))
  })

  it('refreshes reminders when a document expiry date changes and recovers document deletion state', async () => {
    const document = {
      id: 'document-one',
      name: 'Identity document',
      documentType: 'identity-card',
      fileName: 'identity.pdf',
      applicationId: null,
      applicationIds: [],
      uploadedAt: '2026-11-01T00:00:00.000Z',
      expiresAt: null,
    }
    providerHarness.services.fetchDocuments.mockResolvedValueOnce([document])
    providerHarness.services.updateDocumentRecord.mockResolvedValue({
      ...document,
      expiresAt: '2027-01-01T00:00:00.000Z',
    })
    providerHarness.services.removeDocumentRecord.mockRejectedValueOnce(
      new Error('Delete failed'),
    ).mockResolvedValueOnce({})
    const provider = renderProvider()
    await waitForProviderReady(provider)

    await act(async () => provider.getContext().updateDocument(
      'document-one',
      { expiresAt: '2027-01-01T00:00:00.000Z' },
      'Expiry updated.',
    ))
    await waitFor(() => expect(providerHarness.services.fetchNotifications).toHaveBeenCalledTimes(2))
    expect(provider.getContext().getDocumentById('document-one').expiresAt)
      .toContain('2027-01-01')

    await act(async () => {
      await expect(provider.getContext().removeDocument('document-one')).rejects.toThrow('Delete failed')
    })
    expect(provider.getContext().documents).toHaveLength(1)
    await act(async () => provider.getContext().removeDocument('document-one'))
    expect(provider.getContext().documents).toHaveLength(0)
  })
})
