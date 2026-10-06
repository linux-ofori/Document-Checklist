const database = require('../config/documentsDatabase');

function toPublicDocument(document) {
  if (!document) {
    return null;
  }

  return {
    id: document._id,
    name: document.name,
    completed: document.completed,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt
  };
}

function createDocument({ ownerId, name, completed }) {
  const timestamp = new Date().toISOString();

  return new Promise((resolve, reject) => {
    database.insert({
      ownerId,
      name,
      completed,
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

function updateDocumentById(id, ownerId, { name, completed }) {
  const updates = { updatedAt: new Date().toISOString() };

  if (name !== undefined) {
    updates.name = name;
  }

  if (completed !== undefined) {
    updates.completed = completed;
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