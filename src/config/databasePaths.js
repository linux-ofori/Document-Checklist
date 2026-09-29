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

module.exports = { usersDatabasePath, documentsDatabasePath };
