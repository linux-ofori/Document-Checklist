const express = require('express');
const requireAuth = require('../middleware/authMiddleware');
const withAccountOperationLock = require('../models/accountOperationLock');
const { findUserById } = require('../models/userModel');
const { findDocumentById } = require('../models/documentModel');
const {
  createApplication,
  findApplicationById,
  findApplicationsByOwnerId,
  toPublicApplication,
  updateApplicationRequirements
} = require('../models/applicationModel');
const { getProcess } = require('../config/processCatalog');
const {
  createRequirementCompletionNotification,
  toPublicNotification
} = require('../services/notificationService');

const router = express.Router();
const applicationIdPattern = /^app-[a-z0-9][a-z0-9-]{0,59}$/i;
const documentIdPattern = /^[a-z0-9]{16}$/i;
const requirementStatuses = new Set(['completed', 'in-progress', 'missing']);

function hasValidApplicationId(id) {
  return applicationIdPattern.test(id);
}

function hasProtectedDetailField(value) {
  if (Array.isArray(value)) {
    return value.some(hasProtectedDetailField);
  }
  if (!value || typeof value !== 'object') {
    return false;
  }

  return Object.entries(value).some(([key, nestedValue]) =>
    ['id', '_id', 'ownerId', '__proto__', 'constructor', 'prototype'].includes(key)
    || hasProtectedDetailField(nestedValue));
}

function validateApplicationInput(body) {
  const errors = [];
  const allowedFields = ['processId', 'name', 'details'];

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { errors: ['A JSON object is required.'], input: null };
  }

  for (const field of Object.keys(body)) {
    if (!allowedFields.includes(field)) {
      errors.push(`The ${field} field cannot be set.`);
    }
  }

  const processId = typeof body.processId === 'string' ? body.processId : '';
  const process = getProcess(processId);
  if (!process) {
    errors.push('A valid process ID is required.');
  }

  let name;
  if (Object.prototype.hasOwnProperty.call(body, 'name')) {
    name = typeof body.name === 'string' ? body.name.trim() : '';
    if (name.length < 1 || name.length > 150) {
      errors.push('Application name must be between 1 and 150 characters.');
    }
  }

  let details = {};
  if (Object.prototype.hasOwnProperty.call(body, 'details')) {
    if (!body.details || typeof body.details !== 'object' || Array.isArray(body.details)) {
      errors.push('Application details must be a JSON object.');
    } else if (hasProtectedDetailField(body.details)) {
      errors.push('Application details cannot contain protected fields.');
    } else {
      details = body.details;
    }
  }

  return { errors, input: { processId, name, details } };
}

function validateRequirementInput(body) {
  const errors = [];
  const allowedFields = ['status', 'documentId'];

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { errors: ['A JSON object is required.'], input: null };
  }

  for (const field of Object.keys(body)) {
    if (!allowedFields.includes(field)) {
      errors.push(`The ${field} field cannot be set.`);
    }
  }

  if (!requirementStatuses.has(body.status)) {
    errors.push('Requirement status must be completed, in-progress, or missing.');
  }

  let documentId;
  let hasDocumentId = false;
  if (Object.prototype.hasOwnProperty.call(body, 'documentId')) {
    hasDocumentId = true;
    if (body.documentId === null) {
      documentId = null;
    } else if (typeof body.documentId !== 'string' || !documentIdPattern.test(body.documentId)) {
      errors.push('Document ID must be a valid document ID or null.');
    } else {
      documentId = body.documentId;
    }
  }

  return { errors, input: { status: body.status, documentId, hasDocumentId } };
}

router.use(requireAuth);

router.post('/', async (request, response, next) => {
  try {
    const validation = validateApplicationInput(request.body);
    if (validation.errors.length > 0) {
      return response.status(400).json({ error: 'Validation failed.', details: validation.errors });
    }

    const application = await withAccountOperationLock(request.user.id, async () => {
      const owner = await findUserById(request.user.id);
      if (!owner || owner.deleting) {
        return null;
      }

      return createApplication({
        ownerId: request.user.id,
        ...validation.input
      });
    });

    if (!application) {
      return response.status(401).json({ error: 'The authenticated user no longer exists.' });
    }

    return response.status(201).json({ application: toPublicApplication(application) });
  } catch (error) {
    return next(error);
  }
});

router.get('/', async (request, response, next) => {
  try {
    const applications = await findApplicationsByOwnerId(request.user.id);
    return response.json({ applications: applications.map(toPublicApplication) });
  } catch (error) {
    return next(error);
  }
});

router.get('/:id', async (request, response, next) => {
  try {
    if (!hasValidApplicationId(request.params.id)) {
      return response.status(400).json({ error: 'Invalid application ID.' });
    }

    const application = await findApplicationById(request.params.id, request.user.id);
    if (!application) {
      return response.status(404).json({ error: 'Application not found.' });
    }

    return response.json({ application: toPublicApplication(application) });
  } catch (error) {
    return next(error);
  }
});

router.patch('/:id/requirements/:key', async (request, response, next) => {
  try {
    if (!hasValidApplicationId(request.params.id)) {
      return response.status(400).json({ error: 'Invalid application ID.' });
    }

    const validation = validateRequirementInput(request.body);
    if (validation.errors.length > 0) {
      return response.status(400).json({ error: 'Validation failed.', details: validation.errors });
    }

    const result = await withAccountOperationLock(request.user.id, async () => {
      const owner = await findUserById(request.user.id);
      if (!owner || owner.deleting) {
        return { kind: 'missing-owner' };
      }

      const application = await findApplicationById(request.params.id, request.user.id);
      if (!application) {
        return { kind: 'missing-application' };
      }

      const process = getProcess(application.processId);
      const definition = process.requirements.find((requirement) => requirement.key === request.params.key);
      if (!definition) {
        return { kind: 'missing-requirement' };
      }

      const current = application.requirements.find((requirement) => requirement.key === definition.key);
      const previousStatus = current ? current.status : 'missing';
      const { status, documentId, hasDocumentId } = validation.input;
      let linkedDocumentId = current ? current.documentId : null;

      if (hasDocumentId) {
        if (documentId === null) {
          linkedDocumentId = null;
        } else {
          const document = await findDocumentById(documentId, request.user.id);
          if (!document) {
            return { kind: 'missing-document' };
          }
          if (document.applicationId !== application._id) {
            return { kind: 'document-application-mismatch' };
          }
          if (document.documentType !== definition.type) {
            return { kind: 'document-type-mismatch' };
          }
          linkedDocumentId = documentId;
        }
      }

      const completedAt = status === 'completed'
        ? (current && current.status === 'completed' && current.completedAt
          ? current.completedAt
          : new Date().toISOString())
        : null;
      const requirements = application.requirements.map((requirement) =>
        requirement.key === definition.key
          ? { key: requirement.key, status, documentId: linkedDocumentId, completedAt }
          : requirement);
      const updated = await updateApplicationRequirements(
        application._id,
        request.user.id,
        requirements
      );

      if (!updated) {
        return { kind: 'missing-application' };
      }

      let notification;
      if ((previousStatus === 'missing' || previousStatus === 'in-progress') && status === 'completed') {
        try {
          notification = toPublicNotification(await createRequirementCompletionNotification({
            ownerId: request.user.id,
            application,
            requirement: definition,
            documentId: linkedDocumentId
          }));
        } catch (error) {
          console.error('Unable to persist application completion notification.', error);
        }
      }

      return { kind: 'updated', application: updated, notification };
    });

    if (result.kind === 'missing-owner') {
      return response.status(401).json({ error: 'The authenticated user no longer exists.' });
    }
    if (result.kind === 'missing-application') {
      return response.status(404).json({ error: 'Application not found.' });
    }
    if (result.kind === 'missing-requirement') {
      return response.status(404).json({ error: 'Requirement not found.' });
    }
    if (result.kind === 'missing-document') {
      return response.status(404).json({ error: 'Document not found.' });
    }
    if (result.kind === 'document-application-mismatch') {
      return response.status(400).json({
        error: 'Validation failed.',
        details: ['Document must belong to this application.']
      });
    }
    if (result.kind === 'document-type-mismatch') {
      return response.status(400).json({
        error: 'Validation failed.',
        details: ['Document type must match the requirement type.']
      });
    }

    const payload = { application: toPublicApplication(result.application) };
    if (result.notification) {
      payload.notification = result.notification;
    }
    return response.json(payload);
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
