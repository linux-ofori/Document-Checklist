const {
  createDocumentExpiryNotification,
  createNotification,
  deleteNotificationsByOwnerId,
  findNotificationsByOwnerId,
  markAllNotificationsRead,
  markNotificationRead
} = require('../models/notificationModel');

function createDocumentExpiryReminderNotification(occurrence) {
  return createDocumentExpiryNotification({
    ownerId: occurrence.ownerId,
    documentId: occurrence.documentId,
    documentName: occurrence.documentName,
    expiryDate: occurrence.expiryDate,
    leadDays: occurrence.leadDays,
    occurrenceId: occurrence._id
  });
}

function toPublicNotification(notification) {
  if (!notification) {
    return null;
  }

  return {
    id: notification._id,
    kind: notification.kind,
    title: notification.title,
    body: notification.body,
    severity: notification.severity,
    isRead: notification.isRead,
    applicationId: notification.applicationId ?? null,
    documentId: notification.documentId ?? null,
    dueDate: notification.dueDate ?? null,
    createdAt: notification.createdAt
  };
}

function createRequirementCompletionNotification({ ownerId, application, requirement, documentId }) {
  return createNotification({
    ownerId,
    kind: 'application',
    title: 'Checklist requirement completed',
    body: `${requirement.name} for ${application.name} is complete.`,
    severity: 'success',
    applicationId: application._id,
    documentId: documentId || null,
    dueDate: null
  });
}

async function listNotifications(ownerId) {
  const notifications = await findNotificationsByOwnerId(ownerId);
  return notifications.map(toPublicNotification);
}

async function markNotificationAsRead(ownerId, id) {
  return toPublicNotification(await markNotificationRead(id, ownerId));
}

function markAllAsRead(ownerId) {
  return markAllNotificationsRead(ownerId);
}

function deleteAllNotifications(ownerId) {
  return deleteNotificationsByOwnerId(ownerId);
}

module.exports = {
  createDocumentExpiryReminderNotification,
  createRequirementCompletionNotification,
  deleteAllNotifications,
  listNotifications,
  markAllAsRead,
  markNotificationAsRead,
  toPublicNotification
};
