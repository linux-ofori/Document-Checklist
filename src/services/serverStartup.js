async function startServerAfterRecovery({
  recoverPendingDocumentDeletions,
  recoverPendingAccountDeletions,
  initializeExpiryRemindersDatabase,
  startListening,
  startReminderScheduler
}) {
  await recoverPendingDocumentDeletions();
  await recoverPendingAccountDeletions();
  await initializeExpiryRemindersDatabase();
  const server = await startListening();
  await startReminderScheduler();
  return server;
}

module.exports = { startServerAfterRecovery };
