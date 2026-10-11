async function startServerAfterRecovery({
  initializeExpiryRemindersDatabase,
  initializeExpiryReminderCleanupDatabase,
  recoverPendingExpiryReminderCleanup,
  recoverPendingDocumentDeletions,
  recoverPendingAccountDeletions,
  startListening,
  startReminderScheduler
}) {
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
