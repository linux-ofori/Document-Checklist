const database = require('../config/documentsDatabase');

const DOCUMENT_STATUS_DEFAULT = 'in-review';

function getDocumentApplicationIds(document) {
  const applicationIds = Array.isArray(document.applicationIds)
    ? document.applicationIds
    : (typeof document.applicationId === 'string' ? [document.applicationId] : []);
  return [...new Set(applicationIds.filter((applicationId) => typeof applicationId === 'string'))];
}

function getPrimaryApplicationId(document) {
  const applicationIds = getDocumentApplicationIds(document);
  if (applicationIds.includes(document.applicationId)) {
    return document.applicationId;
  }
  return applicationIds[0] || null;
}

function toPublicDocument(document) {
  if (!document) {
    return null;
  }

  return {
    id: document._id,
    name: document.name,
    completed: document.completed,
    documentType: document.documentType ?? null,
    status: document.status ?? DOCUMENT_STATUS_DEFAULT,
    applicationId: getPrimaryApplicationId(document),
    applicationIds: getDocumentApplicationIds(document),
    fileName: document.fileName ?? null,
    fileSizeKb: document.fileSizeKb ?? null,
    uploadedAt: document.uploadedAt ?? null,
    expiresAt: document.expiresAt ?? null,
    note: document.note ?? null,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt
  };
}

function createDocument({
  ownerId,
  name,
  completed,
  documentType = null,
  status = DOCUMENT_STATUS_DEFAULT,
  applicationId = null,
  applicationIds = applicationId ? [applicationId] : [],
  expiresAt = null,
  note = null,
  fileMetadata
}) {
  const timestamp = new Date().toISOString();

  const document = {
    ownerId,
    name,
    completed,
    documentType,
    status,
    applicationId: applicationId || applicationIds[0] || null,
    applicationIds: [...new Set(applicationIds)],
    expiresAt,
    note,
    createdAt: timestamp,
    updatedAt: timestamp
  };
  if (fileMetadata) {
    Object.assign(document, fileMetadata);
  }

  return new Promise((resolve, reject) => {
    database.insert(document, (error, inserted) => error ? reject(error) : resolve(inserted));
  });
}

function findDocumentsByOwnerId(ownerId) {
  return new Promise((resolve, reject) => {
    database.find({ ownerId }, (error, documents) => {
      if (error) {
        return reject(error);
      }

      documents.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
      return resolve(documents);
    });
  });
}

function findDocumentById(id, ownerId) {
  return new Promise((resolve, reject) => {
    database.findOne({ _id: id, ownerId }, (error, document) => error ? reject(error) : resolve(document));
  });
}

function updateDocumentById(id, ownerId, documentUpdates) {
  const updates = { updatedAt: new Date().toISOString() };

  for (const field of [
    'name',
    'completed',
    'documentType',
    'status',
    'applicationId',
    'applicationIds',
    'expiresAt',
    'note'
  ]) {
    if (documentUpdates[field] !== undefined) {
      updates[field] = documentUpdates[field];
    }
  }

  return new Promise((resolve, reject) => {
    database.update(
      { _id: id, ownerId, deleting: { $ne: true } },
      { $set: updates },
      { returnUpdatedDocs: true },
      (error, count, document) => {
        if (error) {
          return reject(error);
        }

        return resolve(count > 0 ? document : null);
      }
    );
  });
}

function updateDocumentFileById(id, ownerId, fileMetadata) {
  const updates = {
    storageKey: fileMetadata.storageKey,
    fileName: fileMetadata.fileName,
    fileSizeKb: fileMetadata.fileSizeKb,
    uploadedAt: fileMetadata.uploadedAt,
    updatedAt: new Date().toISOString()
  };

  return new Promise((resolve, reject) => {
    database.update(
      { _id: id, ownerId, deleting: { $ne: true } },
      { $set: updates },
      { returnUpdatedDocs: true },
      (error, count, document) => {
        if (error) {
          return reject(error);
        }

        return resolve(count > 0 ? document : null);
      }
    );
  });
}

function deleteDocumentById(id, ownerId) {
  return new Promise((resolve, reject) => {
    database.remove({ _id: id, ownerId }, {}, (error, count) => error ? reject(error) : resolve(count > 0));
  });
}

function markDocumentDeletingById(id, ownerId) {
  return new Promise((resolve, reject) => {
    database.update(
      { _id: id, ownerId, deleting: { $ne: true } },
      { $set: { deleting: true, updatedAt: new Date().toISOString() } },
      { returnUpdatedDocs: true },
      (error, count, document) => {
        if (error) {
          return reject(error);
        }

        return resolve(count > 0 ? document : null);
      }
    );
  });
}

function findDocumentsPendingDeletion() {
  return new Promise((resolve, reject) => {
    database.find({ deleting: true }, (error, documents) =>
      error ? reject(error) : resolve(documents));
  });
}

function deleteDocumentsByOwnerId(ownerId) {
  return new Promise((resolve, reject) => {
    database.remove({ ownerId }, { multi: true }, (error, count) => error ? reject(error) : resolve(count));
  });
}

module.exports = {
  createDocument,
  deleteDocumentById,
  deleteDocumentsByOwnerId,
  findDocumentById,
  findDocumentsPendingDeletion,
  findDocumentsByOwnerId,
  getDocumentApplicationIds,
  getPrimaryApplicationId,
  markDocumentDeletingById,
  toPublicDocument,
  updateDocumentFileById,
  updateDocumentById
};