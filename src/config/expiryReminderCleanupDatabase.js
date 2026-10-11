const Datastore = require('@seald-io/nedb');
const {
  expiryReminderCleanupDatabasePath: databaseFile,
  prepareDatabaseFile
} = require('./databasePaths');

prepareDatabaseFile(databaseFile);

const database = new Datastore({
  filename: databaseFile,
  autoload: false
});

let initialization;

function ensureIndex(index) {
  return new Promise((resolve, reject) => {
    database.ensureIndex(index, (error) => error ? reject(error) : resolve());
  });
}

function initializeExpiryReminderCleanupDatabase() {
  if (!initialization) {
    initialization = new Promise((resolve, reject) => {
      database.loadDatabase((error) => error ? reject(error) : resolve());
    }).then(async () => {
      await ensureIndex({ fieldName: 'ownerId' });
      await ensureIndex({ fieldName: 'type' });
    });
  }

  return initialization;
}

module.exports = {
  database,
  initializeExpiryReminderCleanupDatabase
};
