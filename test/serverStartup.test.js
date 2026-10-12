const assert = require('node:assert/strict');
const { test } = require('node:test');
const { startServerAfterRecovery } = require('../src/services/serverStartup');

test('does not accept requests when user database index initialization fails', async () => {
  let listened = false;
  await assert.rejects(startServerAfterRecovery({
    initializeUserDatabase: async () => {
      throw new Error('user index initialization failed');
    },
    initializeExpiryRemindersDatabase: async () => {},
    initializeExpiryReminderCleanupDatabase: async () => {},
    recoverPendingExpiryReminderCleanup: async () => {},
    recoverPendingDocumentDeletions: async () => {},
    recoverPendingAccountDeletions: async () => {},
    startListening: async () => {
      listened = true;
    },
    startReminderScheduler: async () => {}
  }), /user index initialization failed/);
  assert.equal(listened, false);
});

test('initializes database indexes and recovers accounts before listening', async () => {
  const steps = [];
  await startServerAfterRecovery({
    initializeUserDatabase: async () => steps.push('user-indexes'),
    initializeExpiryRemindersDatabase: async () => steps.push('reminder-indexes'),
    initializeExpiryReminderCleanupDatabase: async () => steps.push('cleanup-indexes'),
    recoverPendingExpiryReminderCleanup: async () => steps.push('cleanup-recovery'),
    recoverPendingDocumentDeletions: async () => steps.push('document-recovery'),
    recoverPendingAccountDeletions: async () => steps.push('account-recovery'),
    startListening: async () => {
      steps.push('listen');
      return 'server';
    },
    startReminderScheduler: async () => steps.push('scheduler')
  });
  assert.deepEqual(steps, [
    'user-indexes',
    'reminder-indexes',
    'cleanup-indexes',
    'cleanup-recovery',
    'document-recovery',
    'account-recovery',
    'listen',
    'scheduler'
  ]);
});
