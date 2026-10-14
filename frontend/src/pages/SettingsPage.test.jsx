import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SettingsPage } from './SettingsPage'

const settingsHarness = vi.hoisted(() => ({
  value: null,
}))

vi.mock('../hooks/useAppData', () => ({
  useAppData: () => settingsHarness.value,
}))

vi.mock('../layouts/AppLayout', () => ({
  AppLayout: ({ children }) => <div>{children}</div>,
}))

afterEach(() => {
  cleanup()
})

beforeEach(() => {
  settingsHarness.value = {
    profile: {
      email: 'person@example.test',
      preferences: {
        documentExpiry: true,
        applicationUpdates: true,
        securityAccount: true,
      },
    },
    isLoading: false,
    retryHydration: vi.fn(),
    changePassword: vi.fn(),
    updatePreferences: vi.fn(),
    showToast: vi.fn(),
  }
})

describe('SettingsPage notification preferences', () => {
  it('keeps security/account notifications checked and disabled', () => {
    render(<SettingsPage />)

    const securityPreference = screen.getByRole('switch', {
      name: /Security and account notifications/,
    })
    expect(securityPreference.checked).toBe(true)
    expect(securityPreference.disabled).toBe(true)
  })

  it('saves applicationUpdates and shows the existing success feedback', async () => {
    settingsHarness.value.updatePreferences.mockResolvedValue({
      documentExpiry: true,
      applicationUpdates: false,
      securityAccount: true,
    })
    render(<SettingsPage />)

    const applicationUpdates = screen.getByRole('switch', {
      name: /In-app application updates/,
    })
    fireEvent.click(applicationUpdates)
    fireEvent.click(screen.getByRole('button', { name: 'Save preferences' }))

    await waitFor(() => {
      expect(settingsHarness.value.updatePreferences).toHaveBeenCalledWith({
        documentExpiry: true,
        applicationUpdates: false,
        securityAccount: true,
      })
      expect(settingsHarness.value.showToast).toHaveBeenCalledWith(
        'Your notification preferences have been saved.',
      )
    })
    expect(applicationUpdates.checked).toBe(false)
  })

  it('shows the save error and restores the original profile preferences', async () => {
    settingsHarness.value.updatePreferences.mockRejectedValue(
      new Error('We could not save your notification preferences. Please try again.'),
    )
    render(<SettingsPage />)

    const applicationUpdates = screen.getByRole('switch', {
      name: /In-app application updates/,
    })
    fireEvent.click(applicationUpdates)
    expect(applicationUpdates.checked).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Save preferences' }))

    expect(await screen.findByText('Preferences not saved')).toBeTruthy()
    expect(screen.getByText(
      'We could not save your notification preferences. Please try again.',
    )).toBeTruthy()
    expect(applicationUpdates.checked).toBe(true)
    expect(settingsHarness.value.showToast).not.toHaveBeenCalled()
  })

  it('shows two-factor authentication as unavailable without a setup action', () => {
    render(<SettingsPage />)

    expect(screen.getByText('Two-factor authentication unavailable')).toBeTruthy()
    expect(screen.getByText('Setup is not currently supported.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /two-factor/i })).toBeNull()
  })
})
