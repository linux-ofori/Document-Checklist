export const ASSISTANT_SUGGESTIONS = [
  'What is still missing for my passport?',
  'Which document expires first?',
  'How do I finish the business registration?',
  'What can I submit at the immigration office today?',
]

export const ASSISTANT_ANSWERS = [
  {
    id: 'assistant-passport',
    match: ['passport', 'missing'],
    title: 'Passport Application is 36% complete',
    body: 'You have attached your Ghana Card and passport photograph. Still needed: a certified birth certificate, the signed GI-5 application form, a supporting document, proof of address from the last three months, and your fee receipt if you want it ready before the appointment.',
    followUp: 'The birth certificate is the item offices reject most often, so start there.',
  },
  {
    id: 'assistant-expiry',
    match: ['expire', 'expiry', 'expires first'],
    title: 'Your ECG Utility Bill expires first',
    body: 'It expires on 18 October 2026, which is 18 days from now. The medical certificate follows on 2 November 2026. Everything else you hold is valid for more than a year.',
    followUp: 'Business Registration needs a bill dated within three months, so a renewal is worth doing soon.',
  },
  {
    id: 'assistant-business',
    match: ['business', 'registration', 'company'],
    title: 'Two steps left on Business Registration',
    body: 'Add the director’s passport photograph and the lease or land ownership document. Your application form still needs a second signature and the constitution is waiting on the company secretary.',
    followUp: 'Your registry appointment is on 30 October, so there is time to finish this properly.',
  },
  {
    id: 'assistant-ready',
    match: ['today', 'submit', 'bring'],
    title: 'You can visit the immigration office today',
    body: 'Bring your Ghana Card, your passport photograph and the application form. Upload those three and your appointment can go ahead even though the birth certificate is still outstanding.',
    followUp: 'Add the remaining documents through the checklist afterwards.',
  },
  {
    id: 'assistant-default',
    match: [],
    title: 'Here is where you stand',
    body: 'You are tracking 4 active applications with 22 documents. Business Registration is the furthest along at 61%, and the Passport Application needs the most attention. Four reminders are waiting for you.',
    followUp: 'Open the Reminders page to work through them in order of urgency.',
  },
]

export function findAssistantAnswer(question) {
  const term = String(question ?? '').trim().toLowerCase()
  if (!term) return ASSISTANT_ANSWERS[ASSISTANT_ANSWERS.length - 1]

  const match = ASSISTANT_ANSWERS.find((answer) =>
    answer.match.some((keyword) => term.includes(keyword)),
  )

  return match ?? ASSISTANT_ANSWERS[ASSISTANT_ANSWERS.length - 1]
}
