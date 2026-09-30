export const PROFILE = {
  id: 'usr-20481',
  name: 'Ama Serwaa Boateng',
  firstName: 'Ama',
  email: 'ama.boateng@example.com',
  phone: '+233 24 555 0142',
  location: 'East Legon, Accra',
  country: 'Ghana',
  role: 'Personal account',
  memberSince: '2025-03-18T00:00:00.000Z',
  timezone: 'GMT (UTC+0)',
  applicationsCount: 5,
  documentsCount: 21,
  completionRate: 68,
  bio: 'I keep track of immigration, business and university paperwork so nothing expires in my inbox again.',
  security: {
    twoFactorEnabled: false,
    lastPasswordChange: '2026-02-11T00:00:00.000Z',
    lastSignIn: '2026-09-30T06:42:00.000Z',
  },
  preferences: {
    expiryAlerts: true,
    missingDocumentAlerts: true,
    applicationUpdates: true,
    emailDigest: true,
    weeklySummary: false,
  },
}

export const PREFERENCE_OPTIONS = [
  {
    id: 'expiryAlerts',
    label: 'Document expiry alerts',
    description: 'Warn me 60, 30 and 7 days before a document expires.',
  },
  {
    id: 'missingDocumentAlerts',
    label: 'Missing document alerts',
    description: 'Tell me when a checklist still has items marked as missing.',
  },
  {
    id: 'applicationUpdates',
    label: 'Application updates',
    description: 'Notify me when a checklist is submitted or a new step is unlocked.',
  },
  {
    id: 'emailDigest',
    label: 'Daily email digest',
    description: 'One summary email each morning with everything that needs attention.',
  },
  {
    id: 'weeklySummary',
    label: 'Weekly progress summary',
    description: 'A Monday recap of progress across all applications.',
  },
]
