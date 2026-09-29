const fs = require('node:fs');
const path = require('node:path');
const Datastore = require('@seald-io/nedb');
const { usersDatabasePath: databaseFile } = require('./databasePaths');

fs.mkdirSync(path.dirname(databaseFile), { recursive: true });

const database = new Datastore({
  filename: databaseFile,
  autoload: true
});

database.ensureIndex({ fieldName: 'email', unique: true }, (error) => {
  if (error) {
    throw error;
  }
});

module.exports = database;
