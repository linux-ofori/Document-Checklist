import { useContext } from 'react'
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppDataProvider } from './AppDataProvider'
import { AppDataContext } from './AppDataContext'

const providerHarness = vi.hoisted(() => ({
  auth: {
    value: {
      status: 'authenticated',
      user: { id: 'user-one', email: 'one@example.test' },
      updateUser: vi.fn(),
      signOut: vi.fn(() => {
        providerHarness.auth.value.status = 'unauthenticated'
      }),
    },
  },
  askAssistant: vi.fn(),
}))

vi.mock('./AuthProvider', () => ({
  useAuth: () => providerHarness.auth.value,
}))

vi.mock('../services', () => ({
  createId: vi.fn(() => 'toast-test-id'),
  fetchApplications: vi.fn(async () => []),
  fetchDocuments: vi.fn(async () => []),
  fetchNotifications: vi.fn(async () => []),
  fetchProcesses: vi.fn(async () => []),
  isNotification: vi.fn(() => false),
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
  hasPersistentAuthToken: vi.fn(() => false),
  storeAuthToken: vi.fn(() => true),
  askAssistantQuestion: (...args) => providerHarness.askAssistant(...args),
}))

vi.mock('../components/product/GlobalOverlays', () => ({
  GlobalOverlays: () => null,
}))

afterEach(() => {
  cleanup()
})

beforeEach(() => {
  providerHarness.auth.value = {
    status: 'authenticated',
    user: { id: 'user-one', email: 'one@example.test' },
    updateUser: vi.fn(),
    signOut: vi.fn(() => {
      providerHarness.auth.value.status = 'unauthenticated'
    }),
  }
  providerHarness.askAssistant.mockReset()
})

function renderProvider() {
  let context
  function CaptureContext() {
    context = useContext(AppDataContext)
    return <output data-testid="assistant-state">{JSON.stringify(context.assistant)}</output>
  }
  const view = render(
    <AppDataProvider>
      <CaptureContext />
    </AppDataProvider>,
  )

  return {
    ...view,
    getContext: () => context,
    rerenderProvider: () => view.rerender(<AppDataProvider><CaptureContext /></AppDataProvider>),
  }
}

function deferred() {
  let resolve
  let reject
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

async function waitForProviderReady(provider) {
  await waitFor(() => expect(provider.getContext().status).toBe('ready'))
}

describe('AppDataProvider assistant requests', () => {
  it('forwards application context and omits it in general mode', async () => {
    providerHarness.askAssistant.mockResolvedValue({ answer: 'Answer', sources: [] })
    const provider = renderProvider()
    await waitForProviderReady(provider)

    act(() => provider.getContext().openAssistant('app-one'))
    await act(async () => provider.getContext().askAssistant('Application question'))
    expect(providerHarness.askAssistant.mock.calls[0][0]).toMatchObject({
      message: 'Application question',
      applicationId: 'app-one',
    })

    act(() => provider.getContext().openAssistant())
    await act(async () => provider.getContext().askAssistant('General question'))
    expect(providerHarness.askAssistant.mock.calls[1][0]).toMatchObject({
      message: 'General question',
    })
    expect(providerHarness.askAssistant.mock.calls[1][0]).not.toHaveProperty('applicationId')
  })

  it('blocks duplicate submits while a request is pending', async () => {
    const pending = deferred()
    providerHarness.askAssistant.mockReturnValue(pending.promise)
    const provider = renderProvider()
    await waitForProviderReady(provider)

    let firstRequest
    act(() => {
      firstRequest = provider.getContext().askAssistant('First question')
      provider.getContext().askAssistant('Duplicate question')
    })

    expect(providerHarness.askAssistant).toHaveBeenCalledTimes(1)
    await act(async () => {
      pending.resolve({ answer: 'First answer', sources: [] })
      await firstRequest
    })
  })

  it('aborts and isolates the previous application response after switching context', async () => {
    const first = deferred()
    const second = deferred()
    providerHarness.askAssistant
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    const provider = renderProvider()
    await waitForProviderReady(provider)

    act(() => provider.getContext().openAssistant('app-one'))
    let firstRequest
    act(() => {
      firstRequest = provider.getContext().askAssistant('First application')
    })
    const firstSignal = providerHarness.askAssistant.mock.calls[0][0].signal

    act(() => provider.getContext().openAssistant('app-two'))
    expect(firstSignal.aborted).toBe(true)

    let secondRequest
    act(() => {
      secondRequest = provider.getContext().askAssistant('Second application')
    })
    expect(providerHarness.askAssistant.mock.calls[1][0].applicationId).toBe('app-two')

    await act(async () => {
      first.resolve({ answer: 'Stale answer', sources: [] })
      await firstRequest
    })
    expect(provider.getContext().assistant.isThinking).toBe(true)
    expect(JSON.stringify(provider.getContext().assistant.messages)).not.toContain('Stale answer')

    await act(async () => {
      second.resolve({ answer: 'Current answer', sources: [] })
      await secondRequest
    })
    expect(provider.getContext().assistant.isThinking).toBe(false)
    expect(JSON.stringify(provider.getContext().assistant.messages)).toContain('Current answer')
  })

  it('aborts on panel close and permits a later retry after failure', async () => {
    const pending = deferred()
    providerHarness.askAssistant
      .mockReturnValueOnce(pending.promise)
      .mockRejectedValueOnce(Object.assign(new Error('private provider detail'), { status: 503 }))
      .mockResolvedValueOnce({ answer: 'Recovered answer', sources: [] })
    const provider = renderProvider()
    await waitForProviderReady(provider)

    let closedRequest
    act(() => {
      closedRequest = provider.getContext().askAssistant('Pending question')
    })
    const signal = providerHarness.askAssistant.mock.calls[0][0].signal
    act(() => provider.getContext().closeAssistant())
    expect(signal.aborted).toBe(true)

    await act(async () => {
      pending.resolve({ answer: 'Closed stale answer', sources: [] })
      await closedRequest
    })
    expect(provider.getContext().assistant.isThinking).toBe(false)
    expect(JSON.stringify(provider.getContext().assistant.messages)).not.toContain('Closed stale answer')

    await act(async () => provider.getContext().askAssistant('Retry question'))
    expect(provider.getContext().assistant.error).toBe('The assistant is temporarily unavailable.')
    expect(provider.getContext().assistant.error).not.toContain('private provider detail')

    await act(async () => provider.getContext().askAssistant('Retry question'))
    expect(JSON.stringify(provider.getContext().assistant.messages)).toContain('Recovered answer')
    expect(provider.getContext().assistant.isThinking).toBe(false)
  })

  it('signs out on 401 and ignores a result from a prior auth session', async () => {
    providerHarness.askAssistant.mockRejectedValueOnce(Object.assign(new Error('Unauthorized'), {
      status: 401,
    }))
    const provider = renderProvider()
    await waitForProviderReady(provider)

    await act(async () => provider.getContext().askAssistant('Expired session'))
    expect(providerHarness.auth.value.signOut).toHaveBeenCalledTimes(1)

    provider.rerenderProvider()
    await waitFor(() => {
      expect(provider.getContext().assistant).toMatchObject({
        isOpen: false,
        isThinking: false,
        messages: [],
        applicationId: null,
        error: null,
      })
    })

    providerHarness.auth.value = {
      ...providerHarness.auth.value,
      status: 'authenticated',
      user: { id: 'user-two', email: 'two@example.test' },
    }
    provider.rerenderProvider()
    await waitForProviderReady(provider)

    const pending = deferred()
    providerHarness.askAssistant.mockReturnValueOnce(pending.promise)
    let pendingRequest
    act(() => {
      pendingRequest = provider.getContext().askAssistant('Old account question')
    })
    const oldSignal = providerHarness.askAssistant.mock.calls[1][0].signal

    providerHarness.auth.value = {
      ...providerHarness.auth.value,
      user: { id: 'user-three', email: 'three@example.test' },
    }
    provider.rerenderProvider()
    expect(oldSignal.aborted).toBe(true)

    await act(async () => {
      pending.resolve({ answer: 'Old account answer', sources: [] })
      await pendingRequest
    })
    expect(JSON.stringify(provider.getContext().assistant.messages)).not.toContain('Old account answer')
    expect(provider.getContext().assistant.isThinking).toBe(false)
  })
})
