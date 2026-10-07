const fs = require('node:fs');
const path = require('node:path');

const dataDirectory = path.join(__dirname, '..', '..', 'data');

function resolveDatabasePath(environmentVariable, defaultFileName) {
  return path.resolve(
    process.env[environmentVariable] || path.join(dataDirectory, defaultFileName)
  );
}

const usersDatabasePath = resolveDatabasePath(
  'DOCUMENT_CHECKLIST_USERS_DB_PATH',
  'users.db'
);
const documentsDatabasePath = resolveDatabasePath(
  'DOCUMENT_CHECKLIST_DOCUMENTS_DB_PATH',
  'documents.db'
);

const comparableUsersPath = process.platform === 'win32'
  ? usersDatabasePath.toLowerCase()
  : usersDatabasePath;
const comparableDocumentsPath = process.platform === 'win32'
  ? documentsDatabasePath.toLowerCase()
  : documentsDatabasePath;

if (comparableUsersPath === comparableDocumentsPath) {
  throw new Error('The users and documents database paths must be different.');
}

function prepareDatabaseFile(databaseFile) {
  const directory = path.dirname(databaseFile);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });

  const fileDescriptor = process.platform === 'win32'
    ? fs.openSync(databaseFile, 'a')
    : fs.openSync(databaseFile, 'a', 0o600);
  fs.closeSync(fileDescriptor);

  if (process.platform !== 'win32') {
    fs.chmodSync(databaseFile, 0o600);
  }
}

module.exports = { usersDatabasePath, documentsDatabasePath, prepareDatabaseFile };
