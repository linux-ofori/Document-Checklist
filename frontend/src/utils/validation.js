const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const PASSWORD_MIN_LENGTH = 8
export const MAX_UPLOAD_SIZE_BYTES = 5 * 1024 * 1024
const UPLOAD_MIME_TYPES = {
  '.pdf': 'application/pdf',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
}

export const PASSWORD_RULES = [
  { id: 'length', label: 'At least 8 characters', test: (value) => value.length >= PASSWORD_MIN_LENGTH },
  {
    id: 'letter',
    label: 'Contains a letter',
    test: (value) => /[A-Za-z]/.test(value),
  },
  {
    id: 'number',
    label: 'Contains a number',
    test: (value) => /[0-9]/.test(value),
  },
]

export function isValidEmail(value) {
  return EMAIL_PATTERN.test(String(value ?? '').trim())
}

export function passwordStrength(value) {
  const password = String(value ?? '')
  const metRules = PASSWORD_RULES.filter((rule) => rule.test(password)).map((rule) => rule.id)
  const ratio = metRules.length / PASSWORD_RULES.length

  if (ratio >= 1) return { score: 3, label: 'Strong', rules: metRules }
  if (ratio >= 0.66) return { score: 2, label: 'Fair', rules: metRules }
  if (ratio > 0) return { score: 1, label: 'Weak', rules: metRules }
  return { score: 0, label: 'Empty', rules: metRules }
}

export function validateLoginForm(values) {
  const errors = {}

  if (!String(values.email ?? '').trim()) {
    errors.email = 'Enter your email address.'
  } else if (!isValidEmail(values.email)) {
    errors.email = 'Enter a valid email address.'
  }

  if (!values.password) {
    errors.password = 'Enter your password.'
  }

  return errors
}

export function validateSignUpForm(values) {
  const errors = {}

  const name = String(values.name ?? '').trim()
  if (!name) {
    errors.name = 'Enter your full name.'
  } else if (name.length < 2) {
    errors.name = 'Enter at least 2 characters.'
  }

  if (!String(values.email ?? '').trim()) {
    errors.email = 'Enter your email address.'
  } else if (!isValidEmail(values.email)) {
    errors.email = 'Enter a valid email address.'
  }

  if (!values.password) {
    errors.password = 'Choose a password.'
  } else if (values.password.length < PASSWORD_MIN_LENGTH) {
    errors.password = `Use at least ${PASSWORD_MIN_LENGTH} characters.`
  }

  if (!values.confirmPassword) {
    errors.confirmPassword = 'Re-enter your password.'
  } else   if (values.confirmPassword !== values.password) {
    errors.confirmPassword = 'Passwords do not match.'
  }

  if (!values.terms) {
    errors.terms = 'Accept the terms of use to continue.'
  }

  return errors
}


export function validateProfileForm(values) {
  const errors = {}

  const name = String(values.name ?? '').trim()
  if (!name) errors.name = 'Enter your full name.'
  else if (name.length < 2) errors.name = 'Enter at least 2 characters.'

  if (!String(values.email ?? '').trim()) {
    errors.email = 'Enter your email address.'
  } else if (!isValidEmail(values.email)) {
    errors.email = 'Enter a valid email address.'
  }

  const phone = String(values.phone ?? '').trim()
  if (phone && !/^[+()\-\s\d]{7,20}$/.test(phone)) {
    errors.phone = 'Enter a valid phone number.'
  }

  return errors
}

export function validateChangePasswordForm(values) {
  const errors = {}

  if (!values.currentPassword) {
    errors.currentPassword = 'Enter your current password.'
  }

  if (!values.newPassword) {
    errors.newPassword = 'Choose a new password.'
  } else if (values.newPassword.length < PASSWORD_MIN_LENGTH) {
    errors.newPassword = `Use at least ${PASSWORD_MIN_LENGTH} characters.`
  }

  if (!values.confirmPassword) {
    errors.confirmPassword = 'Re-enter your new password.'
  } else if (values.confirmPassword !== values.newPassword) {
    errors.confirmPassword = 'Passwords do not match.'
  }

  if (values.newPassword && values.newPassword === values.currentPassword) {
    errors.newPassword = 'Choose a password you have not used before.'
  }

  return errors
}

export function validateUploadFile(file) {
  if (!file || typeof file !== 'object') {
    return 'Choose a file to upload.'
  }

  if (typeof file.name !== 'string' || !file.name.trim()) {
    return 'The selected file has no valid filename.'
  }

  if (typeof file.size !== 'number' || !Number.isFinite(file.size)) {
    return 'The selected file size could not be determined.'
  }
  if (file.size <= 0) {
    return 'The selected file is empty. Choose a file with content.'
  }
  if (file.size > MAX_UPLOAD_SIZE_BYTES) {
    return 'Choose a file that is 5 MiB or smaller.'
  }

  const extension = file.name.slice(file.name.lastIndexOf('.')).toLowerCase()
  const expectedMimeType = UPLOAD_MIME_TYPES[extension]
  if (!expectedMimeType) {
    return 'Choose a PDF, JPG, JPEG, or PNG file.'
  }

  if (file.type && file.type !== expectedMimeType) {
    return 'The selected file type does not match its filename. Choose a matching PDF, JPG, JPEG, or PNG file.'
  }

  return null
}

export function validateUploadForm(values) {
  const errors = {}

  const fileError = validateUploadFile(values.file)
  if (fileError) {
    errors.file = fileError
  }

  const name = String(values.name ?? '').trim()
  if (!name) {
    errors.name = 'Enter a document name.'
  } else if (name.length > 150) {
    errors.name = 'Document name must be 150 characters or fewer.'
  }

  if (!String(values.documentType ?? '').trim()) {
    errors.documentType = 'Select a document type.'
  }

  if (!String(values.applicationId ?? '').trim()) {
    errors.applicationId = 'Select the application this belongs to.'
  }

  if (values.expiryDate) {
    const expiry = new Date(values.expiryDate)
    if (Number.isNaN(expiry.getTime())) {
      errors.expiryDate = 'Enter a valid date.'
    }
  }

  return errors
}
