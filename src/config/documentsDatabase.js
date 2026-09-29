const fs = require('node:fs');
const path = require('node:path');
const Datastore = require('@seald-io/nedb');
const { documentsDatabasePath: databaseFile } = require('./databasePaths');

fs.mkdirSync(path.dirname(databaseFile), { recursive: true });

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