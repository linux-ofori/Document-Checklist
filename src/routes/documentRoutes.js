const express = require('express');
const multer = require('multer');
const requireAuth = require('../middleware/authMiddleware');
const withAccountOperationLock = require('../models/accountOperationLock');
const { findUserById } = require('../models/userModel');
const {
  removeStoredFile,
  storeUploadedFile,
  validateUploadedFile
} = require('../config/fileStorage');
const {
  findApplicationById,
  findDocumentRequirementReferences,
  clearDocumentRequirementReferences
} = require('../models/applicationModel');
const {
  createDocument,
  deleteDocumentById,
  findDocumentById,
  findDocumentsByOwnerId,
  toPublicDocument,
  updateDocumentById
} = require('../models/documentModel');

const router = express.Router();
const multipartParser = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024,
    files: 1,
    fields: 7,
    parts: 8,
    fieldNameSize: 100,
    fieldSize: 10 * 1024
  }
});
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
const applicationIdPattern = /^app-[a-z0-9][a-z0-9-]{0,59}$/i;
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

function parseMultipartDocument(request, response, next) {
  if (!request.is('multipart/form-data')) {
    return next();
  }

  return multipartParser.single('file')(request, response, (error) => {
    if (!error) {
      return next();
    }

    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
      return response.status(413).json({ error: 'Uploaded file exceeds the 5 MiB limit.' });
    }
    if (error instanceof multer.MulterError) {
      return response.status(400).json({
        error: 'Validation failed.',
        details: ['Multipart request contains too many files, fields, or oversized fields.']
      });
    }

    return response.status(400).json({
      error: 'Validation failed.',
      details: ['Multipart request is malformed.']
    });
  });
}

router.use(requireAuth);

router.post('/', parseMultipartDocument, async (request, response, next) => {
  try {
    const isMultipart = request.is('multipart/form-data');
    if (isMultipart && !request.file) {
      return response.status(400).json({
        error: 'Validation failed.',
        details: ['Exactly one file is required for multipart document creation.']
      });
    }

    const body = { ...(request.body || {}) };
    if (isMultipart && Object.hasOwn(body, 'completed')) {
      if (body.completed === 'true') {
        body.completed = true;
      } else if (body.completed === 'false') {
        body.completed = false;
      }
    }
    const input = validateDocumentInput(body, false);

    if (input.errors.length > 0) {
      return response.status(400).json({ error: 'Validation failed.', details: input.errors });
    }

    let validatedFile;
    if (request.file) {
      validatedFile = validateUploadedFile(request.file);
      if (validatedFile.error) {
        return response.status(400).json({
          error: 'Validation failed.',
          details: [validatedFile.error]
        });
      }
    }

    const result = await withAccountOperationLock(request.user.id, async () => {
      const owner = await findUserById(request.user.id);
      if (!owner || owner.deleting) {
        return { kind: 'missing-owner' };
      }

      if (input.updates.applicationId) {
        const application = await findApplicationById(input.updates.applicationId, request.user.id);
        if (!application) {
          return { kind: 'missing-application' };
        }
      }

      const fileMetadata = request.file
        ? {
          fileName: validatedFile.fileName,
          fileSizeKb: Math.ceil(request.file.size / 1024),
          uploadedAt: new Date().toISOString()
        }
        : null;
      const storageKey = request.file
        ? await storeUploadedFile(request.file.buffer, validatedFile.extension)
        : null;

      let document;
      try {
        document = await createDocument({
          ownerId: request.user.id,
          name: input.updates.name,
          completed: input.updates.completed === undefined ? false : input.updates.completed,
          documentType: input.updates.documentType,
          status: input.updates.status,
          applicationId: input.updates.applicationId,
          expiresAt: input.updates.expiresAt,
          note: input.updates.note,
          fileMetadata: storageKey ? { ...fileMetadata, storageKey } : undefined
        });
      } catch (error) {
        if (storageKey) {
          try {
            await removeStoredFile(storageKey);
          } catch (cleanupError) {
            console.error('Unable to remove uploaded file after document creation failed.', cleanupError);
          }
        }
        throw error;
      }
      return { kind: 'created', document };
    });

    if (result.kind === 'missing-owner') {
      return response.status(401).json({ error: 'The authenticated user no longer exists.' });
    }
    if (result.kind === 'missing-application') {
      return response.status(404).json({ error: 'Application not found.' });
    }

    return response.status(201).json({ document: toPublicDocument(result.document) });
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

    const result = await withAccountOperationLock(request.user.id, async () => {
      const owner = await findUserById(request.user.id);
      if (!owner || owner.deleting) {
        return { kind: 'missing-owner' };
      }

      const currentDocument = await findDocumentById(request.params.id, request.user.id);
      if (!currentDocument) {
        return { kind: 'missing-document' };
      }

      if (Object.hasOwn(input.updates, 'applicationId')
          || Object.hasOwn(input.updates, 'documentType')) {
        const requirementReferences = await findDocumentRequirementReferences(
          request.user.id,
          request.params.id
        );
        const applicationId = Object.hasOwn(input.updates, 'applicationId')
          ? input.updates.applicationId
          : currentDocument.applicationId;
        const documentType = Object.hasOwn(input.updates, 'documentType')
          ? input.updates.documentType
          : currentDocument.documentType;
        if (requirementReferences.some((reference) =>
          reference.applicationId !== applicationId || reference.documentType !== documentType)) {
          return { kind: 'invalid-requirement-reference' };
        }
      }

      if (input.updates.applicationId) {
        const application = await findApplicationById(input.updates.applicationId, request.user.id);
        if (!application) {
          return { kind: 'missing-application' };
        }
      }

      const document = await updateDocumentById(request.params.id, request.user.id, input.updates);
      return document ? { kind: 'updated', document } : { kind: 'missing-document' };
    });

    if (result.kind === 'missing-owner') {
      return response.status(401).json({ error: 'The authenticated user no longer exists.' });
    }
    if (result.kind === 'missing-application') {
      return response.status(404).json({ error: 'Application not found.' });
    }
    if (result.kind === 'invalid-requirement-reference') {
      return response.status(400).json({
        error: 'Validation failed.',
        details: ['Document type and application cannot be changed while the document is linked to a requirement.']
      });
    }
    if (result.kind === 'missing-document') {
      return response.status(404).json({ error: 'Document not found.' });
    }

    return response.json({ document: toPublicDocument(result.document) });
  } catch (error) {
    return next(error);
  }
});

router.delete('/:id', async (request, response, next) => {
  try {
    if (!hasValidDocumentId(request.params.id)) {
      return response.status(400).json({ error: 'Invalid document ID.' });
    }

    const deleted = await withAccountOperationLock(request.user.id, async () => {
      const document = await findDocumentById(request.params.id, request.user.id);
      if (!document) {
        return false;
      }

      if (document.storageKey) {
        await removeStoredFile(document.storageKey);
      }
      await clearDocumentRequirementReferences(request.user.id, request.params.id);
      return deleteDocumentById(request.params.id, request.user.id);
    });
    if (!deleted) {
      return response.status(404).json({ error: 'Document not found.' });
    }

    return response.json({ message: 'Document deleted successfully.' });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;