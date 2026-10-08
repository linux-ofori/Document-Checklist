const { isValidEmailAddress } = require('../config/email');

function validateMessage(message) {
  if (!message || typeof message !== 'object' || Array.isArray(message)) {
    throw new TypeError('An email message object is required.');
  }
  if (!isValidEmailAddress(message.to)) {
    throw new TypeError('A valid email recipient is required.');
  }
  if (typeof message.subject !== 'string'
      || message.subject.trim() === ''
      || message.subject.length > 998
      || /[\r\n]/.test(message.subject)) {
    throw new TypeError('A valid email subject without newlines is required.');
  }
  if (typeof message.text !== 'string' || message.text.length === 0) {
    throw new TypeError('A non-empty plain-text email body is required.');
  }
  if (message.html !== undefined && typeof message.html !== 'string') {
    throw new TypeError('The HTML email body must be a string when provided.');
  }
  for (const field of ['eventType', 'eventId']) {
    if (message[field] !== undefined
        && (typeof message[field] !== 'string' || /[\r\n]/.test(message[field]))) {
      throw new TypeError(`Email ${field} must be a string without newlines.`);
    }
  }
}

function createEmailService({ enabled = false, from = null, replyTo = null, provider, timeoutMs = 10000 }) {
  if (enabled && (!provider || typeof provider.sendEmail !== 'function')) {
    throw new TypeError('An email provider is required when email is enabled.');
  }
  if (enabled && !isValidEmailAddress(from)) {
    throw new TypeError('A valid sender address is required when email is enabled.');
  }
  if (replyTo !== null && !isValidEmailAddress(replyTo)) {
    throw new TypeError('A valid reply-to address is required when provided.');
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError('Email provider timeout must be a safe positive integer.');
  }

  async function sendEmail(message) {
    validateMessage(message);

    if (!enabled) {
      return { status: 'disabled', delivered: false };
    }

    const providerMessage = {
      to: message.to,
      from,
      replyTo,
      subject: message.subject,
      text: message.text
    };
    if (message.html !== undefined) {
      providerMessage.html = message.html;
    }
    if (message.eventType !== undefined) {
      providerMessage.eventType = message.eventType;
    }
    if (message.eventId !== undefined) {
      providerMessage.eventId = message.eventId;
    }

    const controller = new AbortController();
    let timeout;
    try {
      await Promise.race([
        Promise.resolve().then(() => provider.sendEmail(providerMessage, {
          signal: controller.signal
        })),
        new Promise((_, reject) => {
          timeout = setTimeout(() => {
            // Cancellation is best-effort; adapters must honor the signal, and it cannot undo acceptance.
            controller.abort();
            const error = new Error('Email provider request timed out.');
            error.code = 'EMAIL_PROVIDER_TIMEOUT';
            reject(error);
          }, timeoutMs);
        })
      ]);
      return { status: 'sent', delivered: true };
    } catch (error) {
      if (error && error.code === 'EMAIL_PROVIDER_TIMEOUT') {
        throw error;
      }

      const normalizedError = new Error('Email provider delivery failed.');
      normalizedError.code = 'EMAIL_PROVIDER_FAILURE';
      throw normalizedError;
    } finally {
      clearTimeout(timeout);
    }
  }

  return { sendEmail };
}

module.exports = { createEmailService };
