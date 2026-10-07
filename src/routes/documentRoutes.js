const express = require('express');
const requireAuth = require('../middleware/authMiddleware');
const withAccountOperationLock = require('../models/accountOperationLock');
const { findUserById } = require('../models/userModel');
const {
  createDocument,
  deleteDocumentById,
  findDocumentById,
  findDocumentsByOwnerId,
  toPublicDocument,
  updateDocumentById
} = require('../models/documentModel');

const router = express.Router();
const documentTypes = new Set([
  'identity-card',
  'photograph',
  'birth-certificate',
  'application-form',
  'proof-of-address',
  'supporting-document',
  'fee-receipt',
  'business-registration-certificate',
  'company-constitution',
  'tax-clearance',
  'bank-statement',
  'medical-report',
  'drivers-licence',
  'test-results',
  'transcript',
  'recommendation-letter',
  'old-passport',
  'police-clearance',
  'marriage-certificate',
  'other'
]);
const documentStatuses = new Set(['verified', 'in-review', 'expiring', 'expired', 'draft']);
const allowedFields = ['name', 'completed', 'documentType', 'status', 'applicationId', 'expiresAt', 'note'];
const documentIdPattern = /^[a-z0-9]{16}$/i;
const applicationIdPattern = /^[a-z0-9][a-z0-9-]{0,63}$/i;
const isoDateTimePattern = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2}))?$/;
const maximumNoteLength = 2000;

function normalizeDateTime(value) {
  if (typeof value !== 'string' || !isoDateTimePattern.test(value)) {
    return null;
  }

  const datePart = value.slice(0, 10);
  const calendarDate = new Date(`${datePart}T00:00:00.000Z`);
  const parsedDate = new Date(value);
  if (!Number.isFinite(parsedDate.getTime())
      || !Number.isFinite(calendarDate.getTime())
      || calendarDate.toISOString().slice(0, 10) !== datePart) {
    return null;
  }

  return parsedDate.toISOString();
}

function validateDocumentInput(body, isUpdate) {
  const errors = [];
  const updates = {};

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { errors: ['A JSON object is required.'], updates };
  }

  const fields = Object.keys(body);

  if (isUpdate && fields.length === 0) {
    errors.push('At least one document field must be provided.');
  }

  for (const field of fields) {
    if (!allowedFields.includes(field)) {
      errors.push(`The ${field} field cannot be set.`);
    }
  }

  if (Object.prototype.hasOwnProperty.call(body, 'name')) {
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (name.length < 1 || name.length > 150) {
      errors.push('Document name must be between 1 and 150 characters.');
    } else {
      updates.name = name;
    }
  } else if (!isUpdate) {
    errors.push('Document name is required.');
  }

  if (Object.prototype.hasOwnProperty.call(body, 'completed')) {
    if (typeof body.completed !== 'boolean') {
      errors.push('Completed must be a boolean.');
    } else {
      updates.completed = body.completed;
    }
  }

  if (Object.prototype.hasOwnProperty.call(body, 'documentType')) {
    if (body.documentType === null) {
      updates.documentType = null;
    } else if (typeof body.documentType !== 'string' || !documentTypes.has(body.documentType)) {
      errors.push('Document type must be one of the supported document types.');
    } else {
      updates.documentType = body.documentType;
    }
  }

  if (Object.prototype.hasOwnProperty.call(body, 'status')) {
    if (typeof body.status !== 'string' || !documentStatuses.has(body.status)) {
      errors.push('Document status must be one of the supported statuses.');
    } else {
      updates.status = body.status;
    }
  }

  if (Object.prototype.hasOwnProperty.call(body, 'applicationId')) {
    if (body.applicationId === null) {
      updates.applicationId = null;
    } else if (typeof body.applicationId !== 'string' || !applicationIdPattern.test(body.applicationId)) {
      errors.push('Application ID must be a valid identifier or null.');
    } else {
      updates.applicationId = body.applicationId;
    }
  }

  if (Object.prototype.hasOwnProperty.call(body, 'expiresAt')) {
    if (body.expiresAt === null) {
      updates.expiresAt = null;
    } else {
      const expiresAt = normalizeDateTime(body.expiresAt);
      if (expiresAt === null) {
        errors.push('Expiry date must be a valid ISO date or date-time.');
      } else {
        updates.expiresAt = expiresAt;
      }
    }
  }

  if (Object.prototype.hasOwnProperty.call(body, 'note')) {
    if (body.note === null) {
      updates.note = null;
    } else if (typeof body.note !== 'string' || body.note.length > maximumNoteLength) {
      errors.push(`Note must be plain text no longer than ${maximumNoteLength} characters, or null.`);
    } else {
      updates.note = body.note.trim();
    }
  }

  return { errors, updates };
}

function hasValidDocumentId(id) {
  return documentIdPattern.test(id);
}

router.use(requireAuth);

router.post('/', async (request, response, next) => {
  try {
    const input = validateDocumentInput(request.body, false);

    if (input.errors.length > 0) {
      return response.status(400).json({ error: 'Validation failed.', details: input.errors });
    }

    const document = await withAccountOperationLock(request.user.id, async () => {
      const owner = await findUserById(request.user.id);
      if (!owner || owner.deleting) {
        return null;
      }

      return createDocument({
        ownerId: request.user.id,
        name: input.updates.name,
        completed: input.updates.completed === undefined ? false : input.updates.completed,
        documentType: input.updates.documentType,
        status: input.updates.status,
        applicationId: input.updates.applicationId,
        expiresAt: input.updates.expiresAt,
        note: input.updates.note
      });
    });

    if (!document) {
      return response.status(401).json({ error: 'The authenticated user no longer exists.' });
    }

    return response.status(201).json({ document: toPublicDocument(document) });
  } catch (error) {
    return next(error);
  }
});

router.get('/', async (request, response, next) => {
  try {
    const documents = await findDocumentsByOwnerId(request.user.id);
    return response.json({ documents: documents.map(toPublicDocument) });
  } catch (error) {
    return next(error);
  }
});

router.get('/:id', async (request, response, next) => {
  try {
    if (!hasValidDocumentId(request.params.id)) {
      return response.status(400).json({ error: 'Invalid document ID.' });
    }

    const document = await findDocumentById(request.params.id, request.user.id);
    if (!document) {
      return response.status(404).json({ error: 'Document not found.' });
    }

    return response.json({ document: toPublicDocument(document) });
  } catch (error) {
    return next(error);
  }
});

router.put('/:id', async (request, response, next) => {
  try {
    if (!hasValidDocumentId(request.params.id)) {
      return response.status(400).json({ error: 'Invalid document ID.' });
    }

    const input = validateDocumentInput(request.body, true);
    if (input.errors.length > 0) {
      return response.status(400).json({ error: 'Validation failed.', details: input.errors });
    }

    const document = await updateDocumentById(request.params.id, request.user.id, input.updates);
    if (!document) {
      return response.status(404).json({ error: 'Document not found.' });
    }

    return response.json({ document: toPublicDocument(document) });
  } catch (error) {
    return next(error);
  }
});

router.delete('/:id', async (request, response, next) => {
  try {
    if (!hasValidDocumentId(request.params.id)) {
      return response.status(400).json({ error: 'Invalid document ID.' });
    }

    const deleted = await deleteDocumentById(request.params.id, request.user.id);
    if (!deleted) {
      return response.status(404).json({ error: 'Document not found.' });
    }

    return response.json({ message: 'Document deleted successfully.' });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;