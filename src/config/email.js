const emailAddressPattern = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const { configuredCorsOrigins } = require('./cors');
const localVerificationUrl = 'http://localhost:5173/verify-email';

function isValidEmailAddress(value) {
  return typeof value === 'string'
    && value.length <= 254
    && !/[\r\n]/.test(value)
    && emailAddressPattern.test(value);
}

function loadEmailConfig(environment = process.env) {
  const enabledValue = environment.EMAIL_ENABLED;
  if (enabledValue !== undefined && enabledValue !== 'true' && enabledValue !== 'false') {
    throw new Error('EMAIL_ENABLED must be either true or false.');
  }

  const enabled = enabledValue === 'true';
  const rawFrom = typeof environment.EMAIL_FROM === 'string' ? environment.EMAIL_FROM : '';
  const rawReplyTo = typeof environment.EMAIL_REPLY_TO === 'string'
    ? environment.EMAIL_REPLY_TO
    : '';
  const from = rawFrom.trim();
  const replyTo = rawReplyTo.trim();

  if (/[\r\n]/.test(rawFrom)) {
    throw new Error('EMAIL_FROM must be a valid email address without newlines.');
  }
  if (environment.EMAIL_REPLY_TO !== undefined && /[\r\n]/.test(rawReplyTo)) {
    throw new Error('EMAIL_REPLY_TO must be a valid email address without newlines.');
  }
  if (enabled && !from) {
    throw new Error('EMAIL_FROM must be configured when email is enabled.');
  }
  if (from && !isValidEmailAddress(from)) {
    throw new Error('EMAIL_FROM must be a valid email address without newlines.');
  }
  if (replyTo && !isValidEmailAddress(replyTo)) {
    throw new Error('EMAIL_REPLY_TO must be a valid email address without newlines.');
  }

  const configuredVerificationUrl = environment.FRONTEND_EMAIL_VERIFICATION_URL;
  const rawVerificationUrl = configuredVerificationUrl === undefined
    && environment.NODE_ENV !== 'production'
    ? localVerificationUrl
    : configuredVerificationUrl;
  let frontendVerificationUrl = null;

  if (rawVerificationUrl !== undefined) {
    let parsedVerificationUrl;
    try {
      parsedVerificationUrl = new URL(rawVerificationUrl);
    } catch {
      throw new Error('FRONTEND_EMAIL_VERIFICATION_URL must be an absolute verification URL.');
    }

    if (typeof rawVerificationUrl !== 'string'
        || !['http:', 'https:'].includes(parsedVerificationUrl.protocol)
        || !parsedVerificationUrl.hostname
        || parsedVerificationUrl.username
        || parsedVerificationUrl.password
        || parsedVerificationUrl.pathname !== '/verify-email'
        || parsedVerificationUrl.search
        || parsedVerificationUrl.hash
        || parsedVerificationUrl.toString() !== rawVerificationUrl) {
      throw new Error('FRONTEND_EMAIL_VERIFICATION_URL must be an exact /verify-email URL without query or fragment.');
    }
    if (environment.NODE_ENV === 'production' && parsedVerificationUrl.protocol !== 'https:') {
      throw new Error('FRONTEND_EMAIL_VERIFICATION_URL must use HTTPS in production.');
    }
    if (parsedVerificationUrl.protocol !== 'https:'
        && !new Set(['localhost', '127.0.0.1', '[::1]']).has(parsedVerificationUrl.hostname)) {
      throw new Error('FRONTEND_EMAIL_VERIFICATION_URL must use HTTPS except for local development.');
    }
    if (!configuredCorsOrigins(environment).includes(parsedVerificationUrl.origin)) {
      throw new Error('FRONTEND_EMAIL_VERIFICATION_URL origin must be included in CORS_ALLOWED_ORIGINS.');
    }

    frontendVerificationUrl = parsedVerificationUrl.toString();
  } else if (enabled) {
    throw new Error('FRONTEND_EMAIL_VERIFICATION_URL must be configured when email is enabled in production.');
  }

  return { enabled, from: from || null, replyTo: replyTo || null, frontendVerificationUrl };
}

module.exports = { isValidEmailAddress, loadEmailConfig };
