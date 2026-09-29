const fs = require('node:fs');
const path = require('node:path');
const Datastore = require('@seald-io/nedb');

const dataDirectory = path.join(__dirname, '..', '..', 'data');
const databaseFile = process.env.DOCUMENT_CHECKLIST_DOCUMENTS_DB_PATH || path.join(dataDirectory, 'documents.db');
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