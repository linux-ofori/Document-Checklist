const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, test } = require('node:test');

const temporaryWorkingDirectory = fs.mkdtempSync(
  path.join(os.tmpdir(), 'document-checklist-config-test-')
);
const temporaryDirectoryParent = path.resolve(os.tmpdir());
const serverPath = path.resolve(__dirname, '..', 'src', 'server.js');

after(() => {
  const cleanupTarget = path.resolve(temporaryWorkingDirectory);
  if (path.dirname(cleanupTarget) !== temporaryDirectoryParent
      || !path.basename(cleanupTarget).startsWith('document-checklist-config-test-')) {
    throw new Error('Refusing to remove a path outside this test\'s temporary directory.');
  }
  fs.rmSync(cleanupTarget, { recursive: true, force: true });
});

function startWithJwtSecret(secret) {
  const environment = { ...process.env };
  if (secret === undefined) {
    delete environment.JWT_SECRET;
  } else {
    environment.JWT_SECRET = secret;
  }

  return spawnSync(process.execPath, ['-e', `require(${JSON.stringify(serverPath)})`], {
    cwd: temporaryWorkingDirectory,
    env: environment,
    encoding: 'utf8'
  });
}

function startWithJwtExpiresIn(expiresIn) {
  const environment = {
    ...process.env,
    JWT_SECRET: 'configuration-test-only-jwt-secret-123456',
    DOCUMENT_CHECKLIST_USERS_DB_PATH: path.join(temporaryWorkingDirectory, 'jwt-expires-users.db'),
    DOCUMENT_CHECKLIST_DOCUMENTS_DB_PATH: path.join(temporaryWorkingDirectory, 'jwt-expires-documents.db')
  };

  if (expiresIn === undefined) {
    delete environment.JWT_EXPIRES_IN;
  } else {
    environment.JWT_EXPIRES_IN = expiresIn;
  }

  return spawnSync(process.execPath, ['-e', `require(${JSON.stringify(serverPath)})`], {
    cwd: temporaryWorkingDirectory,
    env: environment,
    encoding: 'utf8'
  });
}

function startWithDatabasePaths(usersDatabasePath, documentsDatabasePath) {
  const environment = {
    ...process.env,
    JWT_SECRET: 'configuration-test-only-jwt-secret-123456',
    DOCUMENT_CHECKLIST_USERS_DB_PATH: usersDatabasePath,
    DOCUMENT_CHECKLIST_DOCUMENTS_DB_PATH: documentsDatabasePath
  };

  return spawnSync(process.execPath, ['-e', `require(${JSON.stringify(serverPath)})`], {
    cwd: temporaryWorkingDirectory,
    env: environment,
    encoding: 'utf8'
  });
}

test('fails startup when the JWT secret is missing, empty, whitespace-only, or too short', () => {
  for (const [description, secret] of [
    ['missing', undefined],
    ['empty', ''],
    ['whitespace-only', ' '.repeat(32)],
    ['too short', 'short']
  ]) {
    const result = startWithJwtSecret(secret);
    assert.notEqual(result.status, 0, `${description} JWT_SECRET should fail startup`);
    assert.match(
      result.stderr,
      /JWT_SECRET must be configured with at least 32 non-whitespace characters\./
    );
  }
});

test('fails startup when JWT_EXPIRES_IN is invalid', () => {
  const result = startWithJwtExpiresIn('not-a-duration');

  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr,
    /JWT_EXPIRES_IN must be a valid expiration value supported by jsonwebtoken\./
  );
});

test('accepts the default and a valid configured JWT_EXPIRES_IN', () => {
  for (const [description, expiresIn] of [
    ['default when unset', undefined],
    ['configured 1d', '1d']
  ]) {
    const result = startWithJwtExpiresIn(expiresIn);
    assert.equal(result.status, 0, `${description} should allow startup: ${result.stderr}`);
  }
});

test('rejects users and documents database paths that resolve to the same file', () => {
  const usersDatabasePath = path.join(temporaryWorkingDirectory, 'path-check', 'users.db');
  const documentsDatabasePath = `${path.join(temporaryWorkingDirectory, 'path-check', 'nested')}`
    + `${path.sep}..${path.sep}users.db`;
  const result = startWithDatabasePaths(usersDatabasePath, documentsDatabasePath);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /The users and documents database paths must be different\./);
  assert.doesNotMatch(result.stderr, /path-check/);
  assert.equal(fs.existsSync(path.join(temporaryWorkingDirectory, 'path-check')), false);
});
