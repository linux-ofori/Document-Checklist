const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const requireAuth = require('../middleware/authMiddleware');
const {
  createUser,
  deleteUserById,
  findUserByEmail,
  updateUserById,
  toPublicUser
} = require('../models/userModel');

const router = express.Router();
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateCredentials(body, isRegistration) {
  const errors = [];
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';

  if (isRegistration && (name.length < 2 || name.length > 100)) {
    errors.push('Name must be between 2 and 100 characters.');
  }

  if (!emailPattern.test(email) || email.length > 254) {
    errors.push('A valid email address is required.');
  }

  if (password.length < 8 || password.length > 128) {
    errors.push('Password must be between 8 and 128 characters.');
  }

  return { errors, name, email, password };
}

function validateProfileUpdates(body) {
  const errors = [];
  const updates = {};
  const allowedFields = ['name', 'email'];

  if (Object.keys(body).length === 0) {
    errors.push('At least one profile field must be provided.');
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

  return { errors, updates };
}

function createToken(user) {
  return jwt.sign({}, process.env.JWT_SECRET, {
    subject: String(user._id),
    expiresIn: process.env.JWT_EXPIRES_IN || '1d'
  });
}

router.post('/register', async (request, response, next) => {
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
      password: passwordHash
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

router.post('/login', async (request, response, next) => {
  try {
    const credentials = validateCredentials(request.body || {}, false);

    if (credentials.errors.length > 0) {
      return response.status(400).json({ error: 'Validation failed.', details: credentials.errors });
    }

    const user = await findUserByEmail(credentials.email);
    const passwordMatches = user && await bcrypt.compare(credentials.password, user.password);

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

router.put('/me', requireAuth, async (request, response, next) => {
  try {
    const profile = validateProfileUpdates(request.body || {});

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

router.delete('/me', requireAuth, async (request, response, next) => {
  try {
    const deleted = await deleteUserById(request.user.id);
    if (!deleted) {
      return response.status(404).json({ error: 'The authenticated user no longer exists.' });
    }

    return response.json({ message: 'Account deleted successfully.' });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
