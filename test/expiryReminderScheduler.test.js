const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, test } = require('node:test');

const temporaryDirectory = fs.mkdtempSync(
  path.join(os.tmpdir(), 'document-checklist-expiry-scheduler-test-')
);
process.env.DOCUMENT_CHECKLIST_USERS_DB_PATH = path.join(temporaryDirectory, 'users.db');
process.env.DOCUMENT_CHECKLIST_DOCUMENTS_DB_PATH = path.join(temporaryDirectory, 'documents.db');
process.env.DOCUMENT_CHECKLIST_APPLICATIONS_DB_PATH = path.join(temporaryDirectory, 'applications.db');
process.env.DOCUMENT_CHECKLIST_NOTIFICATIONS_DB_PATH = path.join(temporaryDirectory, 'notifications.db');
process.env.DOCUMENT_CHECKLIST_EXPIRY_REMINDERS_DB_PATH =
  path.join(temporaryDirectory, 'expiry-reminders.db');

const notificationsDatabase = require('../src/config/notificationsDatabase');
const { createDocumentExpiryNotification } = require('../src/models/notificationModel');
const {
  createDocumentExpiryReminderNotification
} = require('../src/services/notificationService');
const {
  deleteDocumentById,
  deleteDocumentsByOwnerId,
  findDocumentById,
  findDocumentsExpiringBetweenUtcDates,
  createDocument,
  markDocumentDeletingById
} = require('../src/models/documentModel');
const withAccountOperationLock = require('../src/models/accountOperationLock');
const {
  completeReminderChannel,
  findReminderOccurrenceByKey
} = require('../src/models/expiryReminderModel');
const {
  createUser,
  deleteUserById,
  findUserById,
  markUserDeletingById,
  updateUserById
} = require('../src/models/userModel');
const { findNotificationsByOwnerId } = require('../src/models/notificationModel');
const { toPublicNotification } = require('../src/services/notificationService');
const { createExpiryReminderScheduler } = require('../src/services/expiryReminderScheduler');
const { startServerAfterRecovery } = require('../src/services/serverStartup');

after(() => {
  const cleanupTarget = path.resolve(temporaryDirectory);
  if (path.dirname(cleanupTarget) !== path.resolve(os.tmpdir())
      || !path.basename(cleanupTarget).startsWith('document-checklist-expiry-scheduler-test-')) {
    throw new Error('Refusing to remove a path outside this test\'s temporary directory.');
  }
  fs.rmSync(cleanupTarget, { recursive: true, force: true });
});

function atUtcTime(value) {
  return new Date(`${value}T12:00:00.000Z`);
}

function createDeferred() {
  let resolve;
  const promise = new Promise((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function observe(promise) {
  return promise.then(
    (value) => ({ status: 'fulfilled', value }),
    (error) => ({ status: 'rejected', error })
  );
}

const MILESTONE_TIMEOUT_MS = 5000;

async function withWatchdog(promise, description) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Timed out waiting for ${description}.`)),
          MILESTONE_TIMEOUT_MS
        );
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function waitForSignalOrOperation(signal, observedOperation, description) {
  const result = await withWatchdog(Promise.race([
    signal.then(() => ({ signaled: true })),
    observedOperation.then((outcome) => ({ outcome }))
  ]), description);
  assert.equal(result.signaled, true, `${description} before the operation settled`);
}

async function waitForMilestoneWithWatchdog(milestone, observedOperation, description) {
  await waitForSignalOrOperation(milestone, observedOperation, description);
}

async function waitForMilestone(milestone, observedOperation, description) {
  const result = await Promise.race([
    milestone.then(() => ({ reached: true })),
    observedOperation.then((outcome) => ({ outcome }))
  ]);
  assert.equal(result.reached, true, `${description} before the operation settled`);
}

async function addUser(name) {
  return createUser({
    name,
    email: `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now()}-${Math.random()}@example.test`,
    password: 'test-password'
  });
}

async function settleStartedOperations(operations) {
  try {
    await withWatchdog(Promise.all(operations), 'started race-test operations to settle');
    return true;
  } catch {
    return false;
  }
}

function addDocument(ownerId, expiresAt, name = 'Expiry test document') {
  return createDocument({
    ownerId,
    name,
    completed: false,
    expiresAt
  });
}

async function notificationsFor(ownerId) {
  return findNotificationsByOwnerId(ownerId);
}

test('sends UTC 7-day and 1-day reminders, including unlinked documents, idempotently across runs', async () => {
  const user = await addUser('UTC schedule');
  const document = await addDocument(user._id, '2042-06-20');
  assert.equal(document.applicationId, null);
  const scheduler = createExpiryReminderScheduler();

  await scheduler.runOnce(atUtcTime('2042-06-13'));
  let notifications = await notificationsFor(user._id);
  assert.equal(notifications.length, 1);
  assert.match(notifications[0].body, /7-day reminder/);
  assert.equal(notifications[0].dueDate, '2042-06-20');
  assert.equal(notifications[0].documentId, document._id);

  await scheduler.runOnce(atUtcTime('2042-06-13'));
  await scheduler.runOnce(atUtcTime('2042-06-19'));
  notifications = await notificationsFor(user._id);
  assert.equal(notifications.length, 2);
  assert.ok(notifications.some(({ body }) => /1-day reminder/.test(body)));

  const publicNotification = toPublicNotification(notifications[0]);
  assert.equal(Object.hasOwn(publicNotification, 'expiryReminderOccurrenceId'), false);
  assert.equal(Object.hasOwn(publicNotification, 'ownerId'), false);
  await scheduler.runOnce(atUtcTime('2042-06-20'));
  assert.equal((await notificationsFor(user._id)).length, 2);
  await scheduler.runOnce(atUtcTime('2042-06-21'));
  assert.equal((await notificationsFor(user._id)).length, 2);
});

test('catches up with only the latest useful reminder when both occurrences were missed', async () => {
  const user = await addUser('Catch up');
  await addDocument(user._id, '2044-01-08');
  const scheduler = createExpiryReminderScheduler();

  await scheduler.runOnce(atUtcTime('2044-01-07'));

  const notifications = await notificationsFor(user._id);
  assert.equal(notifications.length, 1);
  assert.match(notifications[0].body, /1-day reminder/);
  const sevenDay = await findReminderOccurrenceByKey({
    ownerId: user._id,
    documentId: notifications[0].documentId,
    expiryDate: '2044-01-08',
    leadDays: 7
  });
  assert.equal(sevenDay.inApp.status, 'suppressed');
});

test('sends the 7-day reminder when the 1-day occurrence is not yet due', async () => {
  const user = await addUser('Seven day catch up');
  await addDocument(user._id, '2045-07-10');
  const scheduler = createExpiryReminderScheduler();

  await scheduler.runOnce(atUtcTime('2045-07-03'));

  const notifications = await notificationsFor(user._id);
  assert.equal(notifications.length, 1);
  assert.match(notifications[0].body, /7-day reminder/);
});

test('suppresses due occurrences terminally when preference is disabled and permits future occurrences', async () => {
  const user = await addUser('Disabled preference');
  await updateUserById(user._id, {
    preferences: { notifications: { documentExpiry: false } }
  });
  const suppressedDocument = await addDocument(user._id, '2046-08-10');
  const scheduler = createExpiryReminderScheduler();

  await scheduler.runOnce(atUtcTime('2046-08-09'));
  assert.equal((await notificationsFor(user._id)).length, 0);
  for (const leadDays of [7, 1]) {
    const occurrence = await findReminderOccurrenceByKey({
      ownerId: user._id,
      documentId: suppressedDocument._id,
      expiryDate: '2046-08-10',
      leadDays
    });
    assert.equal(occurrence.inApp.status, 'suppressed');
  }

  await updateUserById(user._id, {
    preferences: { notifications: { documentExpiry: true } }
  });
  await scheduler.runOnce(atUtcTime('2046-08-09'));
  assert.equal((await notificationsFor(user._id)).length, 0);

  await addDocument(user._id, '2046-08-17', 'Future expiry');
  await scheduler.runOnce(atUtcTime('2046-08-10'));
  assert.equal((await notificationsFor(user._id)).length, 1);
});

test('skips missing, expired, deleting, invalid-expiry, and deleting-user records', async () => {
  const activeUser = await addUser('Eligibility');
  const deletingUser = await addUser('Deleting user');
  await markUserDeletingById(deletingUser._id);
  const expired = await addDocument(activeUser._id, '2047-02-02', 'Expires today');
  const deleting = await addDocument(activeUser._id, '2047-02-03', 'Deleting document');
  const invalidExpiry = await addDocument(activeUser._id, '2047-02-30', 'Invalid expiry');
  const missingOwner = await addDocument('missing-user-id', '2047-02-03', 'Missing owner');
  const deletingOwnerDocument = await addDocument(deletingUser._id, '2047-02-03', 'Deleting owner');
  const removed = await addDocument(activeUser._id, '2047-02-03', 'Removed document');
  await markDocumentDeletingById(deleting._id, activeUser._id);
  await markDocumentDeletingById(invalidExpiry._id, activeUser._id);
  await deleteDocumentById(removed._id, activeUser._id);
  const scheduler = createExpiryReminderScheduler();

  await scheduler.runOnce(atUtcTime('2047-02-02'));

  assert.equal((await notificationsFor(activeUser._id)).length, 0);
  assert.equal((await notificationsFor(deletingUser._id)).length, 0);
  assert.equal(await findUserById(missingOwner.ownerId), null);
  assert.equal(await findUserById(deletingOwnerDocument.ownerId).then((user) => user.deleting), true);
  assert.equal(await findReminderOccurrenceByKey({
    ownerId: activeUser._id,
    documentId: expired._id,
    expiryDate: '2047-02-02',
    leadDays: 1
  }), null);
});

test('keeps notification insertion idempotent across scheduler instances', async () => {
  const user = await addUser('Simulated restart');
  await addDocument(user._id, '2048-09-10');

  await createExpiryReminderScheduler().runOnce(atUtcTime('2048-09-03'));
  const schedulerPath = path.resolve(__dirname, '..', 'src', 'services', 'expiryReminderScheduler.js');
  const restartedProcess = spawnSync(process.execPath, [
    '-e',
    [
      `const { createExpiryReminderScheduler } = require(${JSON.stringify(schedulerPath)});`,
      `createExpiryReminderScheduler().runOnce(new Date('2048-09-03T12:00:00.000Z'))`,
      `  .catch((error) => { console.error(error); process.exitCode = 1; });`
    ].join('\n')
  ], {
    cwd: path.resolve(__dirname, '..'),
    env: {
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
      DOCUMENT_CHECKLIST_USERS_DB_PATH: process.env.DOCUMENT_CHECKLIST_USERS_DB_PATH,
      DOCUMENT_CHECKLIST_DOCUMENTS_DB_PATH: process.env.DOCUMENT_CHECKLIST_DOCUMENTS_DB_PATH,
      DOCUMENT_CHECKLIST_APPLICATIONS_DB_PATH: process.env.DOCUMENT_CHECKLIST_APPLICATIONS_DB_PATH,
      DOCUMENT_CHECKLIST_NOTIFICATIONS_DB_PATH: process.env.DOCUMENT_CHECKLIST_NOTIFICATIONS_DB_PATH,
      DOCUMENT_CHECKLIST_EXPIRY_REMINDERS_DB_PATH:
        process.env.DOCUMENT_CHECKLIST_EXPIRY_REMINDERS_DB_PATH
    },
    encoding: 'utf8'
  });
  assert.equal(restartedProcess.status, 0, restartedProcess.stderr);

  const notifications = await notificationsFor(user._id);
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].kind, 'document-expiry');
});

test('records retry after notification persistence failure and retries safely', async () => {
  const user = await addUser('Persistence failure');
  const document = await addDocument(user._id, '2049-10-10');
  const scheduler = createExpiryReminderScheduler({ retryDelayMs: 5 * 60 * 1000 });
  const originalInsert = notificationsDatabase.insert;
  let failNextInsert = true;
  notificationsDatabase.insert = function insertWithOneFailure(notification, callback) {
    if (failNextInsert) {
      failNextInsert = false;
      const error = new Error('Simulated notification persistence failure.');
      error.code = 'SIMULATED_PERSISTENCE_FAILURE';
      callback(error);
      return;
    }
    return originalInsert.call(this, notification, callback);
  };

  try {
    await assert.rejects(
      scheduler.runOnce(new Date('2049-10-09T12:00:00.000Z')),
      AggregateError
    );
    assert.equal((await notificationsFor(user._id)).length, 0);
    const occurrenceInput = {
      ownerId: user._id,
      documentId: document._id,
      expiryDate: '2049-10-10',
      leadDays: 1
    };
    let occurrence = await findReminderOccurrenceByKey(occurrenceInput);
    assert.equal(occurrence.inApp.status, 'retry');
    assert.equal(occurrence.inApp.nextAttemptAt, '2049-10-09T12:05:00.000Z');

    await scheduler.runOnce(new Date('2049-10-09T12:04:59.999Z'));
    assert.equal((await notificationsFor(user._id)).length, 0);
    await scheduler.runOnce(new Date('2049-10-09T12:05:00.000Z'));
    assert.equal((await notificationsFor(user._id)).length, 1);
    occurrence = await findReminderOccurrenceByKey(occurrenceInput);
    assert.equal(occurrence.inApp.status, 'sent');
  } finally {
    notificationsDatabase.insert = originalInsert;
  }
});

test('recovers when notification insertion succeeds but ledger completion fails', async () => {
  const user = await addUser('Ledger completion failure');
  const document = await addDocument(user._id, '2051-11-10');
  const originalComplete = completeReminderChannel;
  const originalFindOne = notificationsDatabase.findOne;
  let failFirstSentCompletion = true;
  let duplicateIdentityLookups = 0;
  let deliveryAttempts = 0;
  const realScheduler = createExpiryReminderScheduler({
    retryDelayMs: 5 * 60 * 1000,
    dependencies: {
      completeReminderChannel: (...args) => {
        if (args[2].status === 'sent' && failFirstSentCompletion) {
          failFirstSentCompletion = false;
          return Promise.reject(new Error('Simulated ledger completion failure.'));
        }
        return originalComplete(...args);
      },
      createDocumentExpiryReminderNotification: (occurrence) => {
        deliveryAttempts += 1;
        return createDocumentExpiryReminderNotification(occurrence);
      }
    }
  });
  notificationsDatabase.findOne = function countIdempotencyLookups(query, callback) {
    if (query && typeof query._id === 'string') {
      duplicateIdentityLookups += 1;
    }
    return originalFindOne.call(this, query, callback);
  };

  try {
    await assert.rejects(
      realScheduler.runOnce(new Date('2051-11-09T12:00:00.000Z')),
      AggregateError
    );
    const occurrenceInput = {
      ownerId: user._id,
      documentId: document._id,
      expiryDate: '2051-11-10',
      leadDays: 1
    };
    let occurrence = await findReminderOccurrenceByKey(occurrenceInput);
    assert.equal(occurrence.inApp.status, 'retry');
    assert.equal((await notificationsFor(user._id)).length, 1);

    await realScheduler.runOnce(new Date('2051-11-09T12:05:00.000Z'));

    occurrence = await findReminderOccurrenceByKey(occurrenceInput);
    const notifications = await notificationsFor(user._id);
    assert.equal(occurrence.inApp.status, 'sent');
    assert.equal(notifications.length, 1);
    assert.equal(notifications[0].expiryReminderOccurrenceId, occurrence._id);
    assert.equal(occurrence.inApp.acknowledgementId, notifications[0]._id);
    assert.equal(deliveryAttempts, 2);
    assert.equal(duplicateIdentityLookups, 1);
  } finally {
    notificationsDatabase.findOne = originalFindOne;
  }
});

test('rejects an existing notification with conflicting occurrence identity', async () => {
  const input = {
    ownerId: 'conflicting-notification-owner',
    documentId: 'conflicting-notification-document',
    documentName: 'Conflicting notification document',
    expiryDate: '2052-12-10',
    leadDays: 7,
    occurrenceId: 'stable-occurrence-identity'
  };
  const inserted = await createDocumentExpiryNotification(input);
  await new Promise((resolve, reject) => {
    notificationsDatabase.update(
      { _id: inserted._id },
      { $set: { expiryReminderOccurrenceId: 'different-occurrence-identity' } },
      {},
      (error, count) => {
        if (error) {
          reject(error);
          return;
        }
        if (count !== 1) {
          reject(new Error('Failed to prepare the conflicting notification fixture.'));
          return;
        }
        resolve();
      }
    );
  });

  await assert.rejects(
    createDocumentExpiryNotification(input),
    {
      code: 'ERR_DOCUMENT_EXPIRY_NOTIFICATION_CONFLICT',
      message: 'A conflicting notification already exists for this reminder occurrence.'
    }
  );
});

test('serializes a second scheduler instance while the first delivery holds the account lock', async () => {
  const user = await addUser('Overlapping scheduler instances');
  const document = await addDocument(user._id, '2053-07-10');
  const deliveryStarted = createDeferred();
  const releaseDelivery = createDeferred();
  const secondLockRequested = createDeferred();
  let secondDeliveryAttempts = 0;

  const firstScheduler = createExpiryReminderScheduler({
    leaseDurationMs: 1000,
    dependencies: {
      createDocumentExpiryReminderNotification: async (occurrence) => {
        deliveryStarted.resolve();
        await releaseDelivery.promise;
        return createDocumentExpiryReminderNotification(occurrence);
      }
    }
  });
  const secondScheduler = createExpiryReminderScheduler({
    leaseDurationMs: 1000,
    dependencies: {
      withAccountOperationLock: (accountId, operation) => {
        secondLockRequested.resolve();
        return withAccountOperationLock(accountId, operation);
      },
      createDocumentExpiryReminderNotification: (occurrence) => {
        secondDeliveryAttempts += 1;
        return createDocumentExpiryNotification(occurrence);
      }
    }
  });

  const firstRunOutcome = observe(firstScheduler.runOnce(
    new Date('2053-07-03T12:00:00.000Z')
  ));
  let secondRunOutcome;
  let secondRunSettled = false;

  try {
    await waitForMilestone(
      deliveryStarted.promise,
      firstRunOutcome,
      'First scheduler delivery started'
    );

    secondRunOutcome = observe(secondScheduler.runOnce(
      new Date('2053-07-03T12:00:01.001Z')
    )).then((outcome) => {
      secondRunSettled = true;
      return outcome;
    });
    await waitForMilestone(
      secondLockRequested.promise,
      secondRunOutcome,
      'Second scheduler requested the account lock'
    );
    assert.equal(secondRunSettled, false);
  } finally {
    releaseDelivery.resolve();
    await Promise.all([
      firstRunOutcome,
      ...(secondRunOutcome ? [secondRunOutcome] : [])
    ]);
  }

  assert.equal((await notificationsFor(user._id)).length, 1);
  const occurrence = await findReminderOccurrenceByKey({
    ownerId: user._id,
    documentId: document._id,
    expiryDate: '2053-07-10',
    leadDays: 7
  });
  assert.equal(occurrence.inApp.status, 'sent');
  assert.equal(occurrence.inApp.acknowledgementId, (await notificationsFor(user._id))[0]._id);
  assert.equal(occurrence.inApp.attemptCount, 1);
  assert.equal(secondDeliveryAttempts, 0);
  assert.equal((await firstRunOutcome).status, 'fulfilled');
  assert.equal((await secondRunOutcome).status, 'fulfilled');
});

test('skips scheduler candidates deleted while waiting for the account lock', async () => {
  const user = await addUser('Document deletion race');
  const document = await addDocument(user._id, '2054-08-10');
  const lockAcquired = createDeferred();
  const beginDeletion = createDeferred();
  const candidatesDiscovered = createDeferred();
  const schedulerLockRequested = createDeferred();
  let deletionResults;
  const lockHolderOutcome = observe(withAccountOperationLock(user._id, async () => {
    lockAcquired.resolve();
    await beginDeletion.promise;
    deletionResults = {
      marked: await markDocumentDeletingById(document._id, user._id),
      deleted: await deleteDocumentById(document._id, user._id)
    };
  }));

  let schedulerOutcome;
  let operationsSettled = true;
  try {
    await waitForSignalOrOperation(
      lockAcquired.promise,
      lockHolderOutcome,
      'Account lock acquisition'
    );
    const scheduler = createExpiryReminderScheduler({
      dependencies: {
        findDocumentsExpiringBetweenUtcDates: async (startDate, endDateExclusive) => {
          const candidates = await findDocumentsExpiringBetweenUtcDates(startDate, endDateExclusive);
          candidatesDiscovered.resolve(candidates);
          return candidates;
        },
        withAccountOperationLock: (accountId, operation) => {
          schedulerLockRequested.resolve();
          return withAccountOperationLock(accountId, operation);
        }
      }
    });
    schedulerOutcome = observe(scheduler.runOnce(
      new Date('2054-08-03T12:00:00.000Z')
    ));

    const candidates = await withWatchdog(Promise.race([
      candidatesDiscovered.promise.then((value) => ({ candidates: value })),
      schedulerOutcome.then((outcome) => ({ outcome }))
    ]), 'scheduler candidate discovery');
    assert.ok(candidates.candidates?.some(({ _id }) => _id === document._id));
    await waitForMilestoneWithWatchdog(
      schedulerLockRequested.promise,
      schedulerOutcome,
      'Scheduler requested the account lock'
    );
    beginDeletion.resolve();
  } finally {
    beginDeletion.resolve();
    operationsSettled = await settleStartedOperations([
      lockHolderOutcome,
      ...(schedulerOutcome ? [schedulerOutcome] : [])
    ]);
  }

  assert.equal(operationsSettled, true);
  assert.equal((await lockHolderOutcome).status, 'fulfilled');
  assert.ok(deletionResults.marked);
  assert.equal(deletionResults.deleted, true);
  assert.equal((await schedulerOutcome).status, 'fulfilled');
  assert.equal(await findDocumentById(document._id, user._id), null);
  for (const leadDays of [7, 1]) {
    assert.equal(await findReminderOccurrenceByKey({
      ownerId: user._id,
      documentId: document._id,
      expiryDate: '2054-08-10',
      leadDays
    }), null);
  }
  assert.equal((await notificationsFor(user._id)).length, 0);
});

test('skips scheduler candidates when account deletion wins the account lock', async () => {
  const user = await addUser('Account deletion race');
  const document = await addDocument(user._id, '2055-09-10');
  const lockAcquired = createDeferred();
  const beginDeletion = createDeferred();
  const candidatesDiscovered = createDeferred();
  const schedulerLockRequested = createDeferred();
  let deletionResults;
  const lockHolderOutcome = observe(withAccountOperationLock(user._id, async () => {
    lockAcquired.resolve();
    await beginDeletion.promise;
    deletionResults = {
      marked: await markUserDeletingById(user._id),
      deletedDocuments: await deleteDocumentsByOwnerId(user._id),
      deletedUser: await deleteUserById(user._id)
    };
  }));

  let schedulerOutcome;
  let operationsSettled = true;
  try {
    await waitForSignalOrOperation(
      lockAcquired.promise,
      lockHolderOutcome,
      'Account lock acquisition'
    );
    const scheduler = createExpiryReminderScheduler({
      dependencies: {
        findDocumentsExpiringBetweenUtcDates: async (startDate, endDateExclusive) => {
          const candidates = await findDocumentsExpiringBetweenUtcDates(startDate, endDateExclusive);
          candidatesDiscovered.resolve(candidates);
          return candidates;
        },
        withAccountOperationLock: (accountId, operation) => {
          schedulerLockRequested.resolve();
          return withAccountOperationLock(accountId, operation);
        }
      }
    });
    schedulerOutcome = observe(scheduler.runOnce(
      new Date('2055-09-03T12:00:00.000Z')
    ));

    const candidates = await withWatchdog(Promise.race([
      candidatesDiscovered.promise.then((value) => ({ candidates: value })),
      schedulerOutcome.then((outcome) => ({ outcome }))
    ]), 'scheduler candidate discovery');
    assert.ok(candidates.candidates?.some(({ _id }) => _id === document._id));
    await waitForMilestoneWithWatchdog(
      schedulerLockRequested.promise,
      schedulerOutcome,
      'Scheduler requested the account lock'
    );
    beginDeletion.resolve();
  } finally {
    beginDeletion.resolve();
    operationsSettled = await settleStartedOperations([
      lockHolderOutcome,
      ...(schedulerOutcome ? [schedulerOutcome] : [])
    ]);
  }

  assert.equal(operationsSettled, true);
  assert.equal((await lockHolderOutcome).status, 'fulfilled');
  assert.ok(deletionResults.marked);
  assert.equal(deletionResults.deletedDocuments, 1);
  assert.equal(deletionResults.deletedUser, true);
  assert.equal((await schedulerOutcome).status, 'fulfilled');
  assert.equal(await findUserById(user._id), null);
  assert.equal(await findDocumentById(document._id, user._id), null);
  for (const leadDays of [7, 1]) {
    assert.equal(await findReminderOccurrenceByKey({
      ownerId: user._id,
      documentId: document._id,
      expiryDate: '2055-09-10',
      leadDays
    }), null);
  }
  assert.equal((await notificationsFor(user._id)).length, 0);
});

test('coalesces overlapping runs and reports background failures safely', async () => {
  let releaseQuery;
  let queryCount = 0;
  const gate = new Promise((resolve) => {
    releaseQuery = resolve;
  });
  const scheduler = createExpiryReminderScheduler({
    dependencies: {
      findDocumentsExpiringBetweenUtcDates: async () => {
        queryCount += 1;
        await gate;
        return [];
      }
    }
  });
  const firstRun = scheduler.runOnce(atUtcTime('2050-01-01'));
  const overlappingRun = scheduler.runOnce(atUtcTime('2050-01-02'));
  assert.equal(overlappingRun, firstRun);
  releaseQuery();
  await Promise.all([firstRun, overlappingRun]);
  assert.equal(queryCount, 1);

  const reported = [];
  const failingScheduler = createExpiryReminderScheduler({
    intervalMs: 60_000,
    logger: { error: (...args) => reported.push(args) },
    dependencies: {
      findDocumentsExpiringBetweenUtcDates: async () => {
        throw new Error('Simulated scheduler query failure.');
      }
    }
  });
  await failingScheduler.start();
  await failingScheduler.stop();
  assert.equal(reported.length, 1);
  assert.match(reported[0][0], /scheduler run failed/);
  assert.match(reported[0][1].message, /Simulated scheduler query failure/);
});

test('starts the scheduler only after deletion recovery, ledger initialization, and listening', async () => {
  const events = [];
  let releaseDocumentRecovery;
  const documentRecovery = new Promise((resolve) => {
    releaseDocumentRecovery = resolve;
  });
  const startup = startServerAfterRecovery({
    recoverPendingDocumentDeletions: async () => {
      events.push('document-recovery-start');
      await documentRecovery;
      events.push('document-recovery-complete');
    },
    recoverPendingAccountDeletions: async () => events.push('account-recovery'),
    initializeExpiryRemindersDatabase: async () => events.push('ledger-initialized'),
    startListening: async () => {
      events.push('listening');
      return 'server';
    },
    startReminderScheduler: async () => events.push('scheduler-started')
  });

  await Promise.resolve();
  assert.deepEqual(events, ['document-recovery-start']);
  releaseDocumentRecovery();
  assert.equal(await startup, 'server');
  assert.deepEqual(events, [
    'document-recovery-start',
    'document-recovery-complete',
    'account-recovery',
    'ledger-initialized',
    'listening',
    'scheduler-started'
  ]);
});
