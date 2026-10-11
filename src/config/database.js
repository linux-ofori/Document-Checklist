const Datastore = require('@seald-io/nedb');
const { usersDatabasePath: databaseFile, prepareDatabaseFile } = require('./databasePaths');

prepareDatabaseFile(databaseFile);

const database = new Datastore({
  filename: databaseFile,
  autoload: true
});

let initializationPromise;

function initializeUserDatabase() {
  if (!initializationPromise) {
    initializationPromise = (async () => {
      await database.ensureIndexAsync({ fieldName: 'email', unique: true });
      await database.ensureIndexAsync({
        fieldName: 'googleSubject',
        unique: true,
        sparse: true
      });
    })();
  }

  return initializationPromise;
}

module.exports = database;
module.exports.initializeUserDatabase = initializeUserDatabase;
