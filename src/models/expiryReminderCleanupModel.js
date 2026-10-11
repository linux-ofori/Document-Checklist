const { randomUUID } = require('node:crypto');
const {
  database,
  initializeExpiryReminderCleanupDatabase
} = require('../config/expiryReminderCleanupDatabase');

const OPERATION_TYPES = new Set(['expiry-change', 'document-deletion', 'account-deletion']);
const OPERATION_STATES = new Set(['prepared', 'committed']);

function validateOperation(operation) {
  if (!operation || typeof operation !== 'object'
      || typeof operation._id !== 'string'
      || !OPERATION_TYPES.has(operation.type)
      || !OPERATION_STATES.has(operation.state)
      || typeof operation.ownerId !== 'string'
      || operation.ownerId.trim() === ''
      || !Array.isArray(operation.occurrenceIds)
      || operation.occurrenceIds.some((id) => typeof id !== 'string' || id.trim() === '')
      || new Set(operation.occurrenceIds).size !== operation.occurrenceIds.length
      || !Number.isInteger(operation.schemaVersion)
      || operation.schemaVersion !== 1
      || typeof operation.createdAt !== 'string'
      || typeof operation.updatedAt !== 'string') {
    throw new Error('An expiry reminder cleanup journal record is malformed or unsupported.');
  }

  if (operation.type === 'expiry-change') {
    if (typeof operation.documentId !== 'string'
        || !(operation.previousExpiry === null || typeof operation.previousExpiry === 'string')
        || !(operation.targetExpiry === null || typeof operation.targetExpiry === 'string')) {
      throw new Error('An expiry reminder cleanup journal record is incomplete.');
    }
  } else if (operation.type === 'document-deletion') {
    if (typeof operation.documentId !== 'string' || operation.state !== 'committed') {
      throw new Error('A document-deletion cleanup journal record is incomplete.');
    }
  } else if (operation.state !== 'committed') {
    throw new Error('An account-deletion cleanup journal record is incomplete.');
  }
  return operation;
}

async function insertOperation(input) {
  await initializeExpiryReminderCleanupDatabase();
  const timestamp = new Date().toISOString();
  const operation = validateOperation({
    _id: randomUUID(),
    schemaVersion: 1,
    ...input,
    occurrenceIds: [...new Set(input.occurrenceIds)],
    createdAt: timestamp,
    updatedAt: timestamp
  });

  return new Promise((resolve, reject) => {
    database.insert(operation, (error, inserted) =>
      error ? reject(error) : resolve(inserted));
  });
}

async function findOperations(query = {}) {
  await initializeExpiryReminderCleanupDatabase();
  return new Promise((resolve, reject) => {
    database.find(query, (error, operations) => {
      if (error) {
        reject(error);
        return;
      }
      try {
        resolve(operations.map(validateOperation));
      } catch (validationError) {
        reject(validationError);
      }
    });
  });
}

function findOperationById(id) {
  return findOperations({ _id: id }).then((operations) => operations[0] || null);
}

function updateOperationState(id, state) {
  if (!OPERATION_STATES.has(state)) {
    throw new TypeError('A valid cleanup journal state is required.');
  }
  return initializeExpiryReminderCleanupDatabase().then(() => new Promise((resolve, reject) => {
    database.update(
      { _id: id },
      { $set: { state, updatedAt: new Date().toISOString() } },
      { returnUpdatedDocs: true },
      (error, count, operation) => {
        if (error) {
          reject(error);
          return;
        }
        try {
          resolve(count > 0 ? validateOperation(operation) : null);
        } catch (validationError) {
          reject(validationError);
        }
      }
    );
  }));
}

function removeOperation(id) {
  return initializeExpiryReminderCleanupDatabase().then(() => new Promise((resolve, reject) => {
    database.remove({ _id: id }, {}, (error) => error ? reject(error) : resolve());
  })).then(() => findOperationById(id)).then((remaining) => {
    if (remaining) {
      throw new Error('Expiry reminder cleanup journal record remains after removal.');
    }
  });
}

module.exports = {
  findOperationById,
  findOperations,
  insertOperation,
  removeOperation,
  updateOperationState
};
