const Datastore = require('@seald-io/nedb');
const { applicationsDatabasePath: databaseFile, prepareDatabaseFile } = require('./databasePaths');

prepareDatabaseFile(databaseFile);

const database = new Datastore({
  filename: databaseFile,
  autoload: true
});

database.ensureIndex({ fieldName: 'ownerId' }, (error) => {
  if (error) {
    throw error;
  }
});

module.exports = database;
