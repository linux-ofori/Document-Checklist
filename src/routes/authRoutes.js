const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { rateLimit } = require('express-rate-limit');
const requireAuth = require('../middleware/authMiddleware');
const withAccountOperationLock = require('../models/accountOperationLock');
const { removeStoredFile } = require('../config/fileStorage');
const { deleteDocumentsByOwnerId, findDocumentsByOwnerId } = require('../models/documentModel');
const { deleteApplicationsByOwnerId } = require('../models/applicationModel');
const { deleteAllNotifications } = require('../services/notificationService');
const {
  createUser,
  changeUserPasswordById,
  deleteUserById,
  findUserByEmail,
  findUserById,
  findUsersPendingDeletion,
  incrementUserTokenVersionById,
  markUserDeletingById,
  updateUserById,
  toPublicUser
} = require('../models/userModel');

const router = express.Router();
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const phonePattern = /^[+()\-\s\d]{7,20}$/;

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

const loginRateLimit = rateLimit({
  windowMs: positiveIntegerEnvironmentValue('LOGIN_RATE_LIMIT_WINDOW_MS', 15 * 60 * 1000),
  limit: positiveIntegerEnvironmentValue('LOGIN_RATE_LIMIT_MAX', 5),
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_request, response) => response.status(429).json({
    error: 'Too many login attempts. Please try again later.'
  })
});

const registrationRateLimit = rateLimit({
  windowMs: positiveIntegerEnvironmentValue('REGISTRATION_RATE_LIMIT_WINDOW_MS', 15 * 60 * 1000),
  limit: positiveIntegerEnvironmentValue('REGISTRATION_RATE_LIMIT_MAX', 5),
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_request, response) => response.status(429).json({
    error: 'Too many registration attempts. Please try again later.'
  })
});

const passwordChangeRateLimit = rateLimit({
  windowMs: positiveIntegerEnvironmentValue('PASSWORD_CHANGE_RATE_LIMIT_WINDOW_MS', 15 * 60 * 1000),
  limit: positiveIntegerEnvironmentValue('PASSWORD_CHANGE_RATE_LIMIT_MAX', 5),
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_request, response) => response.status(429).json({
    error: 'Too many password change attempts. Please try again later.'
  })
});

function validateCredentials(body, isRegistration) {
  const errors = [];
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  let phone = null;

  if (isRegistration && (name.length < 2 || name.length > 100)) {
    errors.push('Name must be between 2 and 100 characters.');
  }

  if (!emailPattern.test(email) || email.length > 254) {
    errors.push('A valid email address is required.');
  }

  if (password.length < 8 || password.length > 128) {
    errors.push('Password must be between 8 and 128 characters.');
  }

  if (bcrypt.truncates(password)) {
    errors.push('Password must not exceed 72 UTF-8 bytes.');
  }

  if (isRegistration && Object.prototype.hasOwnProperty.call(body, 'phone')) {
    if (typeof body.phone !== 'string') {
      errors.push('Phone must be a valid phone number.');
    } else {
      const normalizedPhone = body.phone.trim();
      if (normalizedPhone && !phonePattern.test(normalizedPhone)) {
        errors.push('Phone must be a valid phone number.');
      } else {
        phone = normalizedPhone || null;
      }
    }
  }

  return { errors, name, email, password, phone };
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validateProfileUpdates(body, currentPreferences) {
  const errors = [];
  const updates = {};
  const allowedFields = ['name', 'email', 'phone', 'preferences'];

  if (!isPlainObject(body) || Object.keys(body).length === 0) {
    errors.push('At least one profile field must be provided.');
    return { errors, updates };
  }

  for (const field of Object.keys(body)) {
    if (!allowedFields.includes(field)) {
      errors.push(`The ${field} field cannot be updated.`);
    }
  }

  if (Object.prototype.hasOwnProperty.call(body, 'name')) {
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (name.length < 2 || name.length > 100) {
      errors.push('Name must be between 2 and 100 characters.');
    } else {
      updates.name = name;
    }
  }

  if (Object.prototype.hasOwnProperty.call(body, 'email')) {
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    if (!emailPattern.test(email) || email.length > 254) {
      errors.push('A valid email address is required.');
    } else {
      updates.email = email;
    }
  }

  if (Object.prototype.hasOwnProperty.call(body, 'phone')) {
    if (body.phone === null) {
      updates.phone = null;
    } else if (typeof body.phone !== 'string') {
      errors.push('Phone must be a string or null.');
    } else {
      const phone = body.phone.trim();
      if (phone && !phonePattern.test(phone)) {
        errors.push('Phone must be a valid phone number.');
      } else {
        updates.phone = phone || null;
      }
    }
  }

  if (Object.prototype.hasOwnProperty.call(body, 'preferences')) {
    const preferences = body.preferences;
    if (!isPlainObject(preferences)) {
      errors.push('Preferences must be an object.');
    } else {
      for (const field of Object.keys(preferences)) {
        if (field !== 'notifications') {
          errors.push(`The preferences.${field} field cannot be updated.`);
        }
      }

      if (!Object.prototype.hasOwnProperty.call(preferences, 'notifications')) {
        errors.push('At least one notification preference must be provided.');
      } else if (!isPlainObject(preferences.notifications)) {
        errors.push('Notification preferences must be an object.');
      } else {
        const notificationUpdates = {};
        for (const [field, value] of Object.entries(preferences.notifications)) {
          if (!['documentExpiry', 'applicationUpdates', 'securityAccount'].includes(field)) {
            errors.push(`The notifications.${field} preference is not supported.`);
          } else if (typeof value !== 'boolean') {
            errors.push(`The notifications.${field} preference must be a boolean.`);
          } else if (field === 'securityAccount' && value !== true) {
            errors.push('Security and account notifications cannot be disabled.');
          } else {
            notificationUpdates[field] = value;
          }
        }

        if (Object.keys(notificationUpdates).length === 0) {
          errors.push('At least one notification preference must be provided.');
        } else {
          updates.preferences = {
            notifications: {
              ...currentPreferences.notifications,
              ...notificationUpdates,
              securityAccount: true
            }
          };
        }
      }
    }
  }

  return { errors, updates };
}

function validatePasswordChange(body) {
  const errors = [];
  if (!isPlainObject(body)) {
    return { errors: ['A valid request body is required.'] };
  }

  for (const field of Object.keys(body)) {
    if (!['currentPassword', 'newPassword'].includes(field)) {
      errors.push(`The ${field} field cannot be updated.`);
    }
  }

  const currentPassword = typeof body.currentPassword === 'string' ? body.currentPassword : '';
  const newPassword = typeof body.newPassword === 'string' ? body.newPassword : '';

  if (!currentPassword) {
    errors.push('Current password is required.');
  } else if (bcrypt.truncates(currentPassword)) {
    errors.push('Current password must not exceed 72 UTF-8 bytes.');
  }
  if (newPassword.length < 8 || newPassword.length > 128) {
    errors.push('New password must be between 8 and 128 characters.');
  }
  if (bcrypt.truncates(newPassword)) {
    errors.push('New password must not exceed 72 UTF-8 bytes.');
  }

  return { errors, currentPassword, newPassword };
}

function createToken(user) {
  return jwt.sign(
    { tokenVersion: Number.isSafeInteger(user.tokenVersion) ? user.tokenVersion : 0 },
    process.env.JWT_SECRET,
    {
      subject: String(user._id),
      expiresIn: process.env.JWT_EXPIRES_IN || '1d'
    }
  );
}

async function completeAccountDeletion(userId) {
  const user = await findUserById(userId);
  if (!user) {
    return false;
  }

  if (!user.deleting && !await markUserDeletingById(userId)) {
    return false;
  }

  const documents = await findDocumentsByOwnerId(userId);
  for (const document of documents) {
    if (document.storageKey) {
      await removeStoredFile(document.storageKey);
    }
  }

  await deleteDocumentsByOwnerId(userId);
  await deleteApplicationsByOwnerId(userId);
  await deleteAllNotifications(userId);
  return deleteUserById(userId);
}

async function recoverPendingAccountDeletions() {
  const pendingUsers = await findUsersPendingDeletion();
  for (const user of pendingUsers) {
    await withAccountOperationLock(user._id, () => completeAccountDeletion(user._id));
  }
}

router.post('/register', registrationRateLimit, async (request, response, next) => {
  try {
    const credentials = validateCredentials(request.body || {}, true);

    if (credentials.errors.length > 0) {
      return response.status(400).json({ error: 'Validation failed.', details: credentials.errors });
    }

    if (await findUserByEmail(credentials.email)) {
      return response.status(409).json({ error: 'An account with that email already exists.' });
    }

    const passwordHash = await bcrypt.hash(credentials.password, 12);
    const user = await createUser({
      name: credentials.name,
      email: credentials.email,
      password: passwordHash,
      phone: credentials.phone
    });

    return response.status(201).json({
      user: toPublicUser(user),
      token: createToken(user)
    });
  } catch (error) {
    if (error.errorType === 'uniqueViolated') {
      return response.status(409).json({ error: 'An account with that email already exists.' });
    }

    return next(error);
  }
});

router.post('/login', loginRateLimit, async (request, response, next) => {
  try {
    const credentials = validateCredentials(request.body || {}, false);

    if (credentials.errors.length > 0) {
      return response.status(400).json({ error: 'Validation failed.', details: credentials.errors });
    }

    const user = await findUserByEmail(credentials.email);
    const passwordMatches = user && !user.deleting
      && await bcrypt.compare(credentials.password, user.password);

    if (!passwordMatches) {
      return response.status(401).json({ error: 'Invalid email or password.' });
    }

    return response.json({
      user: toPublicUser(user),
      token: createToken(user)
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/me', requireAuth, (request, response) => {
  return response.json({ user: request.user });
});

router.post('/logout', requireAuth, async (request, response, next) => {
  try {
    const user = await incrementUserTokenVersionById(request.user.id);
    if (!user) {
      return response.status(404).json({ error: 'The authenticated user no longer exists.' });
    }

    return response.json({ message: 'Logged out successfully.' });
  } catch (error) {
    return next(error);
  }
});

router.put('/me', requireAuth, async (request, response, next) => {
  try {
    const profile = validateProfileUpdates(request.body || {}, request.user.preferences);

    if (profile.errors.length > 0) {
      return response.status(400).json({ error: 'Validation failed.', details: profile.errors });
    }

    if (profile.updates.email) {
      const existingUser = await findUserByEmail(profile.updates.email);
      if (existingUser && existingUser._id !== request.user.id) {
        return response.status(409).json({ error: 'An account with that email already exists.' });
      }
    }

    const user = await updateUserById(request.user.id, profile.updates);
    if (!user) {
      return response.status(404).json({ error: 'The authenticated user no longer exists.' });
    }

    return response.json({ user: toPublicUser(user) });
  } catch (error) {
    if (error.errorType === 'uniqueViolated') {
      return response.status(409).json({ error: 'An account with that email already exists.' });
    }

    return next(error);
  }
});

router.post('/change-password', passwordChangeRateLimit, requireAuth, async (request, response, next) => {
  try {
    const passwordChange = validatePasswordChange(request.body);
    if (passwordChange.errors.length > 0) {
      return response.status(400).json({
        error: 'Validation failed.',
        details: passwordChange.errors
      });
    }

    const user = await findUserById(request.user.id);
    if (!user || user.deleting || !await bcrypt.compare(passwordChange.currentPassword, user.password)) {
      return response.status(401).json({ error: 'Current password is incorrect or account is unavailable.' });
    }

    const newPasswordHash = await bcrypt.hash(passwordChange.newPassword, 12);
    const updatedUser = await changeUserPasswordById(
      request.user.id,
      user.password,
      newPasswordHash
    );
    if (!updatedUser) {
      return response.status(401).json({ error: 'Current password is incorrect or account is unavailable.' });
    }

    return response.json({
      user: toPublicUser(updatedUser),
      token: createToken(updatedUser)
    });
  } catch (error) {
    return next(error);
  }
});

router.delete('/me', requireAuth.allowDeletingAccount, async (request, response, next) => {
  try {
    const deleted = await withAccountOperationLock(
      request.user.id,
      () => completeAccountDeletion(request.user.id)
    );
    if (!deleted) {
      return response.status(404).json({ error: 'The authenticated user no longer exists.' });
    }

    return response.json({ message: 'Account deleted successfully.' });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
module.exports.recoverPendingAccountDeletions = recoverPendingAccountDeletions;
