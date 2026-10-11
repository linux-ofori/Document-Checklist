const bcrypt = require('bcryptjs');
const express = require('express');
const { rateLimit } = require('express-rate-limit');
const requireAuth = require('../middleware/authMiddleware');
const withAccountOperationLock = require('../models/accountOperationLock');
const {
  createGoogleUser,
  findUserByEmail,
  findUserByGoogleSubject,
  findUserById,
  linkGoogleSubjectById,
  toPublicUser
} = require('../models/userModel');
const { createAuthToken } = require('../services/authToken');
const {
  createGoogleOAuthService,
  GoogleOAuthError
} = require('../services/googleOAuthService');
const { loadGoogleOAuthConfig } = require('../config/googleOAuth');

const GOOGLE_CALLBACK_PATH = '/api/auth/google/callback';
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function positiveIntegerEnvironmentValue(name, defaultValue) {
  const configuredValue = process.env[name];
  if (configuredValue === undefined) {
    return defaultValue;
  }

  const value = Number(configuredValue);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a safe positive integer.`);
  }

  return value;
}

function createGoogleOAuthRouter({
  config,
  service = createGoogleOAuthService({ config })
}) {
  const router = express.Router();
  const oauthRateLimit = rateLimit({
    windowMs: positiveIntegerEnvironmentValue(
      'GOOGLE_OAUTH_RATE_LIMIT_WINDOW_MS',
      15 * 60 * 1000
    ),
    limit: positiveIntegerEnvironmentValue('GOOGLE_OAUTH_RATE_LIMIT_MAX', 20),
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_request, response) => response.status(429).json({
      error: 'Too many Google sign-in attempts. Please try again later.'
    })
  });

  function unavailable(response) {
    return response.status(503).json({ error: 'Google sign-in is unavailable.' });
  }

  function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function cookieName(state) {
    return `document_checklist_google_${state}`;
  }

  function readCookie(request, name) {
    const header = request.headers.cookie;
    if (typeof header !== 'string') {
      return null;
    }

    const prefix = `${name}=`;
    const entry = header.split(';').map((value) => value.trim())
      .find((value) => value.startsWith(prefix));
    return entry ? entry.slice(prefix.length) : null;
  }

  function setBrowserBindingCookie(response, state, value) {
    const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
    response.append('Set-Cookie', `${cookieName(state)}=${value}; HttpOnly; SameSite=Lax; Path=${GOOGLE_CALLBACK_PATH}; Max-Age=600${secure}`);
  }

  function clearBrowserBindingCookie(response, state) {
    if (typeof state !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(state)) {
      return;
    }
    const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
    response.append('Set-Cookie', `${cookieName(state)}=; HttpOnly; SameSite=Lax; Path=${GOOGLE_CALLBACK_PATH}; Max-Age=0${secure}`);
  }

  function redirectToFrontend(response, value, isError = false) {
    const destination = new URL(config.frontendCallbackUrl);
    destination.hash = new URLSearchParams(isError
      ? { error: 'google_sign_in_failed' }
      : { ticket: value }).toString();
    response.set('Cache-Control', 'no-store');
    response.set('Pragma', 'no-cache');
    response.set('Referrer-Policy', 'no-referrer');
    return response.redirect(303, destination.toString());
  }

  function currentTokenVersion(user) {
    return Number.isSafeInteger(user.tokenVersion) ? user.tokenVersion : 0;
  }

  async function issueLoginTicket(user, googleSubject) {
    return withAccountOperationLock(user._id, async () => {
      const currentUser = await findUserById(user._id);
      if (!currentUser
          || currentUser.deleting
          || currentUser.googleSubject !== googleSubject) {
        throw new GoogleOAuthError('account-unavailable');
      }

      return service.issueExchangeTicket({
        intent: 'login',
        userId: currentUser._id,
        tokenVersion: currentTokenVersion(currentUser),
        googleSubject
      });
    });
  }

  async function signInOrCreateGoogleUser(identity) {
    const linkedUser = await findUserByGoogleSubject(identity.subject);
    if (linkedUser) {
      return issueLoginTicket(linkedUser, identity.subject);
    }

    if (!emailPattern.test(identity.email) || await findUserByEmail(identity.email)) {
      throw new GoogleOAuthError('account-conflict');
    }

    let user;
    try {
      user = await createGoogleUser({
        name: identity.name,
        email: identity.email,
        googleSubject: identity.subject
      });
    } catch (error) {
      if (error.errorType !== 'uniqueViolated') {
        throw error;
      }

      const concurrentlyCreatedUser = await findUserByGoogleSubject(identity.subject);
      if (!concurrentlyCreatedUser) {
        throw new GoogleOAuthError('account-conflict');
      }
      user = concurrentlyCreatedUser;
    }

    return issueLoginTicket(user, identity.subject);
  }

  async function linkGoogleIdentity(transaction, identity) {
    return withAccountOperationLock(transaction.userId, async () => {
      const user = await findUserById(transaction.userId);
      if (!user
          || user.deleting
          || currentTokenVersion(user) !== transaction.tokenVersion
          || !Number.isSafeInteger(transaction.sessionExpiresAt)
          || transaction.sessionExpiresAt * 1000 <= Date.now()) {
        throw new GoogleOAuthError('account-unavailable');
      }
      if (user.googleSubject) {
        throw new GoogleOAuthError('identity-conflict');
      }

      const existingIdentity = await findUserByGoogleSubject(identity.subject);
      if (existingIdentity && existingIdentity._id !== user._id) {
        throw new GoogleOAuthError('identity-conflict');
      }

      let linkedUser;
      try {
        linkedUser = await linkGoogleSubjectById(user._id, identity.subject);
      } catch (error) {
        if (error.errorType === 'uniqueViolated') {
          throw new GoogleOAuthError('identity-conflict');
        }
        throw error;
      }
      if (!linkedUser) {
        throw new GoogleOAuthError('identity-conflict');
      }

      return service.issueExchangeTicket({
        intent: 'link',
        userId: linkedUser._id,
        tokenVersion: currentTokenVersion(linkedUser),
        googleSubject: identity.subject,
        sessionExpiresAt: transaction.sessionExpiresAt
      });
    });
  }

  router.post('/authorization', oauthRateLimit, async (request, response, next) => {
    if (!config.enabled) {
      return unavailable(response);
    }

    const body = request.body;
    if (!isPlainObject(body)
        || (body.intent !== 'login' && body.intent !== 'link')
        || Object.keys(body).some((field) => !['intent', 'currentPassword'].includes(field))
        || (body.intent === 'login' && Object.hasOwn(body, 'currentPassword'))
        || (body.intent === 'link'
          && (typeof body.currentPassword !== 'string'
            || !body.currentPassword
            || body.currentPassword.length > 128
            || bcrypt.truncates(body.currentPassword)))) {
      return response.status(400).json({ error: 'Invalid Google authorization request.' });
    }

    const beginAuthorization = async () => {
      try {
        if (body.intent === 'login') {
          const flow = service.beginAuthorization({ intent: 'login' });
          setBrowserBindingCookie(response, flow.state, flow.browserBinding);
          response.set('Cache-Control', 'no-store');
          return response.json({ authorizationUrl: flow.authorizationUrl });
        }

        const result = await withAccountOperationLock(request.user.id, async () => {
          const user = await findUserById(request.user.id);
          if (!user
              || user.deleting
              || currentTokenVersion(user) !== request.authTokenVersion
              || !Number.isSafeInteger(request.authTokenExpiresAt)
              || request.authTokenExpiresAt * 1000 <= Date.now()) {
            return { kind: 'unavailable' };
          }
          if (user.googleSubject) {
            return { kind: 'already-linked' };
          }
          if (typeof user.password !== 'string'
              || !await bcrypt.compare(body.currentPassword, user.password)) {
            return { kind: 'invalid-password' };
          }

          return {
            kind: 'started',
            flow: service.beginAuthorization({
              intent: 'link',
              userId: user._id,
              tokenVersion: currentTokenVersion(user),
              sessionExpiresAt: request.authTokenExpiresAt
            })
          };
        });

        if (result.kind === 'unavailable') {
          return response.status(401).json({ error: 'The account is unavailable.' });
        }
        if (result.kind === 'already-linked') {
          return response.status(409).json({ error: 'A Google identity is already linked.' });
        }
        if (result.kind === 'invalid-password') {
          return response.status(401).json({ error: 'Current password is incorrect.' });
        }

        setBrowserBindingCookie(response, result.flow.state, result.flow.browserBinding);
        response.set('Cache-Control', 'no-store');
        return response.json({ authorizationUrl: result.flow.authorizationUrl });
      } catch (error) {
        if (error instanceof GoogleOAuthError) {
          return response.status(503).json({ error: 'Google sign-in is temporarily unavailable.' });
        }
        return next(error);
      }
    };

    if (body.intent === 'link') {
      return requireAuth(request, response, () => {
        beginAuthorization().catch(next);
      });
    }
    return beginAuthorization();
  });

  router.get('/callback', oauthRateLimit, async (request, response, next) => {
    if (!config.enabled) {
      return unavailable(response);
    }

    const state = request.query.state;
    const binding = typeof state === 'string' ? readCookie(request, cookieName(state)) : null;
    clearBrowserBindingCookie(response, state);

    let result;
    try {
      result = await service.consumeAuthorization({
        state,
        browserBinding: binding,
        code: request.query.code,
        providerError: request.query.error
      });
    } catch (error) {
      if (error instanceof GoogleOAuthError) {
        return redirectToFrontend(response, null, true);
      }
      return next(error);
    }

    try {
      const exchangeTicket = result.transaction.intent === 'login'
        ? await signInOrCreateGoogleUser(result.identity)
        : await linkGoogleIdentity(result.transaction, result.identity);
      return redirectToFrontend(response, exchangeTicket);
    } catch (error) {
      if (error instanceof GoogleOAuthError) {
        return redirectToFrontend(response, null, true);
      }
      return next(error);
    }
  });

  router.post('/exchange', oauthRateLimit, async (request, response, next) => {
    if (!config.enabled) {
      return unavailable(response);
    }
    if (!isPlainObject(request.body)
        || Object.keys(request.body).length !== 1
        || typeof request.body.ticket !== 'string'
        || !request.body.ticket) {
      return response.status(400).json({ error: 'A valid exchange ticket is required.' });
    }

    const ticket = service.consumeExchangeTicket(request.body.ticket);
    if (!ticket) {
      return response.status(410).json({ error: 'The Google sign-in ticket is invalid or expired.' });
    }

    try {
      const result = await withAccountOperationLock(ticket.userId, async () => {
        const user = await findUserById(ticket.userId);
        if (!user
            || user.deleting
            || currentTokenVersion(user) !== ticket.tokenVersion
            || user.googleSubject !== ticket.googleSubject
            || (ticket.sessionExpiresAt !== null
              && ticket.sessionExpiresAt * 1000 <= Date.now())) {
          return null;
        }

        if (ticket.intent === 'link') {
          return { linked: true };
        }
        if (ticket.intent !== 'login') {
          return null;
        }

        return {
          user: toPublicUser(user),
          token: createAuthToken(user)
        };
      });
      if (!result) {
        return response.status(410).json({ error: 'The Google sign-in ticket is invalid or expired.' });
      }

      response.set('Cache-Control', 'no-store');
      if (ticket.intent === 'link') {
        return response.json(result);
      }
      return response.json(result);
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

const config = loadGoogleOAuthConfig();
const router = createGoogleOAuthRouter({
  config,
  service: createGoogleOAuthService({ config })
});

module.exports = router;
module.exports.createGoogleOAuthRouter = createGoogleOAuthRouter;
