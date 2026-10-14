import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RemindersPage } from './RemindersPage'

const remindersHarness = vi.hoisted(() => ({
  context: {},
  navigate: vi.fn(),
}))

vi.mock('../hooks/useAppData', () => ({
  useAppData: () => remindersHarness.context,
}))

vi.mock('../hooks/useActiveRoute', () => ({
  useActiveRoute: () => ({ navigate: remindersHarness.navigate }),
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
  NotificationCard: ({ notification, onRead, onOpenDocument }) => (
    <li>
      <span>{notification.title}</span>
      {!notification.isRead
        ? <button onClick={() => onRead(notification.id)}>Mark read</button>
        : null}
      {onOpenDocument
        ? <button onClick={() => onOpenDocument(notification)}>Open document</button>
        : null}
    </li>
  ),
  StatCard: ({ label, value }) => <div>{label}: {value}</div>,
}))

const notification = {
  id: 'expiry-one',
  kind: 'document-expiry',
  title: 'Passport expires soon',
  body: 'Your passport expires in 30 days.',
  severity: 'warning',
  isRead: false,
  isOverdue: false,
  applicationId: null,
  documentId: 'document-one',
  dueDate: '2027-01-01T00:00:00.000Z',
  createdAt: '2026-11-01T00:00:00.000Z',
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('RemindersPage', () => {
  it('shows loading and retry states and wires a retry request', () => {
    remindersHarness.context = {
      notificationViews: [],
      notificationsStatus: 'loading',
      notificationsError: null,
      notificationsRefreshing: false,
      retryNotifications: vi.fn(),
      markNotificationRead: vi.fn(),
      markAllNotificationsRead: vi.fn(),
      openAssistant: vi.fn(),
      getDocumentById: vi.fn(() => null),
      openDocumentPreview: vi.fn(),
    }
    const { rerender } = render(<RemindersPage />)
    expect(screen.getByText('Loading your notifications')).toBeTruthy()

    remindersHarness.context = {
      ...remindersHarness.context,
      notificationsStatus: 'error',
      notificationsError: 'We could not load notifications.',
    }
    rerender(<RemindersPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(remindersHarness.context.retryNotifications).toHaveBeenCalledOnce()
  })

  it('connects read actions, read-all, and document previews to provider operations', () => {
    const markNotificationRead = vi.fn()
    const markAllNotificationsRead = vi.fn()
    const openDocumentPreview = vi.fn()
    const getDocumentById = vi.fn(() => ({ id: 'document-one' }))
    remindersHarness.navigate.mockReset()
    remindersHarness.context = {
      notificationViews: [notification],
      notificationsStatus: 'ready',
      notificationsError: null,
      notificationsRefreshing: false,
      retryNotifications: vi.fn(),
      markNotificationRead,
      markAllNotificationsRead,
      openAssistant: vi.fn(),
      getDocumentById,
      openDocumentPreview,
    }
    render(<RemindersPage />)

    fireEvent.click(screen.getByRole('button', { name: 'Mark read' }))
    fireEvent.click(screen.getByRole('button', { name: 'Mark all as read' }))
    fireEvent.click(screen.getByRole('button', { name: 'Open document' }))
    expect(markNotificationRead).toHaveBeenCalledWith('expiry-one')
    expect(markAllNotificationsRead).toHaveBeenCalledOnce()
    expect(openDocumentPreview).toHaveBeenCalledWith('document-one')
  })
})
