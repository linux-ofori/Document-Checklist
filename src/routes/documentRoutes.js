const express = require('express');
const multer = require('multer');
const requireAuth = require('../middleware/authMiddleware');
const withAccountOperationLock = require('../models/accountOperationLock');
const { findUserById } = require('../models/userModel');
const {
  readStoredFile,
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
  findDocumentsPendingDeletion,
  findDocumentsByOwnerId,
  getDocumentApplicationIds,
  getPrimaryApplicationId,
  markDocumentDeletingById,
  toPublicDocument,
  updateDocumentFileById,
  updateDocumentById
} = require('../models/documentModel');

const router = express.Router();
const multipartParser = multer({
  storage: multer.memoryStorage(),
  defParamCharset: 'utf8',
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

function contentDispositionForInlineFile(fileName) {
  const fallbackName = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '\\$&');
  const encodedName = encodeURIComponent(fileName).replace(/[!'()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
  return `inline; filename="${fallbackName}"; filename*=UTF-8''${encodedName}`;
}

async function completeDocumentDeletion(ownerId, documentId) {
  let document = await findDocumentById(documentId, ownerId);
  if (!document) {
    return false;
  }

  if (!document.deleting) {
    document = await markDocumentDeletingById(documentId, ownerId);
    if (!document) {
      document = await findDocumentById(documentId, ownerId);
    }
  }
  if (!document) {
    return false;
  }
  if (!document.deleting) {
    throw new Error('Unable to mark the document for deletion.');
  }

  await clearDocumentRequirementReferences(ownerId, documentId);
  if (document.storageKey) {
    await removeStoredFile(document.storageKey);
  }
  return deleteDocumentById(documentId, ownerId);
}

async function recoverPendingDocumentDeletions() {
  const documents = await findDocumentsPendingDeletion();
  for (const document of documents) {
    await withAccountOperationLock(document.ownerId, () =>
      completeDocumentDeletion(document.ownerId, document._id));
  }
}

async function requireOwnedDocument(request, response, next) {
  if (!hasValidDocumentId(request.params.id)) {
    return response.status(400).json({ error: 'Invalid document ID.' });
  }

  try {
    const document = await findDocumentById(request.params.id, request.user.id);
    if (!document) {
      return response.status(404).json({ error: 'Document not found.' });
    }
    if (document.deleting) {
      return response.status(409).json({ error: 'Document deletion is in progress.' });
    }

    return next();
  } catch (error) {
    return next(error);
  }
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
    return response.json({
      documents: documents.filter((document) => !document.deleting).map(toPublicDocument)
    });
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
    if (!document || document.deleting) {
      return response.status(404).json({ error: 'Document not found.' });
    }

    return response.json({ document: toPublicDocument(document) });
  } catch (error) {
    return next(error);
  }
});

router.get('/:id/file', async (request, response, next) => {
  try {
    if (!hasValidDocumentId(request.params.id)) {
      return response.status(400).json({ error: 'Invalid document ID.' });
    }

    const document = await findDocumentById(request.params.id, request.user.id);
    if (!document || document.deleting || !document.storageKey) {
      return response.status(404).json({ error: 'Document file not found.' });
    }

    let storedFile;
    try {
      storedFile = await readStoredFile(document.storageKey);
    } catch (error) {
      if (error.code === 'ENOENT') {
        return response.status(404).json({ error: 'Document file not found.' });
      }
      throw error;
    }

    response.set('Content-Type', storedFile.contentType);
    response.set('Content-Disposition', contentDispositionForInlineFile(document.fileName || 'document'));
    response.set('Content-Length', String(storedFile.buffer.length));
    return response.send(storedFile.buffer);
  } catch (error) {
    return next(error);
  }
});

router.post('/:id/applications', async (request, response, next) => {
  try {
    if (!hasValidDocumentId(request.params.id)) {
      return response.status(400).json({ error: 'Invalid document ID.' });
    }
    if (!request.body || typeof request.body !== 'object' || Array.isArray(request.body)
        || Object.keys(request.body).length !== 1 || !Object.hasOwn(request.body, 'applicationId')
        || typeof request.body.applicationId !== 'string'
        || !applicationIdPattern.test(request.body.applicationId)) {
      return response.status(400).json({
        error: 'Validation failed.',
        details: ['A valid applicationId is required.']
      });
    }

    const result = await withAccountOperationLock(request.user.id, async () => {
      const owner = await findUserById(request.user.id);
      if (!owner || owner.deleting) {
        return { kind: 'missing-owner' };
      }
      const document = await findDocumentById(request.params.id, request.user.id);
      if (!document) {
        return { kind: 'missing-document' };
      }
      if (document.deleting) {
        return { kind: 'deleting' };
      }
      const application = await findApplicationById(request.body.applicationId, request.user.id);
      if (!application) {
        return { kind: 'missing-application' };
      }

      const applicationIds = getDocumentApplicationIds(document);
      if (applicationIds.includes(application._id)) {
        return { kind: 'unchanged', document };
      }

      applicationIds.push(application._id);
      const updatedDocument = await updateDocumentById(request.params.id, request.user.id, {
        applicationIds,
        applicationId: getPrimaryApplicationId(document) || application._id
      });
      return updatedDocument
        ? { kind: 'updated', document: updatedDocument }
        : { kind: 'missing-document' };
    });

    if (result.kind === 'missing-owner') {
      return response.status(401).json({ error: 'The authenticated user no longer exists.' });
    }
    if (result.kind === 'missing-document') {
      return response.status(404).json({ error: 'Document not found.' });
    }
    if (result.kind === 'missing-application') {
      return response.status(404).json({ error: 'Application not found.' });
    }
    if (result.kind === 'deleting') {
      return response.status(409).json({ error: 'Document deletion is in progress.' });
    }

    return response.json({ document: toPublicDocument(result.document) });
  } catch (error) {
    return next(error);
  }
});

router.delete('/:id/applications/:applicationId', async (request, response, next) => {
  try {
    if (!hasValidDocumentId(request.params.id)) {
      return response.status(400).json({ error: 'Invalid document ID.' });
    }
    if (!applicationIdPattern.test(request.params.applicationId)) {
      return response.status(400).json({ error: 'Invalid application ID.' });
    }

    const result = await withAccountOperationLock(request.user.id, async () => {
      const owner = await findUserById(request.user.id);
      if (!owner || owner.deleting) {
        return { kind: 'missing-owner' };
      }
      const document = await findDocumentById(request.params.id, request.user.id);
      if (!document) {
        return { kind: 'missing-document' };
      }
      if (document.deleting) {
        return { kind: 'deleting' };
      }
      const application = await findApplicationById(request.params.applicationId, request.user.id);
      if (!application) {
        return { kind: 'missing-application' };
      }

      const applicationIds = getDocumentApplicationIds(document);
      if (!applicationIds.includes(application._id)) {
        return { kind: 'unchanged', document };
      }
      const requirementReferences = await findDocumentRequirementReferences(
        request.user.id,
        request.params.id
      );
      if (requirementReferences.some((reference) => reference.applicationId === application._id)) {
        return { kind: 'linked' };
      }

      const remainingApplicationIds = applicationIds.filter((id) => id !== application._id);
      const currentPrimary = getPrimaryApplicationId(document);
      const primaryApplicationId = currentPrimary === application._id
        ? (remainingApplicationIds[0] || null)
        : currentPrimary;
      const updatedDocument = await updateDocumentById(request.params.id, request.user.id, {
        applicationIds: remainingApplicationIds,
        applicationId: primaryApplicationId
      });
      return updatedDocument
        ? { kind: 'updated', document: updatedDocument }
        : { kind: 'missing-document' };
    });

    if (result.kind === 'missing-owner') {
      return response.status(401).json({ error: 'The authenticated user no longer exists.' });
    }
    if (result.kind === 'missing-document') {
      return response.status(404).json({ error: 'Document not found.' });
    }
    if (result.kind === 'missing-application') {
      return response.status(404).json({ error: 'Application not found.' });
    }
    if (result.kind === 'deleting') {
      return response.status(409).json({ error: 'Document deletion is in progress.' });
    }
    if (result.kind === 'linked') {
      return response.status(409).json({
        error: 'Document is linked to a checklist requirement in this application.'
      });
    }

    return response.json({ document: toPublicDocument(result.document) });
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
      if (currentDocument.deleting) {
        return { kind: 'deleting' };
      }

      if (Object.hasOwn(input.updates, 'applicationId')
          || Object.hasOwn(input.updates, 'documentType')) {
        const requirementReferences = await findDocumentRequirementReferences(
          request.user.id,
          request.params.id
        );
        const applicationIds = getDocumentApplicationIds(currentDocument);
        const primaryApplicationId = getPrimaryApplicationId(currentDocument);
        let nextApplicationIds = applicationIds;
        if (Object.hasOwn(input.updates, 'applicationId')
            && input.updates.applicationId !== primaryApplicationId) {
          nextApplicationIds = applicationIds.filter((id) => id !== primaryApplicationId);
          if (input.updates.applicationId
              && !nextApplicationIds.includes(input.updates.applicationId)) {
            nextApplicationIds.push(input.updates.applicationId);
          }
        }
        const documentType = Object.hasOwn(input.updates, 'documentType')
          ? input.updates.documentType
          : currentDocument.documentType;
        if (requirementReferences.some((reference) =>
          !nextApplicationIds.includes(reference.applicationId)
          || reference.documentType !== documentType)) {
          return { kind: 'invalid-requirement-reference' };
        }
        if (Object.hasOwn(input.updates, 'applicationId')) {
          input.updates.applicationIds = nextApplicationIds;
          input.updates.applicationId = input.updates.applicationId
            || nextApplicationIds[0]
            || null;
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
    if (result.kind === 'deleting') {
      return response.status(409).json({ error: 'Document deletion is in progress.' });
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

router.put('/:id/file', requireOwnedDocument, parseMultipartDocument, async (request, response, next) => {
  try {
    if (!request.is('multipart/form-data') || !request.file) {
      return response.status(400).json({
        error: 'Validation failed.',
        details: ['Exactly one file is required for replacement.']
      });
    }
    if (Object.keys(request.body || {}).length > 0) {
      return response.status(400).json({
        error: 'Validation failed.',
        details: ['Replacement requests cannot include document metadata fields.']
      });
    }

    const validatedFile = validateUploadedFile(request.file);
    if (validatedFile.error) {
      return response.status(400).json({
        error: 'Validation failed.',
        details: [validatedFile.error]
      });
    }

    const result = await withAccountOperationLock(request.user.id, async () => {
      const owner = await findUserById(request.user.id);
      if (!owner || owner.deleting) {
        return { kind: 'missing-owner' };
      }

      const document = await findDocumentById(request.params.id, request.user.id);
      if (!document) {
        return { kind: 'missing-document' };
      }
      if (document.deleting) {
        return { kind: 'deleting' };
      }

      const fileMetadata = {
        fileName: validatedFile.fileName,
        fileSizeKb: Math.ceil(request.file.size / 1024),
        uploadedAt: new Date().toISOString()
      };
      const storageKey = await storeUploadedFile(request.file.buffer, validatedFile.extension);

      let updatedDocument;
      try {
        updatedDocument = await updateDocumentFileById(
          request.params.id,
          request.user.id,
          { ...fileMetadata, storageKey }
        );
      } catch (error) {
        try {
          await removeStoredFile(storageKey);
        } catch (cleanupError) {
          console.error('Unable to remove staged replacement file after document update failed.', cleanupError);
        }
        throw error;
      }

      if (!updatedDocument) {
        try {
          await removeStoredFile(storageKey);
        } catch (cleanupError) {
          console.error('Unable to remove staged replacement file after document disappeared.', cleanupError);
        }
        return { kind: 'missing-document' };
      }

      if (document.storageKey) {
        try {
          await removeStoredFile(document.storageKey);
        } catch (cleanupError) {
          console.error('Unable to remove previous document file after replacement.', cleanupError);
        }
      }

      return { kind: 'updated', document: updatedDocument };
    });

    if (result.kind === 'missing-owner') {
      return response.status(401).json({ error: 'The authenticated user no longer exists.' });
    }
    if (result.kind === 'missing-document') {
      return response.status(404).json({ error: 'Document not found.' });
    }
    if (result.kind === 'deleting') {
      return response.status(409).json({ error: 'Document deletion is in progress.' });
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

    const deleted = await withAccountOperationLock(request.user.id, () =>
      completeDocumentDeletion(request.user.id, request.params.id));
    if (!deleted) {
      return response.status(404).json({ error: 'Document not found.' });
    }

    return response.json({ message: 'Document deleted successfully.' });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
module.exports.recoverPendingDocumentDeletions = recoverPendingDocumentDeletions;