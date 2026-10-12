const express = require('express');
const { rateLimit } = require('express-rate-limit');
const requireAuth = require('../middleware/authMiddleware');
const {
  consumeEmailVerificationChallenge,
  findUserById,
  invalidateEmailVerificationChallenge,
  issueEmailVerificationChallenge
} = require('../models/userModel');
const { createChallengeToken, hashChallengeToken } = require('../services/challengeToken');

const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;

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

function createEmailVerificationRouter({
  emailService,
  frontendVerificationUrl,
  createToken = createChallengeToken,
  now = Date.now
} = {}) {
  if (!emailService || typeof emailService.sendEmail !== 'function') {
    throw new TypeError('An email service is required for email verification routes.');
  }
  if (emailService.enabled !== false && typeof frontendVerificationUrl !== 'string') {
    throw new TypeError('A frontend verification URL is required for email verification routes.');
  }

  const verificationUrl = typeof frontendVerificationUrl === 'string'
    ? new URL(frontendVerificationUrl)
    : null;
  const router = express.Router();
  const requestRateLimit = rateLimit({
    windowMs: positiveIntegerEnvironmentValue(
      'EMAIL_VERIFICATION_REQUEST_RATE_LIMIT_WINDOW_MS',
      15 * 60 * 1000
    ),
    limit: positiveIntegerEnvironmentValue('EMAIL_VERIFICATION_REQUEST_RATE_LIMIT_MAX', 3),
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_request, response) => response.status(429).json({
      error: 'Too many email verification requests. Please try again later.'
    })
  });
  const confirmationRateLimit = rateLimit({
    windowMs: positiveIntegerEnvironmentValue(
      'EMAIL_VERIFICATION_CONFIRM_RATE_LIMIT_WINDOW_MS',
      15 * 60 * 1000
    ),
    limit: positiveIntegerEnvironmentValue('EMAIL_VERIFICATION_CONFIRM_RATE_LIMIT_MAX', 10),
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_request, response) => response.status(429).json({
      error: 'Too many email verification attempts. Please try again later.'
    })
  });

  router.post('/email-verification/request', requestRateLimit, requireAuth, async (request, response, next) => {
    if (request.body !== undefined
        && (!isPlainObject(request.body) || Object.keys(request.body).length > 0)) {
      return response.status(400).json({ error: 'This request does not accept account identifiers.' });
    }

    try {
      const user = await findUserById(request.user.id);
      if (!user || user.deleting) {
        return response.status(404).json({ error: 'The authenticated account is unavailable.' });
      }
      if (user.emailVerifiedAt) {
        return response.json({ verified: true, message: 'This email address is already verified.' });
      }
      if (emailService.enabled === false) {
        return response.status(503).json({
          error: 'Email delivery is unavailable. No verification email was sent.'
        });
      }

      const challenge = createToken();
      const expiresAt = now() + EMAIL_VERIFICATION_TTL_MS;
      const issued = await issueEmailVerificationChallenge(
        user._id,
        challenge.tokenHash,
        expiresAt
      );
      if (!issued) {
        const currentUser = await findUserById(user._id);
        if (currentUser?.emailVerifiedAt) {
          return response.json({ verified: true, message: 'This email address is already verified.' });
        }
        if (!currentUser || currentUser.deleting) {
          return response.status(404).json({ error: 'The authenticated account is unavailable.' });
        }
        return response.status(503).json({ error: 'A verification email could not be prepared. Please retry.' });
      }

      const link = new URL(verificationUrl);
      link.searchParams.set('token', challenge.token);

      let delivery;
      try {
        delivery = await emailService.sendEmail({
          to: user.email,
          subject: 'Verify your Document Checklist email address',
          text: `Verify your email address by opening this link: ${link.toString()}`
        });
      } catch {
        await invalidateEmailVerificationChallenge(user._id, challenge.tokenHash);
        return response.status(503).json({
          error: 'The verification email could not be delivered. Please request a new link.'
        });
      }

      if (delivery?.delivered !== true) {
        await invalidateEmailVerificationChallenge(user._id, challenge.tokenHash);
        return response.status(503).json({
          error: 'Email delivery is unavailable. No verification email was sent.'
        });
      }

      return response.status(202).json({
        verified: false,
        delivered: true,
        message: 'A verification email was sent.'
      });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/email-verification/confirm', confirmationRateLimit, async (request, response, next) => {
    if (!isPlainObject(request.body)
        || Object.keys(request.body).length !== 1
        || typeof request.body.token !== 'string'
        || !tokenPattern.test(request.body.token)) {
      return response.status(400).json({ error: 'The verification token is invalid or expired.' });
    }

    try {
      const tokenHash = hashChallengeToken(request.body.token);
      const user = await consumeEmailVerificationChallenge(tokenHash, now());
      if (!user) {
        return response.status(400).json({ error: 'The verification token is invalid or expired.' });
      }
      return response.json({ verified: true, message: 'Email address verified successfully.' });
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

module.exports = { createEmailVerificationRouter };
