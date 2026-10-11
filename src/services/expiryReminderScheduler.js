const withAccountOperationLock = require('../models/accountOperationLock');
const documentModel = require('../models/documentModel');
const {
  claimReminderChannel,
  completeReminderChannel,
  createReminderOccurrence,
  findReminderOccurrenceByKey,
  suppressReminderChannel
} = require('../models/expiryReminderModel');
const { findUserById, toPublicUser } = require('../models/userModel');
const { createDocumentExpiryReminderNotification } = require('./notificationService');
const {
  getExpiryReminderSchedule,
  normalizeExpiryUtcDate
} = require('./expiryReminderSchedule');

const DEFAULT_INTERVAL_MS = 60 * 60 * 1000;
const DEFAULT_LEASE_DURATION_MS = 60 * 1000;
const DEFAULT_RETRY_DELAY_MS = 5 * 60 * 1000;

function toDate(value) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new TypeError('Scheduler time must be a valid timestamp.');
  }
  return date;
}

function createExpiryReminderScheduler({
  intervalMs = DEFAULT_INTERVAL_MS,
  leaseDurationMs = DEFAULT_LEASE_DURATION_MS,
  retryDelayMs = DEFAULT_RETRY_DELAY_MS,
  logger = console,
  dependencies = {}
} = {}) {
  if (!Number.isSafeInteger(intervalMs) || intervalMs <= 0
      || !Number.isSafeInteger(leaseDurationMs) || leaseDurationMs <= 0
      || !Number.isSafeInteger(retryDelayMs) || retryDelayMs <= 0) {
    throw new TypeError('Scheduler intervals and lease durations must be safe positive integers.');
  }

  const operations = {
    findDocumentsExpiringBetweenUtcDates: documentModel.findDocumentsExpiringBetweenUtcDates,
    findDocumentById: documentModel.findDocumentById,
    findUserById,
    withAccountOperationLock,
    createReminderOccurrence,
    findReminderOccurrenceByKey,
    claimReminderChannel,
    completeReminderChannel,
    suppressReminderChannel,
    createDocumentExpiryReminderNotification,
    ...dependencies
  };

  let timer = null;
  let inFlight = null;

  async function processDocument(candidate, today, now) {
    return operations.withAccountOperationLock(candidate.ownerId, async () => {
      const user = await operations.findUserById(candidate.ownerId);
      if (!user || user.deleting) {
        return;
      }

      const document = await operations.findDocumentById(candidate._id, candidate.ownerId);
      if (!document || document.deleting) {
        return;
      }

      let expiryDate;
      try {
        expiryDate = normalizeExpiryUtcDate(document.expiresAt);
      } catch (error) {
        if (error instanceof TypeError) {
          return;
        }
        throw error;
      }
      if (expiryDate <= today) {
        return;
      }

      const schedule = getExpiryReminderSchedule(expiryDate);
      const occurrences = [];
      for (const reminder of schedule.reminders) {
        const input = {
          ownerId: document.ownerId,
          documentId: document._id,
          expiryDate,
          leadDays: reminder.leadDays
        };
        await operations.createReminderOccurrence(input);
        const occurrence = await operations.findReminderOccurrenceByKey(input);
        if (!occurrence) {
          throw new Error('Reminder occurrence was not available after creation.');
        }
        if (occurrence.scheduledDate <= today && occurrence.expiryDate > today) {
          occurrences.push(occurrence);
        }
      }

      if (occurrences.length === 0) {
        return;
      }

      const notificationsEnabled = toPublicUser(user).preferences.notifications.documentExpiry;
      if (!notificationsEnabled) {
        for (const occurrence of occurrences) {
          await operations.suppressReminderChannel(occurrence._id, 'inApp', { now });
        }
        return;
      }

      occurrences.sort((left, right) => right.scheduledDate.localeCompare(left.scheduledDate));
      const latestUsefulOccurrence = occurrences[0];
      for (const occurrence of occurrences.slice(1)) {
        await operations.suppressReminderChannel(occurrence._id, 'inApp', { now });
      }

      const claim = await operations.claimReminderChannel(
        latestUsefulOccurrence._id,
        'inApp',
        { now, leaseDurationMs }
      );
      if (!claim) {
        return;
      }

      try {
        const notification = await operations.createDocumentExpiryReminderNotification({
          ...latestUsefulOccurrence,
          documentName: document.name
        });
        const completed = await operations.completeReminderChannel(
          latestUsefulOccurrence._id,
          'inApp',
          {
            leaseToken: claim.inApp.leaseToken,
            status: 'sent',
            now,
            acknowledgementId: notification._id
          }
        );
        if (!completed) {
          throw new Error('Unable to record confirmed reminder notification delivery.');
        }
      } catch (deliveryError) {
        const retryAt = new Date(now.getTime() + retryDelayMs);
        if (!Number.isFinite(retryAt.getTime())) {
          throw new Error('Unable to calculate the reminder retry time.');
        }
        const retry = await operations.completeReminderChannel(
          latestUsefulOccurrence._id,
          'inApp',
          {
            leaseToken: claim.inApp.leaseToken,
            status: 'retry',
            now,
            nextAttemptAt: retryAt,
            lastErrorCode: typeof deliveryError.code === 'string'
              ? deliveryError.code
              : 'NOTIFICATION_PERSISTENCE_FAILED'
          }
        );
        if (!retry) {
          throw new Error('Reminder delivery failed and its retry state could not be recorded.');
        }
        throw deliveryError;
      }
    });
  }

  async function run(nowValue = new Date()) {
    const now = toDate(nowValue);
    const today = now.toISOString().slice(0, 10);
    const end = new Date(`${today}T00:00:00.000Z`);
    end.setUTCDate(end.getUTCDate() + 9);
    if (!Number.isFinite(end.getTime())) {
      throw new TypeError('Scheduler date range is outside the supported UTC calendar range.');
    }
    const candidateEndDate = end.toISOString().slice(0, 10);
    const candidates = await operations.findDocumentsExpiringBetweenUtcDates(
      today,
      candidateEndDate
    );
    const failures = [];

    for (const candidate of candidates) {
      try {
        await processDocument(candidate, today, now);
      } catch (error) {
        failures.push(error);
      }
    }

    if (failures.length > 0) {
      throw new AggregateError(failures, 'One or more document-expiry reminders could not be processed.');
    }
  }

  function runOnce(nowValue = new Date()) {
    if (inFlight) {
      return inFlight;
    }
    inFlight = run(nowValue).finally(() => {
      inFlight = null;
    });
    return inFlight;
  }

  function reportBackgroundError(error) {
    try {
      logger.error('Document-expiry reminder scheduler run failed.', error);
    } catch (loggingError) {
      console.error('Unable to report document-expiry reminder scheduler failure.', loggingError);
    }
  }

  function start() {
    if (timer) {
      return runOnce().catch((error) => reportBackgroundError(error));
    }
    timer = setInterval(() => {
      runOnce().catch((error) => reportBackgroundError(error));
    }, intervalMs);
    timer.unref();
    return runOnce().catch((error) => reportBackgroundError(error));
  }

  function stop() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    return inFlight || Promise.resolve();
  }

  return { runOnce, start, stop };
}

module.exports = { createExpiryReminderScheduler };
