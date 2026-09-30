const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const PASSWORD_MIN_LENGTH = 8

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

export function validateUploadForm(values) {
  const errors = {}

  if (!values.fileName) {
    errors.file = 'Choose a file to upload.'
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
