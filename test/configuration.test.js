const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, test } = require('node:test');
const { prepareDatabaseFile } = require('../src/config/databasePaths');
const { createCorsOptions } = require('../src/config/cors');

const temporaryWorkingDirectory = fs.mkdtempSync(
  path.join(os.tmpdir(), 'document-checklist-config-test-')
);
const temporaryDirectoryParent = path.resolve(os.tmpdir());
const serverPath = path.resolve(__dirname, '..', 'src', 'server.js');
const rateLimitEnvironmentVariables = [
  'LOGIN_RATE_LIMIT_MAX',
  'LOGIN_RATE_LIMIT_WINDOW_MS',
  'REGISTRATION_RATE_LIMIT_MAX',
  'REGISTRATION_RATE_LIMIT_WINDOW_MS'
];

after(() => {
  const cleanupTarget = path.resolve(temporaryWorkingDirectory);
  if (path.dirname(cleanupTarget) !== temporaryDirectoryParent
      || !path.basename(cleanupTarget).startsWith('document-checklist-config-test-')) {
    throw new Error('Refusing to remove a path outside this test\'s temporary directory.');
  }
  fs.rmSync(cleanupTarget, { recursive: true, force: true });
});

function isolatedEnvironment() {
  const environment = {
    ...process.env,
    NODE_ENV: 'test',
    JWT_SECRET: 'configuration-test-only-jwt-secret-123456',
    DOCUMENT_CHECKLIST_USERS_DB_PATH: path.join(temporaryWorkingDirectory, 'users.db'),
    DOCUMENT_CHECKLIST_DOCUMENTS_DB_PATH: path.join(temporaryWorkingDirectory, 'documents.db'),
    DOCUMENT_CHECKLIST_APPLICATIONS_DB_PATH: path.join(temporaryWorkingDirectory, 'applications.db'),
    DOCUMENT_CHECKLIST_NOTIFICATIONS_DB_PATH: path.join(temporaryWorkingDirectory, 'notifications.db')
  };

  delete environment.TRUSTED_PROXY_IPS;
  delete environment.CORS_ALLOWED_ORIGINS;
  delete environment.JWT_EXPIRES_IN;
  for (const variable of rateLimitEnvironmentVariables) {
    delete environment[variable];
  }

  return environment;
}

function startWithEnvironment(environment) {
  return spawnSync(process.execPath, ['-e', `require(${JSON.stringify(serverPath)})`], {
    cwd: temporaryWorkingDirectory,
    env: environment,
    encoding: 'utf8'
  });
}

function startWithJwtSecret(secret) {
  const environment = isolatedEnvironment();
  if (secret === undefined) {
    delete environment.JWT_SECRET;
  } else {
    environment.JWT_SECRET = secret;
  }

  return startWithEnvironment(environment);
}

function startWithJwtExpiresIn(expiresIn) {
  const environment = isolatedEnvironment();

  if (expiresIn === undefined) {
    delete environment.JWT_EXPIRES_IN;
  } else {
    environment.JWT_EXPIRES_IN = expiresIn;
  }

  return startWithEnvironment(environment);
}

function productionEnvironment() {
  const environment = isolatedEnvironment();
  environment.NODE_ENV = 'production';
  environment.TRUSTED_PROXY_IPS = '127.0.0.1';
  environment.CORS_ALLOWED_ORIGINS = 'https://frontend.example.test';
  return environment;
}

function startWithCorsOrigins(value) {
  const environment = productionEnvironment();
  if (value === undefined) {
    delete environment.CORS_ALLOWED_ORIGINS;
  } else {
    environment.CORS_ALLOWED_ORIGINS = value;
  }

  return startWithEnvironment(environment);
}

function startWithDatabasePaths(
  usersDatabasePath,
  documentsDatabasePath,
  applicationsDatabasePath = path.join(temporaryWorkingDirectory, 'applications.db'),
  notificationsDatabasePath = path.join(temporaryWorkingDirectory, 'notifications.db')
) {
  const environment = isolatedEnvironment();
  environment.DOCUMENT_CHECKLIST_USERS_DB_PATH = usersDatabasePath;
  environment.DOCUMENT_CHECKLIST_DOCUMENTS_DB_PATH = documentsDatabasePath;
  environment.DOCUMENT_CHECKLIST_APPLICATIONS_DB_PATH = applicationsDatabasePath;
  environment.DOCUMENT_CHECKLIST_NOTIFICATIONS_DB_PATH = notificationsDatabasePath;

  return startWithEnvironment(environment);
}

test('defaults to the local frontend origin outside production', () => {
  const options = createCorsOptions({ NODE_ENV: 'development' });
  options.origin('http://localhost:5173', (_error, allowedOrigin) => {
    assert.equal(allowedOrigin, 'http://localhost:5173');
  });
  options.origin('http://localhost:5174', (_error, allowedOrigin) => {
    assert.equal(allowedOrigin, false);
  });
});

test('trims and matches configured origins exactly', () => {
  const options = createCorsOptions({
    NODE_ENV: 'development',
    CORS_ALLOWED_ORIGINS: ' https://frontend.example.test, http://localhost:5173 '
  });
  for (const origin of ['https://frontend.example.test', 'http://localhost:5173']) {
    options.origin(origin, (_error, allowedOrigin) => assert.equal(allowedOrigin, origin));
  }
  options.origin('https://sub.frontend.example.test', (_error, allowedOrigin) => {
    assert.equal(allowedOrigin, false);
  });
});

test('requires CORS_ALLOWED_ORIGINS in production', () => {
  const result = startWithCorsOrigins(undefined);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /CORS_ALLOWED_ORIGINS must be configured in production\./);
});

test('rejects malformed and non-exact CORS origins at startup', () => {
  for (const origin of [
    'not-an-origin',
    'https://frontend.example.test/path',
    'https://user:pass@frontend.example.test',
    'https://frontend.example.test?query=1',
    'https://frontend.example.test#fragment',
    'https://frontend.example.test,'
  ]) {
    const result = startWithCorsOrigins(origin);
    assert.notEqual(result.status, 0, `${origin} should fail startup`);
    assert.match(result.stderr, /CORS_ALLOWED_ORIGINS must contain/);
  }
});

test('rejects wildcard and non-HTTPS production CORS origins at startup', () => {
  for (const origin of ['https://*.example.test', 'http://frontend.example.test']) {
    const result = startWithCorsOrigins(origin);
    assert.notEqual(result.status, 0, `${origin} should fail startup`);
    assert.match(
      result.stderr,
      origin.includes('*')
        ? /CORS_ALLOWED_ORIGINS must contain exact origins/
        : /CORS_ALLOWED_ORIGINS must use HTTPS in production/
    );
  }
});

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

test('rejects the published JWT secret placeholder and accepts a valid 32-character secret', () => {
  const placeholder = startWithJwtSecret('replace-this-with-a-random-secret-at-least-32-characters');
  assert.notEqual(placeholder.status, 0);
  assert.match(placeholder.stderr, /JWT_SECRET must not use the published example placeholder\./);

  const validSecret = startWithJwtSecret('0123456789abcdef0123456789abcdef');
  assert.equal(validSecret.status, 0, validSecret.stderr);
});

test('fails startup when JWT_EXPIRES_IN is invalid', () => {
  const result = startWithJwtExpiresIn('not-a-duration');

  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr,
    /JWT_EXPIRES_IN must be a valid expiration value that produces a positive lifetime\./
  );
});

test('accepts the default and a valid configured JWT_EXPIRES_IN', () => {
  for (const [description, expiresIn] of [
    ['default when unset', undefined],
    ['configured 1d', '1d'],
    ['configured seconds', '3600s']
  ]) {
    const result = startWithJwtExpiresIn(expiresIn);
    assert.equal(result.status, 0, `${description} should allow startup: ${result.stderr}`);
  }
});

test('rejects zero and immediately-expired JWT_EXPIRES_IN values', () => {
  for (const expiresIn of ['0', '0s', '1ms']) {
    const result = startWithJwtExpiresIn(expiresIn);
    assert.notEqual(result.status, 0, `${expiresIn} should fail startup`);
    assert.match(
      result.stderr,
      /JWT_EXPIRES_IN must be a valid expiration value that produces a positive lifetime\./
    );
  }
});

test('uses rate-limit defaults when unset and accepts positive safe integer overrides', () => {
  const defaults = startWithEnvironment(isolatedEnvironment());
  assert.equal(defaults.status, 0, defaults.stderr);

  const environment = isolatedEnvironment();
  Object.assign(environment, {
    LOGIN_RATE_LIMIT_MAX: '8',
    LOGIN_RATE_LIMIT_WINDOW_MS: '60000',
    REGISTRATION_RATE_LIMIT_MAX: '3',
    REGISTRATION_RATE_LIMIT_WINDOW_MS: '120000'
  });
  const configured = startWithEnvironment(environment);
  assert.equal(configured.status, 0, configured.stderr);
});

test('fails startup for invalid login and registration rate-limit values', () => {
  for (const variable of rateLimitEnvironmentVariables) {
    for (const value of ['0', '-1', '1.5', 'not-a-number', 'Infinity', '9007199254740992']) {
      const environment = isolatedEnvironment();
      environment[variable] = value;
      const result = startWithEnvironment(environment);

      assert.notEqual(result.status, 0, `${variable}=${value} should fail startup`);
      assert.match(result.stderr, new RegExp(`${variable} must be a safe positive integer\\.`));
    }
  }
});

test('requires explicit trusted proxy addresses in production', () => {
  const missingProxy = productionEnvironment();
  delete missingProxy.TRUSTED_PROXY_IPS;
  const missingResult = startWithEnvironment(missingProxy);
  assert.notEqual(missingResult.status, 0);
  assert.match(missingResult.stderr, /TRUSTED_PROXY_IPS must identify the HTTPS-terminating proxy/);

  const broadProxy = productionEnvironment();
  broadProxy.TRUSTED_PROXY_IPS = '0.0.0.0/0';
  const broadResult = startWithEnvironment(broadProxy);
  assert.notEqual(broadResult.status, 0);
  assert.match(broadResult.stderr, /TRUSTED_PROXY_IPS must contain only valid IP addresses or CIDRs\./);

  const trustedProxy = productionEnvironment();
  trustedProxy.TRUSTED_PROXY_IPS = '127.0.0.1,::1/128';
  const trustedResult = startWithEnvironment(trustedProxy);
  assert.equal(trustedResult.status, 0, trustedResult.stderr);
});

test('creates private database files and new directories', () => {
  const databaseFile = path.join(temporaryWorkingDirectory, 'private-data', 'users.db');
  prepareDatabaseFile(databaseFile);

  assert.equal(fs.existsSync(databaseFile), true);
  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(path.dirname(databaseFile)).mode & 0o777, 0o700);
    assert.equal(fs.statSync(databaseFile).mode & 0o777, 0o600);
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

test('rejects application database paths that collide with another database', () => {
  const usersDatabasePath = path.join(temporaryWorkingDirectory, 'users.db');
  const documentsDatabasePath = path.join(temporaryWorkingDirectory, 'documents.db');
  const applicationsDatabasePath = `${path.join(temporaryWorkingDirectory, 'nested')}`
    + `${path.sep}..${path.sep}users.db`;
  const result = startWithDatabasePaths(usersDatabasePath, documentsDatabasePath, applicationsDatabasePath);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /The users and applications database paths must be different\./);
});

test('rejects a notification database path that aliases another database path', () => {
  const usersDatabasePath = path.join(temporaryWorkingDirectory, 'users.db');
  const notificationsDatabasePath = `${path.join(temporaryWorkingDirectory, 'nested')}`
    + `${path.sep}..${path.sep}users.db`;
  const result = startWithDatabasePaths(
    usersDatabasePath,
    path.join(temporaryWorkingDirectory, 'documents.db'),
    path.join(temporaryWorkingDirectory, 'applications.db'),
    notificationsDatabasePath
  );

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /The users and notifications database paths must be different\./);
});

test('creates the notification database at its configured path', () => {
  const notificationsDatabasePath = path.join(temporaryWorkingDirectory, 'custom-notifications.db');
  const result = startWithDatabasePaths(
    path.join(temporaryWorkingDirectory, 'users.db'),
    path.join(temporaryWorkingDirectory, 'documents.db'),
    path.join(temporaryWorkingDirectory, 'applications.db'),
    notificationsDatabasePath
  );

  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(notificationsDatabasePath), true);
});
