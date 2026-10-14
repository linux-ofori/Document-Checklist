import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApplicationDetailPage } from './ApplicationDetailPage'

const applicationPageHarness = vi.hoisted(() => ({
  context: {},
  navigate: vi.fn(),
}))

vi.mock('../hooks/useAppData', () => ({
  useAppData: () => applicationPageHarness.context,
}))

vi.mock('../hooks/useActiveRoute', () => ({
  useActiveRoute: () => ({ navigate: applicationPageHarness.navigate }),
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
  ChecklistItem: ({ requirement, onSetStatus }) => (
    <li>
      <span>{requirement.name}</span>
      <button onClick={() => onSetStatus(requirement, 'completed')}>
        Complete {requirement.name}
      </button>
    </li>
  ),
  ProcessIcon: () => <span aria-hidden="true" />,
  DocumentList: () => null,
  StatCard: () => null,
}))

const requiredItem = {
  key: 'identity-card',
  name: 'Ghana Card',
  type: 'identity-card',
  isRequired: true,
  status: 'missing',
  documentId: null,
  completedAt: null,
}

const baseApplication = {
  id: 'application-one',
  name: 'Passport Application',
  reference: 'REF-1',
  processId: 'passport',
  process: { name: 'Passport Application', authority: 'Ghana Immigration Service', icon: 'passport' },
  status: 'in-progress',
  statusLabel: 'In progress',
  badgeStatus: 'in-progress',
  summary: { missing: 1, inProgress: 0, total: 1 },
  requirements: [requiredItem],
  documents: [],
  readyToSubmit: false,
  nextStep: 'Add Ghana Card to keep this application moving.',
  progress: 0,
  updatedAt: '2026-11-01T00:00:00.000Z',
}

function setup(application = baseApplication, overrides = {}) {
  const getApplicationById = vi.fn(() => application)
  applicationPageHarness.context = {
    getApplicationById,
    getDocumentById: vi.fn(() => null),
    toggleRequirement: vi.fn().mockResolvedValue(true),
    setRequirementStatus: vi.fn().mockResolvedValue(true),
    submitApplication: vi.fn().mockResolvedValue({ id: 'application-one' }),
    updateApplicationDecision: vi.fn().mockResolvedValue({ id: 'application-one' }),
    showToast: vi.fn(),
    openUploadModal: vi.fn(),
    openDocumentPreview: vi.fn(),
    openAssistant: vi.fn(),
    isLoading: false,
    ...overrides,
  }
  return { ...render(<ApplicationDetailPage applicationId="application-one" />), getApplicationById }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('ApplicationDetailPage', () => {
  it('blocks submission until requirements are ready and sends checklist status changes', async () => {
    setup()

    expect(screen.getByRole('button', { name: 'Submit application' }).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Complete Ghana Card' }))
    await waitFor(() => expect(applicationPageHarness.context.setRequirementStatus)
      .toHaveBeenCalledWith('application-one', 'identity-card', 'completed'))
    expect(applicationPageHarness.context.submitApplication).not.toHaveBeenCalled()
  })

  it('submits a ready application and handles a request failure without losing the page', async () => {
    setup({ ...baseApplication, readyToSubmit: true }, {
      submitApplication: vi.fn().mockRejectedValue(new Error('Submission failed')),
    })

    fireEvent.click(screen.getByRole('button', { name: 'Submit application' }))

    await waitFor(() => expect(applicationPageHarness.context.submitApplication)
      .toHaveBeenCalledWith('application-one'))
    expect(screen.getByRole('button', { name: 'Submit application' }).disabled).toBe(false)
  })

  it('saves the recorded institution outcome after submission', async () => {
    setup({
      ...baseApplication,
      status: 'submitted',
      statusLabel: 'Submitted',
      outcome: 'pending',
    })

    fireEvent.change(screen.getByLabelText('Institution outcome'), {
      target: { value: 'accepted' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save outcome' }))

    await waitFor(() => expect(applicationPageHarness.context.updateApplicationDecision)
      .toHaveBeenCalledWith('application-one', 'accepted'))
  })
})
