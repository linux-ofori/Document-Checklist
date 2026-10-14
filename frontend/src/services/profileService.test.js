import { afterEach, describe, expect, it, vi } from 'vitest'
import { request } from './client'
import { savePreferences } from './profileService'

vi.mock('./client', () => ({
  request: vi.fn(),
}))

afterEach(() => {
  vi.clearAllMocks()
})

describe('savePreferences', () => {
  it('sends the notification preferences with securityAccount forced on', async () => {
    const user = { id: 'user-123', preferences: { notifications: {} } }
    request.mockResolvedValue({ user })

    await expect(savePreferences({
      documentExpiry: false,
      applicationUpdates: false,
      securityAccount: false,
    })).resolves.toBe(user)

    expect(request).toHaveBeenCalledWith('auth/me', {
      method: 'PUT',
      body: {
        preferences: {
          notifications: {
            documentExpiry: false,
            applicationUpdates: false,
            securityAccount: true,
          },
        },
      },
    })
  })
})
