const { createHash, randomUUID } = require('node:crypto');
const {
  database,
  initializeExpiryRemindersDatabase
} = require('../config/expiryRemindersDatabase');
const {
  getUtcDateDaysBefore,
  normalizeExpiryUtcDate
} = require('../services/expiryReminderSchedule');

const CHANNELS = new Set(['inApp', 'email']);
const CHANNEL_STATES = {
  inApp: new Set(['pending', 'claimed', 'retry', 'sent', 'suppressed', 'superseded', 'unknown']),
  email: new Set(['pending', 'claimed', 'retry', 'accepted', 'suppressed', 'superseded', 'unknown'])
};

function validateOccurrenceInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('A reminder occurrence object is required.');
  }
  const allowedFields = new Set(['ownerId', 'documentId', 'expiryDate', 'leadDays']);
  if (Object.keys(input).some((field) => !allowedFields.has(field))) {
    throw new TypeError('Reminder occurrence contains an unsupported field.');
  }

  const { ownerId, documentId, expiryDate, leadDays } = input;
  if (typeof ownerId !== 'string' || ownerId.trim() === '' || ownerId !== ownerId.trim()) {
    throw new TypeError('A non-empty owner ID is required.');
  }
  if (typeof documentId !== 'string' || documentId.trim() === '' || documentId !== documentId.trim()) {
    throw new TypeError('A non-empty document ID is required.');
  }
  if (leadDays !== 1 && leadDays !== 7) {
    throw new TypeError('Reminder lead days must be 1 or 7.');
  }

  const canonicalExpiryDate = normalizeExpiryUtcDate(expiryDate);
  const scheduledDate = getUtcDateDaysBefore(canonicalExpiryDate, leadDays);
  return {
    ownerId,
    documentId,
    expiryDate: canonicalExpiryDate,
    leadDays,
    scheduledDate
  };
}

function occurrenceKeyFor(input) {
  return JSON.stringify([
    input.ownerId,
    input.documentId,
    input.expiryDate,
    input.leadDays
  ]);
}

function occurrenceIdFor(occurrenceKey) {
  return createHash('sha256').update(occurrenceKey).digest('hex');
}

function matchesOccurrenceIdentity(existing, requested) {
  return existing._id === requested._id
    && existing.occurrenceKey === requested.occurrenceKey
    && existing.ownerId === requested.ownerId
    && existing.documentId === requested.documentId
    && existing.expiryDate === requested.expiryDate
    && existing.leadDays === requested.leadDays
    && existing.scheduledDate === requested.scheduledDate;
}

function createPendingChannelState() {
  return {
    status: 'pending',
    attemptCount: 0,
    nextAttemptAt: null,
    leaseToken: null,
    leaseExpiresAt: null,
    lastAttemptAt: null,
    acknowledgedAt: null,
    acknowledgementId: null,
    lastErrorCode: null
  };
}

function findOne(query) {
  return initializeExpiryRemindersDatabase().then(() => new Promise((resolve, reject) => {
    database.findOne(query, (error, document) => error ? reject(error) : resolve(document));
  }));
}

function createReminderOccurrence(input) {
  const occurrence = validateOccurrenceInput(input);
  const occurrenceKey = occurrenceKeyFor(occurrence);
  const timestamp = new Date().toISOString();
  const document = {
    _id: occurrenceIdFor(occurrenceKey),
    occurrenceKey,
    ...occurrence,
    inApp: createPendingChannelState(),
    email: createPendingChannelState(),
    createdAt: timestamp,
    updatedAt: timestamp
  };

  return initializeExpiryRemindersDatabase().then(() => new Promise((resolve, reject) => {
    database.insert(document, (error, inserted) => {
      if (!error) {
        resolve({ occurrence: inserted, created: true });
        return;
      }
      if (error.errorType !== 'uniqueViolated') {
        reject(error);
        return;
      }

      findOne({ occurrenceKey }).then((existing) => {
        if (!existing) {
          reject(error);
          return;
        }
        if (!matchesOccurrenceIdentity(existing, document)) {
          const conflictError = new Error(
            'A conflicting reminder occurrence already exists for this occurrence key.'
          );
          conflictError.code = 'ERR_EXPIRY_REMINDER_OCCURRENCE_CONFLICT';
          reject(conflictError);
          return;
        }
        resolve({ occurrence: existing, created: false });
      }, reject);
    });
  }));
}

function findReminderOccurrenceByKey(input) {
  const occurrence = validateOccurrenceInput(input);
  return findOne({ occurrenceKey: occurrenceKeyFor(occurrence) });
}

function findReminderOccurrenceById(id) {
  if (typeof id !== 'string' || id.trim() === '') {
    throw new TypeError('A non-empty reminder occurrence ID is required.');
  }
  return findOne({ _id: id });
}

function findReminderOccurrencesDue(channel, { throughDate, now = new Date() } = {}) {
  if (!CHANNELS.has(channel)) {
    throw new TypeError('Reminder channel must be inApp or email.');
  }

  getUtcDateDaysBefore(throughDate, 0);
  const nowIso = toIsoTimestamp(now, 'Query time');
  const statusPath = `${channel}.status`;

  return initializeExpiryRemindersDatabase().then(() => new Promise((resolve, reject) => {
    database.find({
      scheduledDate: { $lte: throughDate },
      expiryDate: { $gt: throughDate },
      $or: [
        { [statusPath]: 'pending' },
        {
          [statusPath]: 'retry',
          [`${channel}.nextAttemptAt`]: { $lte: nowIso }
        },
        {
          [statusPath]: 'claimed',
          [`${channel}.leaseExpiresAt`]: { $lte: nowIso }
        }
      ]
    }, (error, occurrences) => {
      if (error) {
        reject(error);
        return;
      }

      occurrences.sort((left, right) =>
        left.scheduledDate.localeCompare(right.scheduledDate)
        || left.createdAt.localeCompare(right.createdAt)
        || left._id.localeCompare(right._id));
      resolve(occurrences);
    });
  }));
}

function toIsoTimestamp(value, fieldName) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new TypeError(`${fieldName} must be a valid timestamp.`);
  }
  return date.toISOString();
}

function claimReminderChannel(id, channel, { now = new Date(), leaseDurationMs = 60000 } = {}) {
  if (!CHANNELS.has(channel)) {
    throw new TypeError('Reminder channel must be inApp or email.');
  }
  if (!Number.isSafeInteger(leaseDurationMs) || leaseDurationMs <= 0) {
    throw new TypeError('Lease duration must be a safe positive integer.');
  }

  const nowIso = toIsoTimestamp(now, 'Claim time');
  const leaseExpiresAt = new Date(new Date(nowIso).getTime() + leaseDurationMs).toISOString();
  const leaseToken = randomUUID();
  const statePath = `${channel}.status`;
  const nextAttemptPath = `${channel}.nextAttemptAt`;
  const leaseExpiryPath = `${channel}.leaseExpiresAt`;
  const query = {
    _id: id,
    $or: [
      {
        [statePath]: { $in: ['pending', 'retry'] },
        $or: [
          { [nextAttemptPath]: null },
          { [nextAttemptPath]: { $lte: nowIso } }
        ]
      },
      {
        [statePath]: 'claimed',
        [leaseExpiryPath]: { $lte: nowIso }
      }
    ]
  };
  const updates = {
    $set: {
      [`${channel}.status`]: 'claimed',
      [`${channel}.leaseToken`]: leaseToken,
      [`${channel}.leaseExpiresAt`]: leaseExpiresAt,
      [`${channel}.lastAttemptAt`]: nowIso,
      updatedAt: nowIso
    },
    $inc: { [`${channel}.attemptCount`]: 1 }
  };

  return initializeExpiryRemindersDatabase().then(() => new Promise((resolve, reject) => {
    database.update(query, updates, { returnUpdatedDocs: true }, (error, count, document) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(count > 0 ? document : null);
    });
  }));
}

function suppressReminderChannel(id, channel, { now = new Date() } = {}) {
  if (!CHANNELS.has(channel)) {
    throw new TypeError('Reminder channel must be inApp or email.');
  }

  const nowIso = toIsoTimestamp(now, 'Suppression time');
  return initializeExpiryRemindersDatabase().then(() => new Promise((resolve, reject) => {
    database.update({
      _id: id,
      [`${channel}.status`]: { $in: ['pending', 'retry', 'claimed'] }
    }, {
      $set: {
        [`${channel}.status`]: 'suppressed',
        [`${channel}.nextAttemptAt`]: null,
        [`${channel}.leaseToken`]: null,
        [`${channel}.leaseExpiresAt`]: null,
        updatedAt: nowIso
      }
    }, { returnUpdatedDocs: true }, (error, count, document) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(count > 0 ? document : null);
    });
  }));
}

function completeReminderChannel(id, channel, {
  leaseToken,
  status,
  now = new Date(),
  nextAttemptAt = null,
  acknowledgementId = null,
  lastErrorCode = null
} = {}) {
  if (!CHANNELS.has(channel)) {
    throw new TypeError('Reminder channel must be inApp or email.');
  }
  if (!CHANNEL_STATES[channel].has(status) || status === 'pending' || status === 'claimed') {
    throw new TypeError(`Invalid ${channel} reminder channel state.`);
  }
  if (typeof leaseToken !== 'string' || leaseToken.trim() === '') {
    throw new TypeError('A non-empty channel lease token is required.');
  }
  if (status === 'retry' && nextAttemptAt === null) {
    throw new TypeError('A retry state requires a next-attempt timestamp.');
  }
  if (acknowledgementId !== null && typeof acknowledgementId !== 'string') {
    throw new TypeError('Acknowledgement ID must be a string or null.');
  }
  if (lastErrorCode !== null && typeof lastErrorCode !== 'string') {
    throw new TypeError('Last error code must be a string or null.');
  }

  const nowIso = toIsoTimestamp(now, 'Completion time');
  const nextAttempt = nextAttemptAt === null
    ? null
    : toIsoTimestamp(nextAttemptAt, 'Next-attempt time');
  const query = {
    _id: id,
    [`${channel}.status`]: 'claimed',
    [`${channel}.leaseToken`]: leaseToken
  };
  const updates = {
    $set: {
      [`${channel}.status`]: status,
      [`${channel}.nextAttemptAt`]: nextAttempt,
      [`${channel}.leaseToken`]: null,
      [`${channel}.leaseExpiresAt`]: null,
      [`${channel}.acknowledgedAt`]: status === 'sent' || status === 'accepted' ? nowIso : null,
      [`${channel}.acknowledgementId`]: acknowledgementId,
      [`${channel}.lastErrorCode`]: lastErrorCode,
      updatedAt: nowIso
    }
  };

  return initializeExpiryRemindersDatabase().then(() => new Promise((resolve, reject) => {
    database.update(query, updates, { returnUpdatedDocs: true }, (error, count, document) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(count > 0 ? document : null);
    });
  }));
}

module.exports = {
  claimReminderChannel,
  completeReminderChannel,
  createReminderOccurrence,
  findReminderOccurrenceById,
  findReminderOccurrenceByKey,
  findReminderOccurrencesDue,
  suppressReminderChannel
};
