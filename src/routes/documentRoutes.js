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
const allowedFields = ['name', 'completed'];
const documentIdPattern = /^[a-z0-9]{16}$/i;

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
        completed: input.updates.completed === undefined ? false : input.updates.completed
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