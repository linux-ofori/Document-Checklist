import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ROUTES } from '../../utils/routes'
import { GlobalOverlays } from './GlobalOverlays'

const routeAuth = vi.hoisted(() => ({ path: '/', status: 'authenticated' }))

vi.mock('../../hooks/useActiveRoute', () => ({
  useActiveRoute: () => ({ path: routeAuth.path }),
}))

vi.mock('../../context/AuthProvider', () => ({
  useAuth: () => ({ status: routeAuth.status }),
}))

vi.mock('./UploadDocumentModal', () => ({ UploadDocumentModal: () => null }))
vi.mock('./DocumentPreviewModal', () => ({ DocumentPreviewModal: () => null }))
vi.mock('./Toast', () => ({ Toast: () => null }))
vi.mock('./AskAiPanel', () => ({
  AskAiPanel: () => <div data-testid="assistant-panel" />,
}))

afterEach(() => {
  cleanup()
})

describe('GlobalOverlays assistant visibility', () => {
  it.each([
    ['/dashboard', true],
    ['/applications', true],
    ['/applications/new', true],
    ['/applications/app-123', true],
    ['/documents', true],
    ['/reminders', true],
    ['/profile', true],
    ['/settings', true],
    [ROUTES.landing, false],
    [ROUTES.login, false],
    [ROUTES.signup, false],
    [ROUTES.forgotPassword, false],
    [ROUTES.resetPassword, false],
    [ROUTES.verifyEmail, false],
    [ROUTES.googleCallback, false],
    ['/unknown-route', false],
  ])('at %s, assistant visibility is %s', (path, visible) => {
    routeAuth.path = path
    routeAuth.status = 'authenticated'

    render(<GlobalOverlays />)

    expect(Boolean(screen.queryByTestId('assistant-panel'))).toBe(visible)
  })

  it('hides the assistant on an application route when unauthenticated', () => {
    routeAuth.path = '/dashboard'
    routeAuth.status = 'unauthenticated'

    render(<GlobalOverlays />)

    expect(screen.queryByTestId('assistant-panel')).toBeNull()
  })
})
