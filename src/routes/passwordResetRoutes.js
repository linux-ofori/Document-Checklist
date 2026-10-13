const bcrypt = require('bcryptjs');
const express = require('express');
const { rateLimit } = require('express-rate-limit');
const {
  activatePasswordResetChallenge,
  consumePasswordResetChallenge,
  findUserByEmail,
  invalidatePasswordResetChallenge,
  issuePasswordResetChallenge
} = require('../models/userModel');
const { createChallengeToken, hashChallengeToken } = require('../services/challengeToken');

const PASSWORD_RESET_TTL_MS = 30 * 60 * 1000;
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const genericRequestMessage =
  'If an eligible account exists and email delivery is available, password reset instructions will be sent.';
const genericFailureMessage = 'Password reset is temporarily unavailable. Please try again later.';
const invalidTokenMessage = 'The password reset token is invalid or expired.';

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

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactBody(body, fields) {
  return isPlainObject(body)
    && Object.keys(body).length === fields.length
    && fields.every((field) => Object.prototype.hasOwnProperty.call(body, field));
}

function createPasswordResetRouter({
  emailService,
  frontendPasswordResetUrl,
  createToken = createChallengeToken,
  issueChallenge = issuePasswordResetChallenge,
  activateChallenge = activatePasswordResetChallenge,
  invalidateChallenge = invalidatePasswordResetChallenge,
  now = Date.now
} = {}) {
  if (!emailService || typeof emailService.sendEmail !== 'function') {
    throw new TypeError('An email service is required for password reset routes.');
  }
  if (emailService.enabled !== false && typeof frontendPasswordResetUrl !== 'string') {
    throw new TypeError('A frontend password reset URL is required for password reset routes.');
  }

  const resetUrl = typeof frontendPasswordResetUrl === 'string'
    ? new URL(frontendPasswordResetUrl)
    : null;
  const router = express.Router();
  const requestRateLimit = rateLimit({
    windowMs: positiveIntegerEnvironmentValue(
      'PASSWORD_RESET_REQUEST_RATE_LIMIT_WINDOW_MS',
      15 * 60 * 1000
    ),
    limit: positiveIntegerEnvironmentValue('PASSWORD_RESET_REQUEST_RATE_LIMIT_MAX', 5),
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_request, response) => response.status(429).json({
      error: 'Too many password reset requests. Please try again later.'
    })
  });
  const confirmRateLimit = rateLimit({
    windowMs: positiveIntegerEnvironmentValue(
      'PASSWORD_RESET_CONFIRM_RATE_LIMIT_WINDOW_MS',
      15 * 60 * 1000
    ),
    limit: positiveIntegerEnvironmentValue('PASSWORD_RESET_CONFIRM_RATE_LIMIT_MAX', 10),
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_request, response) => response.status(429).json({
      error: 'Too many password reset attempts. Please try again later.'
    })
  });

  async function invalidateChallengeAfterDeliveryFailure(userId, tokenHash) {
    try {
      await invalidateChallenge(userId, tokenHash);
    } catch {
      console.error('Password reset challenge invalidation failed after email delivery failure.');
    }
  }

  async function activateChallengeAfterDelivery(userId, tokenHash) {
    try {
      if (await activateChallenge(userId, tokenHash, now())) {
        return true;
      }
    } catch {
      console.error('Password reset challenge activation failed after email delivery.');
      return false;
    }

    console.error('Password reset challenge activation was not applied after email delivery.');
    return false;
  }

  router.post('/password-reset/request', requestRateLimit, async (request, response, next) => {
    if (!exactBody(request.body, ['email'])
        || typeof request.body.email !== 'string'
        || !emailPattern.test(request.body.email.trim())
        || request.body.email.trim().length > 254) {
      return response.status(400).json({ error: 'A valid email address is required.' });
    }

    try {
      if (emailService.enabled === false) {
        return response.status(503).json({ error: genericFailureMessage });
      }

      const email = request.body.email.trim().toLowerCase();
      const user = await findUserByEmail(email);
      if (!user || user.deleting || !user.emailVerifiedAt || typeof user.password !== 'string') {
        return response.status(200).json({ message: genericRequestMessage });
      }

      let challenge;
      let issued;
      try {
        challenge = createToken();
        const expiresAt = now() + PASSWORD_RESET_TTL_MS;
        issued = await issueChallenge(user._id, challenge.tokenHash, expiresAt);
      } catch {
        console.error('Password reset challenge could not be prepared.');
        return response.status(200).json({ message: genericRequestMessage });
      }
      if (!issued) {
        return response.status(200).json({ message: genericRequestMessage });
      }

      const link = new URL(resetUrl);
      link.searchParams.set('token', challenge.token);

      let delivery;
      try {
        delivery = await emailService.sendEmail({
          to: user.email,
          subject: 'Reset your Document Checklist password',
          text: `Reset your password by opening this link: ${link.toString()}`
        });
      } catch {
        await invalidateChallengeAfterDeliveryFailure(user._id, challenge.tokenHash);
        console.error('Password reset email delivery failed.');
        return response.status(200).json({ message: genericRequestMessage });
      }

      if (delivery?.delivered !== true) {
        await invalidateChallengeAfterDeliveryFailure(user._id, challenge.tokenHash);
        console.error('Password reset email delivery was unavailable.');
        return response.status(200).json({ message: genericRequestMessage });
      }

      await activateChallengeAfterDelivery(user._id, challenge.tokenHash);
      return response.status(200).json({ message: genericRequestMessage });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/password-reset/confirm', confirmRateLimit, async (request, response, next) => {
    if (!exactBody(request.body, ['token', 'password'])
        || typeof request.body.token !== 'string'
        || !tokenPattern.test(request.body.token)
        || typeof request.body.password !== 'string'
        || request.body.password.length < 8
        || request.body.password.length > 128
        || bcrypt.truncates(request.body.password)) {
      return response.status(400).json({
        error: 'Validation failed.',
        details: ['A valid token and password between 8 and 128 characters (at most 72 UTF-8 bytes) are required.']
      });
    }

    try {
      const passwordHash = await bcrypt.hash(request.body.password, 12);
      const updatedUser = await consumePasswordResetChallenge(
        hashChallengeToken(request.body.token),
        passwordHash,
        now()
      );
      if (!updatedUser) {
        return response.status(400).json({ error: invalidTokenMessage });
      }
      return response.json({ message: 'Password reset successfully.' });
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

module.exports = { createPasswordResetRouter };
