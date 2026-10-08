import { request } from './client'

function responseUser(response) {
  return response?.user ?? response
}

export async function saveProfile({ name, email, phone }) {
  const response = await request('auth/me', {
    method: 'PUT',
    body: {
      name: String(name ?? '').trim(),
      email: String(email ?? '').trim(),
      phone: String(phone ?? '').trim(),
    },
  })

  return responseUser(response)
}

export async function savePassword({ currentPassword, newPassword }) {
  return request('auth/change-password', {
    method: 'POST',
    body: { currentPassword, newPassword },
  })
}

export async function savePreferences(preferences) {
  const response = await request('auth/me', {
    method: 'PUT',
    body: {
      preferences: {
        notifications: {
          documentExpiry: Boolean(preferences.documentExpiry),
          applicationUpdates: Boolean(preferences.applicationUpdates),
          securityAccount: true,
        },
      },
    },
  })

  return responseUser(response)
}
