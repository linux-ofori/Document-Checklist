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
const applicationsDatabasePath = resolveDatabasePath(
  'DOCUMENT_CHECKLIST_APPLICATIONS_DB_PATH',
  'applications.db'
);

const databasePaths = [
  ['users', usersDatabasePath],
  ['documents', documentsDatabasePath],
  ['applications', applicationsDatabasePath]
];

for (let index = 0; index < databasePaths.length; index += 1) {
  const [name, databasePath] = databasePaths[index];
  const comparablePath = process.platform === 'win32' ? databasePath.toLowerCase() : databasePath;

  for (const [otherName, otherPath] of databasePaths.slice(index + 1)) {
    const comparableOtherPath = process.platform === 'win32' ? otherPath.toLowerCase() : otherPath;
    if (comparablePath === comparableOtherPath) {
      throw new Error(`The ${name} and ${otherName} database paths must be different.`);
    }
  }
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

module.exports = {
  usersDatabasePath,
  documentsDatabasePath,
  applicationsDatabasePath,
  prepareDatabaseFile
};
