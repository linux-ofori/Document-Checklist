export const DOCUMENT_TYPES = [
  { value: 'identity-card', label: 'National ID card', expiresAfterMonths: 120 },
  { value: 'photograph', label: 'Passport photograph', expiresAfterMonths: null },
  { value: 'birth-certificate', label: 'Birth certificate', expiresAfterMonths: null },
  { value: 'application-form', label: 'Application form', expiresAfterMonths: null },
  { value: 'proof-of-address', label: 'Proof of address', expiresAfterMonths: 12 },
  { value: 'supporting-document', label: 'Supporting document', expiresAfterMonths: null },
  { value: 'fee-receipt', label: 'Fee receipt', expiresAfterMonths: null },
  { value: 'business-registration-certificate', label: 'Business registration certificate', expiresAfterMonths: null },
  { value: 'company-constitution', label: 'Company constitution', expiresAfterMonths: null },
  { value: 'tax-clearance', label: 'Tax clearance certificate', expiresAfterMonths: 12 },
  { value: 'bank-statement', label: 'Bank statement', expiresAfterMonths: 3 },
  { value: 'medical-report', label: 'Medical report', expiresAfterMonths: 12 },
  { value: 'drivers-licence', label: "Driver's licence", expiresAfterMonths: 60 },
  { value: 'test-results', label: 'Test results', expiresAfterMonths: null },
  { value: 'transcript', label: 'Academic transcript', expiresAfterMonths: null },
  { value: 'recommendation-letter', label: 'Recommendation letter', expiresAfterMonths: null },
  { value: 'old-passport', label: 'Previous passport', expiresAfterMonths: null },
  { value: 'police-clearance', label: 'Police clearance', expiresAfterMonths: 6 },
  { value: 'marriage-certificate', label: 'Marriage certificate', expiresAfterMonths: null },
  { value: 'other', label: 'Other document', expiresAfterMonths: null },
]

export const DOCUMENT_TYPE_OPTIONS = DOCUMENT_TYPES.map((type) => ({
  value: type.value,
  label: type.label,
}))

export const DOCUMENT_TYPE_LABELS = DOCUMENT_TYPES.reduce((accumulator, type) => {
  accumulator[type.value] = type.label
  return accumulator
}, { other: 'Other document' })

export const ACCEPTED_UPLOAD_FORMATS = ['PDF', 'JPG', 'PNG']
export const MAX_UPLOAD_SIZE_MB = 5

export function getDocumentTypeLabel(value) {
  return DOCUMENT_TYPE_LABELS[value] ?? 'Other document'
}
