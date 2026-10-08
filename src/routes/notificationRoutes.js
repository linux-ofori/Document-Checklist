const express = require('express');
const requireAuth = require('../middleware/authMiddleware');
const {
  listNotifications,
  markAllAsRead,
  markNotificationAsRead
} = require('../services/notificationService');

const router = express.Router();
const notificationIdPattern = /^[a-z0-9]{16}$/i;

function validateEmptyBody(body) {
  if (body === undefined) {
    return [];
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return ['A JSON object is required.'];
  }

  return Object.keys(body).map((field) => `The ${field} field cannot be set.`);
}

router.use(requireAuth);

router.get('/', async (request, response, next) => {
  try {
    const notifications = await listNotifications(request.user.id);
    return response.json({ notifications });
  } catch (error) {
    return next(error);
  }
});

router.patch('/:id/read', async (request, response, next) => {
  try {
    if (!notificationIdPattern.test(request.params.id)) {
      return response.status(400).json({ error: 'Invalid notification ID.' });
    }

    const errors = validateEmptyBody(request.body);
    if (errors.length > 0) {
      return response.status(400).json({ error: 'Validation failed.', details: errors });
    }

    const notification = await markNotificationAsRead(request.user.id, request.params.id);
    if (!notification) {
      return response.status(404).json({ error: 'Notification not found.' });
    }

    return response.json({ notification });
  } catch (error) {
    return next(error);
  }
});

router.post('/read-all', async (request, response, next) => {
  try {
    const errors = validateEmptyBody(request.body);
    if (errors.length > 0) {
      return response.status(400).json({ error: 'Validation failed.', details: errors });
    }

    const updatedCount = await markAllAsRead(request.user.id);
    return response.json({ updatedCount });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
