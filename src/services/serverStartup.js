async function startServerAfterRecovery({
  initializeUserDatabase,
  initializeExpiryRemindersDatabase,
  initializeExpiryReminderCleanupDatabase,
  recoverPendingExpiryReminderCleanup,
  recoverPendingDocumentDeletions,
  recoverPendingAccountDeletions,
  startListening,
  startReminderScheduler
}) {
  await initializeUserDatabase();
  await initializeExpiryRemindersDatabase();
  await initializeExpiryReminderCleanupDatabase();
  await recoverPendingExpiryReminderCleanup();
  await recoverPendingDocumentDeletions();
  await recoverPendingAccountDeletions();
  const server = await startListening();
  await startReminderScheduler();
  return server;
}

module.exports = { startServerAfterRecovery };
