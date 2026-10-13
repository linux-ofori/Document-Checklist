const emailAddressPattern = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const { configuredCorsOrigins } = require('./cors');
const localVerificationUrl = 'http://localhost:5173/verify-email';
const localPasswordResetUrl = 'http://localhost:5173/reset-password';

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

  function configuredFrontendUrl(environmentVariable, pathname, localDefault) {
    const configuredUrl = environment[environmentVariable];
    const rawUrl = configuredUrl === undefined && environment.NODE_ENV !== 'production'
      ? localDefault
      : configuredUrl;
    if (rawUrl === undefined) {
      if (enabled) {
        throw new Error(`${environmentVariable} must be configured when email is enabled in production.`);
      }
      return null;
    }

    let parsedUrl;
    try {
      parsedUrl = new URL(rawUrl);
    } catch {
      throw new Error(`${environmentVariable} must be an absolute frontend URL.`);
    }

    if (typeof rawUrl !== 'string'
        || !['http:', 'https:'].includes(parsedUrl.protocol)
        || !parsedUrl.hostname
        || parsedUrl.username
        || parsedUrl.password
        || parsedUrl.pathname !== pathname
        || parsedUrl.search
        || parsedUrl.hash
        || parsedUrl.toString() !== rawUrl) {
      throw new Error(`${environmentVariable} must be an exact ${pathname} URL without query or fragment.`);
    }
    if (environment.NODE_ENV === 'production' && parsedUrl.protocol !== 'https:') {
      throw new Error(`${environmentVariable} must use HTTPS in production.`);
    }
    if (parsedUrl.protocol !== 'https:'
        && !new Set(['localhost', '127.0.0.1', '[::1]']).has(parsedUrl.hostname)) {
      throw new Error(`${environmentVariable} must use HTTPS except for local development.`);
    }
    if (!configuredCorsOrigins(environment).includes(parsedUrl.origin)) {
      throw new Error(`${environmentVariable} origin must be included in CORS_ALLOWED_ORIGINS.`);
    }

    return parsedUrl.toString();
  }

  const frontendVerificationUrl = configuredFrontendUrl(
    'FRONTEND_EMAIL_VERIFICATION_URL',
    '/verify-email',
    localVerificationUrl
  );
  const frontendPasswordResetUrl = configuredFrontendUrl(
    'FRONTEND_PASSWORD_RESET_URL',
    '/reset-password',
    localPasswordResetUrl
  );

  return {
    enabled,
    from: from || null,
    replyTo: replyTo || null,
    frontendVerificationUrl,
    frontendPasswordResetUrl
  };
}

module.exports = { isValidEmailAddress, loadEmailConfig };
