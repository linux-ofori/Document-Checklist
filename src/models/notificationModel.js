const { createHash, randomBytes } = require('node:crypto');
const database = require('../config/notificationsDatabase');

function createNotification({
  ownerId,
  kind,
  title,
  body,
  severity,
  applicationId,
  documentId = null,
  dueDate = null
}) {
  const notification = {
    _id: randomBytes(8).toString('hex'),
    ownerId,
    kind,
    title,
    body,
    severity,
    isRead: false,
    applicationId,
    documentId,
    dueDate,
    createdAt: new Date().toISOString()
  };

  return new Promise((resolve, reject) => {
    database.insert(notification, (error, inserted) => error ? reject(error) : resolve(inserted));
  });
}

function createDocumentExpiryNotification({
  ownerId,
  documentId,
  documentName,
  expiryDate,
  leadDays,
  occurrenceId
}) {
  const notification = {
    _id: createHash('sha256')
      .update(`document-expiry-reminder:${occurrenceId}`)
      .digest('hex')
      .slice(0, 16),
    ownerId,
    kind: 'document-expiry',
    title: 'Document expiry reminder',
    body: `${documentName} expires on ${expiryDate}. This is your ${leadDays}-day reminder.`,
    severity: 'warning',
    isRead: false,
    applicationId: null,
    documentId,
    dueDate: expiryDate,
    expiryReminderOccurrenceId: occurrenceId,
    expiryReminderLeadDays: leadDays,
    createdAt: new Date().toISOString()
  };

  return new Promise((resolve, reject) => {
    database.insert(notification, (error, inserted) => {
      if (!error) {
        resolve(inserted);
        return;
      }
      if (error.errorType !== 'uniqueViolated') {
        reject(error);
        return;
      }

      database.findOne({ _id: notification._id }, (findError, existing) => {
        if (findError) {
          reject(findError);
          return;
        }
        if (!existing
            || existing.ownerId !== ownerId
            || existing.kind !== notification.kind
            || existing.documentId !== documentId
            || existing.dueDate !== expiryDate
            || existing.expiryReminderOccurrenceId !== occurrenceId
            || existing.expiryReminderLeadDays !== leadDays) {
          const conflictError = new Error(
            'A conflicting notification already exists for this reminder occurrence.'
          );
          conflictError.code = 'ERR_DOCUMENT_EXPIRY_NOTIFICATION_CONFLICT';
          reject(conflictError);
          return;
        }
        resolve(existing);
      });
    });
  });
}

function findNotificationsByOwnerId(ownerId) {
  return new Promise((resolve, reject) => {
    database.find({ ownerId }, (error, notifications) => {
      if (error) {
        return reject(error);
      }

      notifications.sort((left, right) =>
        right.createdAt.localeCompare(left.createdAt) || right._id.localeCompare(left._id));
      return resolve(notifications);
    });
  });
}

function findNotificationByIdAndOwnerId(id, ownerId) {
  return new Promise((resolve, reject) => {
    database.findOne({ _id: id, ownerId }, (error, notification) =>
      error ? reject(error) : resolve(notification));
  });
}

function markNotificationRead(id, ownerId) {
  return new Promise((resolve, reject) => {
    database.update(
      { _id: id, ownerId },
      { $set: { isRead: true } },
      { returnUpdatedDocs: true },
      (error, count, notification) => {
        if (error) {
          return reject(error);
        }

        return resolve(count > 0 ? notification : null);
      }
    );
  });
}

function markAllNotificationsRead(ownerId) {
  return new Promise((resolve, reject) => {
    database.update(
      { ownerId, isRead: false },
      { $set: { isRead: true } },
      { multi: true },
      (error, updatedCount) => error ? reject(error) : resolve(updatedCount)
    );
  });
}

function deleteNotificationsByOwnerId(ownerId) {
  return new Promise((resolve, reject) => {
    database.remove({ ownerId }, { multi: true }, (error, count) =>
      error ? reject(error) : resolve(count));
  });
}

module.exports = {
  createDocumentExpiryNotification,
  createNotification,
  deleteNotificationsByOwnerId,
  findNotificationByIdAndOwnerId,
  findNotificationsByOwnerId,
  markAllNotificationsRead,
  markNotificationRead
};
