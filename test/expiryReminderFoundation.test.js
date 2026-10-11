const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, test } = require('node:test');

const temporaryDirectory = fs.mkdtempSync(
  path.join(os.tmpdir(), 'document-checklist-expiry-reminder-test-')
);
process.env.DOCUMENT_CHECKLIST_USERS_DB_PATH = path.join(temporaryDirectory, 'users.db');
process.env.DOCUMENT_CHECKLIST_DOCUMENTS_DB_PATH = path.join(temporaryDirectory, 'documents.db');
process.env.DOCUMENT_CHECKLIST_APPLICATIONS_DB_PATH = path.join(temporaryDirectory, 'applications.db');
process.env.DOCUMENT_CHECKLIST_NOTIFICATIONS_DB_PATH = path.join(temporaryDirectory, 'notifications.db');
process.env.DOCUMENT_CHECKLIST_EXPIRY_REMINDERS_DB_PATH =
  path.join(temporaryDirectory, 'expiry-reminders.db');
process.env.DOCUMENT_CHECKLIST_EXPIRY_REMINDER_CLEANUP_DB_PATH =
  path.join(temporaryDirectory, 'expiry-reminder-cleanup.db');

const Datastore = require('@seald-io/nedb');
const { expiryRemindersDatabasePath } = require('../src/config/databasePaths');
const { database: expiryRemindersDatabase } = require('../src/config/expiryRemindersDatabase');
const {
  database: cleanupJournalDatabase,
  initializeExpiryReminderCleanupDatabase
} = require('../src/config/expiryReminderCleanupDatabase');
const { recoverPendingExpiryReminderCleanup } = require('../src/services/expiryReminderCleanup');
const documentModel = require('../src/models/documentModel');
const {
  claimReminderChannel,
  completeReminderChannel,
  createReminderOccurrence,
  findReminderOccurrenceByKey,
  findReminderOccurrencesDue
} = require('../src/models/expiryReminderModel');
const {
  getExpiryReminderSchedule,
  getUtcDateDaysBefore,
  normalizeExpiryUtcDate
} = require('../src/services/expiryReminderSchedule');
const databasePathsModule = path.resolve(__dirname, '..', 'src', 'config', 'databasePaths.js');

after(() => {
  const cleanupTarget = path.resolve(temporaryDirectory);
  if (path.dirname(cleanupTarget) !== path.resolve(os.tmpdir())
      || !path.basename(cleanupTarget).startsWith('document-checklist-expiry-reminder-test-')) {
    throw new Error('Refusing to remove a path outside this test\'s temporary directory.');
  }
  fs.rmSync(cleanupTarget, { recursive: true, force: true });
});

function findOne(database, query) {
  return new Promise((resolve, reject) => {
    database.findOne(query, (error, document) => error ? reject(error) : resolve(document));
  });
}

test('calculates 7-day and 1-day reminders by UTC calendar date', () => {
  assert.deepEqual(getExpiryReminderSchedule('2030-01-10'), {
    expiryDate: '2030-01-10',
    reminders: [
      { leadDays: 7, scheduledDate: '2030-01-03' },
      { leadDays: 1, scheduledDate: '2030-01-09' }
    ]
  });
  assert.equal(
    normalizeExpiryUtcDate('2030-01-01T00:30:00+02:00'),
    '2029-12-31'
  );
  assert.deepEqual(getExpiryReminderSchedule('2024-03-01T00:00:00.000Z').reminders, [
    { leadDays: 7, scheduledDate: '2024-02-23' },
    { leadDays: 1, scheduledDate: '2024-02-29' }
  ]);
  assert.equal(getUtcDateDaysBefore('2024-03-01', 1), '2024-02-29');
  assert.equal(getUtcDateDaysBefore('2024-01-01', 1), '2023-12-31');
  assert.equal(
    normalizeExpiryUtcDate('2030-01-01T00:00:00-01:00'),
    '2030-01-01'
  );
  assert.equal(
    normalizeExpiryUtcDate('2030-01-01T23:59:59.999Z'),
    '2030-01-01'
  );
  assert.equal(normalizeExpiryUtcDate('2030-01-01T00:00:00.1Z'), '2030-01-01');
});

test('rejects invalid calendar dates, date-times, and timezone offsets', () => {
  for (const expiry of [
    '2030-02-29',
    '2030-04-31T12:00:00Z',
    '2030-01-01T12:00:00',
    '2030-01-01T24:00:00Z',
    '2030-01-01T12:60:00Z',
    '2030-01-01T12:00:60Z',
    '2030-01-01T12:00:00+24:00',
    '2030-01-01T12:00:00-01:60',
    '2030-01-01T12:00:00+01:60'
  ]) {
    assert.throws(() => normalizeExpiryUtcDate(expiry), TypeError, expiry);
  }
  assert.throws(() => getUtcDateDaysBefore('2030-01-01', -1), TypeError);
  assert.throws(() => getUtcDateDaysBefore('2030-01-01', 1.5), TypeError);
  assert.throws(() => getUtcDateDaysBefore('0000-01-01', Number.MAX_SAFE_INTEGER), TypeError);
});

test('rejects a reminder database path that collides with an existing database path', () => {
  const duplicatePath = path.join(temporaryDirectory, 'shared.db');
  const result = spawnSync(process.execPath, [
    '-e',
    `require(${JSON.stringify(databasePathsModule)})`
  ], {
    cwd: path.resolve(__dirname, '..'),
    env: {
      DOCUMENT_CHECKLIST_USERS_DB_PATH: duplicatePath,
      DOCUMENT_CHECKLIST_EXPIRY_REMINDERS_DB_PATH: duplicatePath
    },
    encoding: 'utf8'
  });

  test('rejects a cleanup journal path that collides with an existing database path', () => {
    const duplicatePath = path.join(temporaryDirectory, 'shared-cleanup.db');
    const result = spawnSync(process.execPath, [
      '-e',
      `require(${JSON.stringify(databasePathsModule)})`
    ], {
      cwd: path.resolve(__dirname, '..'),
      env: {
        DOCUMENT_CHECKLIST_USERS_DB_PATH: duplicatePath,
        DOCUMENT_CHECKLIST_EXPIRY_REMINDER_CLEANUP_DB_PATH: duplicatePath
      },
      encoding: 'utf8'
    });

    test('preserves malformed cleanup journal records and fails recovery visibly', async () => {
      await initializeExpiryReminderCleanupDatabase();
      const malformed = {
        _id: 'malformed-cleanup-record',
        type: 'unknown-operation',
        state: 'pending',
        ownerId: 'owner-malformed',
        occurrenceIds: [],
        schemaVersion: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      await new Promise((resolve, reject) => {
        cleanupJournalDatabase.insert(malformed, (error) => error ? reject(error) : resolve());
      });

      await assert.rejects(recoverPendingExpiryReminderCleanup(), /malformed or unsupported/);
      const preserved = await findOne(cleanupJournalDatabase, { _id: malformed._id });
      assert.deepEqual(preserved, malformed);
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /users and expiry reminder cleanup database paths must be different/);
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /users and expiry reminders database paths must be different/);
});

test('propagates a reminder ledger index initialization failure to model operations', () => {
  const invalidDatabasePath = path.join(temporaryDirectory, 'duplicate-occurrences.db');
  fs.writeFileSync(invalidDatabasePath, [
    JSON.stringify({ _id: 'duplicate-1', occurrenceKey: 'duplicate-key' }),
    JSON.stringify({ _id: 'duplicate-2', occurrenceKey: 'duplicate-key' })
  ].join('\n'));

  const environment = {
    PATH: process.env.PATH,
    SystemRoot: process.env.SystemRoot,
    DOCUMENT_CHECKLIST_USERS_DB_PATH: path.join(temporaryDirectory, 'failure-users.db'),
    DOCUMENT_CHECKLIST_DOCUMENTS_DB_PATH: path.join(temporaryDirectory, 'failure-documents.db'),
    DOCUMENT_CHECKLIST_APPLICATIONS_DB_PATH: path.join(temporaryDirectory, 'failure-applications.db'),
    DOCUMENT_CHECKLIST_NOTIFICATIONS_DB_PATH: path.join(temporaryDirectory, 'failure-notifications.db'),
    DOCUMENT_CHECKLIST_EXPIRY_REMINDERS_DB_PATH: invalidDatabasePath
  };
  const result = spawnSync(process.execPath, [
    '-e',
    [
      `const model = require(${JSON.stringify(path.resolve(__dirname, '..', 'src', 'models', 'expiryReminderModel.js'))});`,
      `model.createReminderOccurrence({ ownerId: 'owner', documentId: 'document', expiryDate: '2030-01-10', leadDays: 7 })`,
      `  .then(() => { console.error('Expected index initialization to fail.'); process.exitCode = 2; })`,
      `  .catch((error) => { console.log(error.errorType || error.message); });`
    ].join('\n')
  ], {
    cwd: path.resolve(__dirname, '..'),
    env: environment,
    encoding: 'utf8'
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /uniqueViolated|unique/i);
});

test('returns an identical occurrence idempotently', async () => {
  const input = {
    ownerId: 'owner-idempotent',
    documentId: 'document-idempotent',
    expiryDate: '2030-01-10',
    leadDays: 7
  };
  const first = await createReminderOccurrence(input);
  const duplicate = await createReminderOccurrence(input);

  assert.equal(first.created, true);
  assert.equal(duplicate.created, false);
  assert.deepEqual(duplicate.occurrence, first.occurrence);
});

test('rejects a duplicate key whose stored immutable occurrence data conflicts', async () => {
  const input = {
    ownerId: 'owner-conflict',
    documentId: 'document-conflict',
    expiryDate: '2030-01-10',
    leadDays: 7
  };
  const { occurrence } = await createReminderOccurrence(input);
  await new Promise((resolve, reject) => {
    expiryRemindersDatabase.update(
      { _id: occurrence._id },
      { $set: { scheduledDate: '2030-01-04' } },
      {},
      (error, count) => {
        if (error) {
          reject(error);
          return;
        }
        if (count !== 1) {
          reject(new Error('Failed to prepare the conflicting occurrence fixture.'));
          return;
        }
        resolve();
      }
    );
  });

  await assert.rejects(
    createReminderOccurrence(input),
    {
      code: 'ERR_EXPIRY_REMINDER_OCCURRENCE_CONFLICT',
      message: 'A conflicting reminder occurrence already exists for this occurrence key.'
    }
  );
});

test('creates unique occurrences safely on repeated calls and keeps channel states independent', async () => {
  const input = {
    ownerId: 'owner-1',
    documentId: 'document-1',
    expiryDate: '2030-01-10',
    leadDays: 7
  };
  const results = await Promise.all(Array.from({ length: 5 }, () =>
    createReminderOccurrence(input)));
  const created = results.filter((result) => result.created);
  const occurrences = results.map((result) => result.occurrence);

  assert.equal(created.length, 1);
  assert.equal(new Set(occurrences.map((occurrence) => occurrence._id)).size, 1);
  assert.equal(occurrences[0].scheduledDate, '2030-01-03');
  assert.equal(occurrences[0].inApp.status, 'pending');
  assert.equal(occurrences[0].email.status, 'pending');
  assert.equal(occurrences[0].inApp.attemptCount, 0);
  assert.equal(occurrences[0].email.attemptCount, 0);
  const found = await findReminderOccurrenceByKey(input);
  assert.equal(found._id, occurrences[0]._id);

  const equivalentTimestamp = await createReminderOccurrence({
    ...input,
    expiryDate: '2030-01-10T02:30:00+02:00'
  });
  assert.equal(equivalentTimestamp.created, false);
  assert.equal(equivalentTimestamp.occurrence._id, occurrences[0]._id);
  assert.equal(equivalentTimestamp.occurrence.expiryDate, '2030-01-10');
});

test('rejects malformed occurrence inputs and uses canonical UTC expiry dates', async () => {
  const invalidInputs = [
    null,
    [],
    { ownerId: '', documentId: 'document', expiryDate: '2030-01-10', leadDays: 7 },
    { ownerId: ' owner', documentId: 'document', expiryDate: '2030-01-10', leadDays: 7 },
    { ownerId: 'owner', documentId: '', expiryDate: '2030-01-10', leadDays: 7 },
    { ownerId: 'owner', documentId: 'document ', expiryDate: '2030-01-10', leadDays: 7 },
    { ownerId: 'owner', documentId: 'document', expiryDate: '2030-02-30', leadDays: 7 },
    { ownerId: 'owner', documentId: 'document', expiryDate: '2030-01-10T24:00:00Z', leadDays: 7 },
    { ownerId: 'owner', documentId: 'document', expiryDate: '2030-01-10', leadDays: 0 },
    {
      ownerId: 'owner',
      documentId: 'document',
      expiryDate: '2030-01-10',
      leadDays: 7,
      scheduledDate: 'forged'
    }
  ];
  for (const input of invalidInputs) {
    assert.throws(() => createReminderOccurrence(input), TypeError);
  }

  const dateOnly = await createReminderOccurrence({
    ownerId: 'canonical-owner',
    documentId: 'canonical-document',
    expiryDate: '2030-01-10',
    leadDays: 1
  });
  const offsetTimestamp = await createReminderOccurrence({
    ownerId: 'canonical-owner',
    documentId: 'canonical-document',
    expiryDate: '2030-01-10T00:30:00+02:00',
    leadDays: 1
  });
  assert.equal(dateOnly.occurrence.expiryDate, '2030-01-10');
  assert.equal(offsetTimestamp.occurrence.expiryDate, '2030-01-09');
  assert.notEqual(dateOnly.occurrence._id, offsetTimestamp.occurrence._id);
});

test('persists independent claims and channel state across database reopen', async () => {
  const input = {
    ownerId: 'owner-2',
    documentId: 'document-2',
    expiryDate: '2032-06-20',
    leadDays: 1
  };
  const { occurrence } = await createReminderOccurrence(input);
  const claimTime = '2032-06-19T00:00:00.000Z';
  const inAppClaim = await claimReminderChannel(occurrence._id, 'inApp', {
    now: claimTime,
    leaseDurationMs: 30000
  });
  assert.equal(inAppClaim.inApp.status, 'claimed');
  assert.equal(inAppClaim.inApp.attemptCount, 1);
  assert.equal(await claimReminderChannel(occurrence._id, 'inApp', { now: claimTime }), null);

  const completed = await completeReminderChannel(occurrence._id, 'inApp', {
    leaseToken: inAppClaim.inApp.leaseToken,
    status: 'sent',
    now: claimTime,
    acknowledgementId: 'notification-id'
  });
  assert.equal(completed.inApp.status, 'sent');
  assert.equal(completed.email.status, 'pending');

  const emailClaim = await claimReminderChannel(occurrence._id, 'email', {
    now: claimTime,
    leaseDurationMs: 30000
  });
  assert.equal(emailClaim.email.status, 'claimed');

  const reopened = new Datastore({ filename: expiryRemindersDatabasePath, autoload: true });
  const persisted = await findOne(reopened, { _id: occurrence._id });
  assert.equal(persisted.inApp.status, 'sent');
  assert.equal(persisted.inApp.acknowledgementId, 'notification-id');
  assert.equal(persisted.email.status, 'claimed');
  assert.equal(persisted.email.attemptCount, 1);
  assert.equal(persisted.occurrenceKey, occurrence.occurrenceKey);
});

test('serializes concurrent claims, reclaims expired leases, and rejects stale tokens', async () => {
  const { occurrence } = await createReminderOccurrence({
    ownerId: 'owner-claim',
    documentId: 'document-claim',
    expiryDate: '2036-02-10',
    leadDays: 7
  });
  const claimTime = '2036-02-03T00:00:00.000Z';
  const claims = await Promise.all(Array.from({ length: 8 }, () =>
    claimReminderChannel(occurrence._id, 'inApp', {
      now: claimTime,
      leaseDurationMs: 1000
    })));
  const initialClaims = claims.filter(Boolean);
  assert.equal(initialClaims.length, 1);
  const staleToken = initialClaims[0].inApp.leaseToken;

  assert.equal(await claimReminderChannel(occurrence._id, 'inApp', {
    now: '2036-02-03T00:00:00.000Z'
  }), null);
  assert.equal(await claimReminderChannel(occurrence._id, 'inApp', {
    now: '2036-02-03T00:00:00.999Z'
  }), null);

  const reclaimed = await claimReminderChannel(occurrence._id, 'inApp', {
    now: '2036-02-03T00:00:01.000Z',
    leaseDurationMs: 1000
  });
  assert.ok(reclaimed);
  assert.notEqual(reclaimed.inApp.leaseToken, staleToken);
  assert.equal(reclaimed.inApp.attemptCount, 2);

  const staleCompletion = await completeReminderChannel(occurrence._id, 'inApp', {
    leaseToken: staleToken,
    status: 'sent',
    now: '2036-02-03T00:00:01.000Z',
    acknowledgementId: 'stale-ack'
  });
  assert.equal(staleCompletion, null);

  const currentCompletion = await completeReminderChannel(occurrence._id, 'inApp', {
    leaseToken: reclaimed.inApp.leaseToken,
    status: 'sent',
    now: '2036-02-03T00:00:01.000Z',
    acknowledgementId: 'current-ack'
  });
  assert.equal(currentCompletion.inApp.status, 'sent');
  assert.equal(currentCompletion.inApp.acknowledgementId, 'current-ack');
});

test('suppressed channels cannot be claimed again', async () => {
  const { occurrence } = await createReminderOccurrence({
    ownerId: 'owner-suppressed',
    documentId: 'document-suppressed',
    expiryDate: '2038-05-10',
    leadDays: 7
  });
  const claim = await claimReminderChannel(occurrence._id, 'inApp', {
    now: '2038-05-03T00:00:00.000Z'
  });
  const suppressed = await completeReminderChannel(occurrence._id, 'inApp', {
    leaseToken: claim.inApp.leaseToken,
    status: 'suppressed',
    now: '2038-05-03T00:00:00.000Z'
  });

  assert.equal(suppressed.inApp.status, 'suppressed');
  assert.equal(await claimReminderChannel(occurrence._id, 'inApp', {
    now: '2038-05-03T00:01:00.000Z'
  }), null);
});

test('retry channels cannot be claimed before their retry-eligible time', async () => {
  const { occurrence } = await createReminderOccurrence({
    ownerId: 'owner-retry-claim',
    documentId: 'document-retry-claim',
    expiryDate: '2039-05-10',
    leadDays: 7
  });
  const initialClaim = await claimReminderChannel(occurrence._id, 'inApp', {
    now: '2039-05-03T00:00:00.000Z'
  });
  await completeReminderChannel(occurrence._id, 'inApp', {
    leaseToken: initialClaim.inApp.leaseToken,
    status: 'retry',
    now: '2039-05-03T00:00:00.000Z',
    nextAttemptAt: '2039-05-03T00:05:00.000Z',
    lastErrorCode: 'TEMPORARY_FAILURE'
  });

  assert.equal(await claimReminderChannel(occurrence._id, 'inApp', {
    now: '2039-05-03T00:04:59.999Z'
  }), null);
  const retryClaim = await claimReminderChannel(occurrence._id, 'inApp', {
    now: '2039-05-03T00:05:00.000Z'
  });

  assert.ok(retryClaim);
  assert.equal(retryClaim.inApp.status, 'claimed');
  assert.equal(retryClaim.inApp.attemptCount, 2);
});

test('lists only due channel work whose retry or lease is ready', async () => {
  const due = await createReminderOccurrence({
    ownerId: 'owner-4',
    documentId: 'due-document',
    expiryDate: '2040-02-10',
    leadDays: 7
  });
  const upcoming = await createReminderOccurrence({
    ownerId: 'owner-4',
    documentId: 'upcoming-document',
    expiryDate: '2040-02-11',
    leadDays: 7
  });
  const expiringToday = await createReminderOccurrence({
    ownerId: 'owner-4',
    documentId: 'today-document',
    expiryDate: '2040-02-03',
    leadDays: 1
  });
  const expiredYesterday = await createReminderOccurrence({
    ownerId: 'owner-4',
    documentId: 'expired-document',
    expiryDate: '2040-02-02',
    leadDays: 1
  });
  const dueInAppClaim = await claimReminderChannel(due.occurrence._id, 'inApp', {
    now: '2040-02-02T00:00:00.000Z'
  });
  await completeReminderChannel(due.occurrence._id, 'inApp', {
    leaseToken: dueInAppClaim.inApp.leaseToken,
    status: 'retry',
    now: '2040-02-02T00:00:00.000Z',
    nextAttemptAt: '2040-02-02T00:05:00.000Z',
    lastErrorCode: 'TEMPORARY_FAILURE'
  });

  const notYetRetryable = await findReminderOccurrencesDue('inApp', {
    throughDate: '2040-02-03',
    now: '2040-02-02T00:04:59.999Z'
  });
  assert.equal(notYetRetryable.length, 0);

  const dueNow = await findReminderOccurrencesDue('inApp', {
    throughDate: '2040-02-03',
    now: '2040-02-02T00:05:00.000Z'
  });
  assert.deepEqual(dueNow.map((occurrence) => occurrence._id), [due.occurrence._id]);
  assert.equal(dueNow.some((occurrence) =>
    [expiringToday.occurrence._id, expiredYesterday.occurrence._id].includes(occurrence._id)), false);
  const dueEmail = await findReminderOccurrencesDue('email', {
    throughDate: '2040-02-03',
    now: '2040-02-02T00:05:00.000Z'
  });
  assert.deepEqual(dueEmail.map((occurrence) => occurrence._id), [due.occurrence._id]);
  assert.equal(dueEmail.some((occurrence) => occurrence._id === upcoming.occurrence._id), false);

  const leasedOccurrence = await createReminderOccurrence({
    ownerId: 'owner-4',
    documentId: 'leased-document',
    expiryDate: '2040-02-10',
    leadDays: 7
  });
  const lease = await claimReminderChannel(leasedOccurrence.occurrence._id, 'inApp', {
    now: '2040-02-03T00:00:00.000Z',
    leaseDurationMs: 1000
  });
  const beforeLeaseExpiry = await findReminderOccurrencesDue('inApp', {
    throughDate: '2040-02-03',
    now: '2040-02-03T00:00:00.999Z'
  });
  assert.equal(beforeLeaseExpiry.some((entry) => entry._id === leasedOccurrence.occurrence._id), false);

  const atLeaseExpiry = await findReminderOccurrencesDue('inApp', {
    throughDate: '2040-02-03',
    now: '2040-02-03T00:00:01.000Z'
  });
  assert.equal(atLeaseExpiry.some((entry) => entry._id === leasedOccurrence.occurrence._id), true);
  assert.equal(lease.inApp.status, 'claimed');
});

test('queries active documents across a bounded UTC expiry-date range', async () => {
  const start = await documentModel.createDocument({
    ownerId: 'owner-3',
    name: 'Start date',
    completed: false,
    expiresAt: '2035-04-10'
  });
  const withinRange = await documentModel.createDocument({
    ownerId: 'owner-3',
    name: 'End date',
    completed: false,
    expiresAt: '2035-04-11T23:59:59.000Z'
  });
  const end = await documentModel.createDocument({
    ownerId: 'owner-3',
    name: 'Exclusive end',
    completed: false,
    expiresAt: '2035-04-12T00:00:00.000Z'
  });
  const deleting = await documentModel.createDocument({
    ownerId: 'owner-3',
    name: 'Deleting',
    completed: false,
    expiresAt: '2035-04-11T12:00:00.000Z'
  });
  await documentModel.markDocumentDeletingById(deleting._id, 'owner-3');

  const results = await documentModel.findDocumentsExpiringBetweenUtcDates(
    '2035-04-10',
    '2035-04-12'
  );
  assert.deepEqual(results.map((document) => document._id), [start._id, withinRange._id]);
  assert.equal(results.length, 2);
  assert.equal(results.some((document) => document._id === end._id), false);
  assert.throws(
    () => documentModel.findDocumentsExpiringBetweenUtcDates('2035-04-12', '2035-04-12'),
    RangeError
  );
  assert.throws(
    () => documentModel.findDocumentsExpiringBetweenUtcDates('2035-02-30', '2035-03-01'),
    TypeError
  );
});
