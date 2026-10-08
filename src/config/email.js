const emailAddressPattern = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

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

  return { enabled, from: from || null, replyTo: replyTo || null };
}

module.exports = { isValidEmailAddress, loadEmailConfig };
