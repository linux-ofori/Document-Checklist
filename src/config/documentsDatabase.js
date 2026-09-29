const fs = require('node:fs');
const path = require('node:path');
const Datastore = require('@seald-io/nedb');

const dataDirectory = path.join(__dirname, '..', '..', 'data');
fs.mkdirSync(dataDirectory, { recursive: true });

const database = new Datastore({
  filename: path.join(dataDirectory, 'documents.db'),
  autoload: true
});

database.ensureIndex({ fieldName: 'ownerId' }, (error) => {
  if (error) {
    throw error;
  }
});

module.exports = database;