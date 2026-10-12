const crypto = require('node:crypto');
const { OAuth2Client } = require('google-auth-library');

const TRANSACTION_TTL_MS = 10 * 60 * 1000;
const EXCHANGE_TICKET_TTL_MS = 60 * 1000;
const CLEANUP_INTERVAL_MS = 60 * 1000;
const MAX_PENDING_ITEMS = 10000;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

class GoogleOAuthError extends Error {
  constructor(code) {
    super('Google sign-in could not be completed.');
    this.name = 'GoogleOAuthError';
    this.code = code;
  }
}

function createGoogleOAuthService({
  config,
  client = config.enabled
    ? new OAuth2Client({
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      redirectUri: config.redirectUri
    })
    : null,
  now = Date.now
}) {
  const transactions = new Map();
  const tickets = new Map();

  function sweepExpired() {
    const currentTime = now();
    for (const [key, value] of transactions) {
      if (value.expiresAt <= currentTime) {
        transactions.delete(key);
      }
    }
    for (const [key, value] of tickets) {
      if (value.expiresAt <= currentTime) {
        tickets.delete(key);
      }
    }
  }

  const cleanupTimer = setInterval(sweepExpired, CLEANUP_INTERVAL_MS);
  cleanupTimer.unref();

  function requireEnabled() {
    if (!config.enabled || !client) {
      throw new GoogleOAuthError('oauth-disabled');
    }
  }

  function beginAuthorization({ intent, userId, tokenVersion, sessionExpiresAt }) {
    requireEnabled();
    sweepExpired();
    if (transactions.size >= MAX_PENDING_ITEMS) {
      throw new GoogleOAuthError('capacity');
    }

    const state = crypto.randomBytes(32).toString('base64url');
    const nonce = crypto.randomBytes(32).toString('base64url');
    const codeVerifier = crypto.randomBytes(32).toString('base64url');
    const browserBinding = crypto.randomBytes(32).toString('base64url');
    const codeChallenge = crypto.createHash('sha256')
      .update(codeVerifier)
      .digest('base64url');
    const expiresAt = Math.min(
      now() + TRANSACTION_TTL_MS,
      intent === 'link' && Number.isSafeInteger(sessionExpiresAt)
        ? sessionExpiresAt * 1000
        : Infinity
    );

    transactions.set(state, {
      intent,
      nonce,
      codeVerifier,
      browserBindingHash: crypto.createHash('sha256').update(browserBinding).digest(),
      userId: intent === 'link' ? userId : null,
      tokenVersion: intent === 'link' ? tokenVersion : null,
      sessionExpiresAt: intent === 'link' ? sessionExpiresAt : null,
      expiresAt
    });

    let authorizationUrl;
    try {
      authorizationUrl = client.generateAuthUrl({
        access_type: 'online',
        scope: ['openid', 'email', 'profile'],
        response_type: 'code',
        redirect_uri: config.redirectUri,
        state,
        nonce,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256'
      });
    } catch {
      transactions.delete(state);
      throw new GoogleOAuthError('authorization-unavailable');
    }

    return { authorizationUrl, state, browserBinding };
  }

  async function consumeAuthorization({ state, browserBinding, code, providerError }) {
    requireEnabled();
    if (typeof state !== 'string' || state.length > 128) {
      throw new GoogleOAuthError('invalid-transaction');
    }

    const transaction = transactions.get(state);
    if (!transaction) {
      throw new GoogleOAuthError('invalid-transaction');
    }
    transactions.delete(state);

    if (transaction.expiresAt <= now()) {
      throw new GoogleOAuthError('expired-transaction');
    }
    if (transaction.intent === 'link'
        && (!Number.isSafeInteger(transaction.sessionExpiresAt)
          || transaction.sessionExpiresAt * 1000 <= now())) {
      throw new GoogleOAuthError('expired-transaction');
    }
    if (typeof browserBinding !== 'string' || browserBinding.length > 128) {
      throw new GoogleOAuthError('invalid-transaction');
    }

    const bindingHash = crypto.createHash('sha256').update(browserBinding).digest();
    if (!crypto.timingSafeEqual(transaction.browserBindingHash, bindingHash)) {
      throw new GoogleOAuthError('invalid-transaction');
    }
    if (providerError) {
      throw new GoogleOAuthError('provider-denied');
    }
    if (typeof code !== 'string' || !code || code.length > 4096) {
      throw new GoogleOAuthError('invalid-code');
    }

    let tokens;
    let ticket;
    try {
      ({ tokens } = await client.getToken({
        code,
        codeVerifier: transaction.codeVerifier
      }));
      if (typeof tokens.id_token !== 'string' || !tokens.id_token) {
        throw new Error('Missing ID token.');
      }
      ticket = await client.verifyIdToken({
        idToken: tokens.id_token,
        audience: config.clientId
      });
    } catch {
      throw new GoogleOAuthError('provider-verification-failed');
    }

    let payload;
    try {
      payload = ticket.getPayload();
    } catch {
      throw new GoogleOAuthError('invalid-identity');
    }
    const issuerIsValid = payload
      && ['accounts.google.com', 'https://accounts.google.com'].includes(payload.iss);
    if (!payload
        || !issuerIsValid
        || payload.nonce !== transaction.nonce
        || typeof payload.sub !== 'string'
        || !payload.sub
        || payload.sub.length > 255
        || /[\u0000-\u001f\u007f]/.test(payload.sub)
        || payload.email_verified !== true
        || typeof payload.email !== 'string'
        || !emailPattern.test(payload.email.trim())
        || payload.email.trim().length > 254) {
      throw new GoogleOAuthError('invalid-identity');
    }

    const email = payload.email.trim().toLowerCase();
    const candidateName = typeof payload.name === 'string'
      ? payload.name.trim().replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 100)
      : '';
    const emailName = email.split('@')[0].slice(0, 100);
    const name = candidateName.length >= 2
      ? candidateName
      : (emailName.length >= 2 ? emailName : 'Google User');

    return {
      transaction,
      identity: { subject: payload.sub, email, name, emailVerified: true }
    };
  }

  function issueExchangeTicket({
    intent,
    userId,
    tokenVersion,
    googleSubject,
    sessionExpiresAt
  }) {
    requireEnabled();
    sweepExpired();
    if (tickets.size >= MAX_PENDING_ITEMS) {
      throw new GoogleOAuthError('capacity');
    }

    let value;
    do {
      value = crypto.randomBytes(32).toString('base64url');
    } while (tickets.has(value));

    tickets.set(value, {
      intent,
      userId,
      tokenVersion,
      googleSubject,
      sessionExpiresAt: intent === 'link' ? sessionExpiresAt : null,
      expiresAt: Math.min(
        now() + EXCHANGE_TICKET_TTL_MS,
        intent === 'link' && Number.isSafeInteger(sessionExpiresAt)
          ? sessionExpiresAt * 1000
          : Infinity
      )
    });
    return value;
  }

  function consumeExchangeTicket(value) {
    if (typeof value !== 'string' || !value || value.length > 128) {
      return null;
    }

    const ticket = tickets.get(value);
    if (!ticket) {
      return null;
    }

    tickets.delete(value);
    return ticket.expiresAt > now() ? ticket : null;
  }

  function dispose() {
    clearInterval(cleanupTimer);
    transactions.clear();
    tickets.clear();
  }

  return {
    beginAuthorization,
    consumeAuthorization,
    issueExchangeTicket,
    consumeExchangeTicket,
    dispose
  };
}

module.exports = { createGoogleOAuthService, GoogleOAuthError };
