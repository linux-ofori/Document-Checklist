const withAccountOperationLock = require('../models/accountOperationLock');
const {
  deleteReminderOccurrencesByIds,
  findReminderOccurrencesByDocument,
  findReminderOccurrencesByIds,
  findReminderOccurrencesByOwner
} = require('../models/expiryReminderModel');
const {
  deleteNotificationsByOccurrenceIds,
  findNotificationsByOccurrenceIds
} = require('../models/notificationModel');
const {
  findDocumentById
} = require('../models/documentModel');
const {
  findOperationById,
  findOperations,
  insertOperation,
  removeOperation,
  updateOperationState
} = require('../models/expiryReminderCleanupModel');
const { normalizeExpiryUtcDate } = require('./expiryReminderSchedule');

function normalizedStoredExpiry(value) {
  if (value === null || value === undefined) {
    return null;
  }
  return normalizeExpiryUtcDate(value);
}

async function verifyAndCompleteCleanup(operation) {
  if (operation.state !== 'committed') {
    throw new Error('Cannot execute an uncommitted expiry reminder cleanup operation.');
  }

  await deleteNotificationsByOccurrenceIds(operation.ownerId, operation.occurrenceIds);
  const remainingNotifications = await findNotificationsByOccurrenceIds(
    operation.ownerId,
    operation.occurrenceIds
  );
  if (remainingNotifications.length > 0) {
    throw new Error('Linked reminder notifications remain after cleanup.');
  }

  await deleteReminderOccurrencesByIds(
    operation.ownerId,
    operation.documentId || null,
    operation.occurrenceIds
  );
  const remainingOccurrences = await findReminderOccurrencesByIds(
    operation.ownerId,
    operation.occurrenceIds
  );
  if (remainingOccurrences.length > 0) {
    throw new Error('Reminder occurrences remain after cleanup.');
  }

  await removeOperation(operation._id);
}

async function prepareExpiryChange({ ownerId, documentId, previousExpiry, targetExpiry }) {
  const occurrences = await findReminderOccurrencesByDocument(ownerId, documentId);
  return insertOperation({
    type: 'expiry-change',
    state: 'prepared',
    ownerId,
    documentId,
    occurrenceIds: occurrences.map(({ _id }) => _id),
    previousExpiry,
    targetExpiry
  });
}

async function commitExpiryChange(operationId) {
  const operation = await updateOperationState(operationId, 'committed');
  if (!operation) {
    throw new Error('Prepared expiry reminder cleanup operation was not found.');
  }
  await verifyAndCompleteCleanup(operation);
}

async function reconcileExpiryOperation(operation) {
  const document = await findDocumentById(operation.documentId, operation.ownerId);
  if (!document) {
    throw new Error('Cannot reconcile expiry cleanup because its document is missing.');
  }
  const currentExpiry = normalizedStoredExpiry(document.expiresAt);

  if (operation.state === 'prepared') {
    if (currentExpiry === operation.targetExpiry) {
      const committed = await updateOperationState(operation._id, 'committed');
      if (!committed) {
        throw new Error('Prepared expiry reminder cleanup operation was not found.');
      }
      await verifyAndCompleteCleanup(committed);
      return;
    }
    if (currentExpiry === operation.previousExpiry) {
      await removeOperation(operation._id);
      return;
    }
    throw new Error('Document expiry does not match either value in its pending cleanup operation.');
  }

  if (currentExpiry !== operation.targetExpiry) {
    throw new Error('Committed expiry cleanup no longer matches the stored document expiry.');
  }
  await verifyAndCompleteCleanup(operation);
}

async function reconcilePendingDocumentExpiryCleanup(ownerId, documentId) {
  const operations = await findOperations({ ownerId, documentId, type: 'expiry-change' });
  if (operations.length > 1) {
    throw new Error('Multiple pending expiry cleanup operations exist for the same document.');
  }
  for (const operation of operations) {
    await reconcileExpiryOperation(operation);
  }
}

async function createDeletionCleanup(type, ownerId, documentId = null) {
  const existing = await findOperations({
    ownerId,
    type,
    ...(documentId ? { documentId } : {})
  });
  if (existing.length > 1) {
    throw new Error('Multiple pending reminder cleanup operations exist for the same deletion scope.');
  }
  if (existing.length === 1) {
    return existing[0];
  }

  const occurrences = documentId === null
    ? await findReminderOccurrencesByOwner(ownerId)
    : await findReminderOccurrencesByDocument(ownerId, documentId);
  return insertOperation({
    type,
    state: 'committed',
    ownerId,
    ...(documentId === null ? {} : { documentId }),
    occurrenceIds: occurrences.map(({ _id }) => _id)
  });
}

async function completeDocumentReminderCleanup(ownerId, documentId) {
  const operation = await createDeletionCleanup('document-deletion', ownerId, documentId);
  await verifyAndCompleteCleanup(operation);
}

async function completeAccountReminderCleanup(ownerId) {
  const pendingExpiryOperations = await findOperations({ ownerId, type: 'expiry-change' });
  for (const operation of pendingExpiryOperations) {
    await reconcileExpiryOperation(operation);
  }
  const operation = await createDeletionCleanup('account-deletion', ownerId);
  await verifyAndCompleteCleanup(operation);
}

async function recoverOperation(operation) {
  if (operation.type === 'expiry-change') {
    await reconcileExpiryOperation(operation);
    return;
  }
  await verifyAndCompleteCleanup(operation);
}

async function recoverPendingExpiryReminderCleanup() {
  const operations = await findOperations();
  for (const operation of operations) {
    await withAccountOperationLock(operation.ownerId, () => recoverOperation(operation));
  }
}

async function cancelPreparedExpiryChange(operationId) {
  const operation = await findOperationById(operationId);
  if (!operation) {
    return;
  }
  if (operation.type !== 'expiry-change' || operation.state !== 'prepared') {
    throw new Error('Only a prepared expiry cleanup operation can be cancelled.');
  }
  await removeOperation(operationId);
}

module.exports = {
  cancelPreparedExpiryChange,
  commitExpiryChange,
  completeAccountReminderCleanup,
  completeDocumentReminderCleanup,
  prepareExpiryChange,
  reconcilePendingDocumentExpiryCleanup,
  recoverPendingExpiryReminderCleanup
};
