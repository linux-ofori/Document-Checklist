const database = require('../config/documentsDatabase');

const DOCUMENT_STATUS_DEFAULT = 'in-review';

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
    applicationId: document.applicationId ?? null,
    fileName: null,
    fileSizeKb: null,
    uploadedAt: null,
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
  expiresAt = null,
  note = null
}) {
  const timestamp = new Date().toISOString();

  return new Promise((resolve, reject) => {
    database.insert({
      ownerId,
      name,
      completed,
      documentType,
      status,
      applicationId,
      expiresAt,
      note,
      createdAt: timestamp,
      updatedAt: timestamp
    }, (error, document) => error ? reject(error) : resolve(document));
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

  for (const field of ['name', 'completed', 'documentType', 'status', 'applicationId', 'expiresAt', 'note']) {
    if (documentUpdates[field] !== undefined) {
      updates[field] = documentUpdates[field];
    }
  }

  return new Promise((resolve, reject) => {
    database.update({ _id: id, ownerId }, { $set: updates }, { returnUpdatedDocs: true }, (error, count, document) => {
      if (error) {
        return reject(error);
      }

      return resolve(count > 0 ? document : null);
    });
  });
}

function deleteDocumentById(id, ownerId) {
  return new Promise((resolve, reject) => {
    database.remove({ _id: id, ownerId }, {}, (error, count) => error ? reject(error) : resolve(count > 0));
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
  findDocumentsByOwnerId,
  toPublicDocument,
  updateDocumentById
};