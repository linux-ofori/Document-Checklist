const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { after, before, test } = require('node:test');

const dataDirectory = path.resolve(__dirname, '..', 'data');
const testDataDirectory = fs.mkdtempSync(path.join(dataDirectory, '.test-'));
const testJwtSecret = 'document-checklist-automated-test-secret';
const passwordAtBcryptLimit = 'a'.repeat(72);

process.env.JWT_SECRET = testJwtSecret;
process.env.NODE_ENV = 'test';
delete process.env.TRUSTED_PROXY_IPS;
process.env.DOCUMENT_CHECKLIST_USERS_DB_PATH = path.join(testDataDirectory, 'users.db');
process.env.DOCUMENT_CHECKLIST_DOCUMENTS_DB_PATH = path.join(testDataDirectory, 'documents.db');
process.env.REGISTRATION_RATE_LIMIT_MAX = '20';

const app = require('../src/server');
const database = require('../src/config/database');
const documentsDatabase = require('../src/config/documentsDatabase');
const authRoutes = require('../src/routes/authRoutes');
const { findDocumentsByOwnerId } = require('../src/models/documentModel');
const { findUserById, markUserDeletingById, toPublicUser } = require('../src/models/userModel');
let server;
let baseUrl;

before(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }

  const cleanupTarget = path.resolve(testDataDirectory);
  if (path.dirname(cleanupTarget) !== dataDirectory || !path.basename(cleanupTarget).startsWith('.test-')) {
    throw new Error('Refusing to remove a path outside this run\'s temporary test directory.');
  }
  fs.rmSync(cleanupTarget, { recursive: true, force: true });
});

async function request(route, { method = 'GET', token, body } = {}) {
  const headers = {};
  if (body !== undefined) {
    headers['content-type'] = 'application/json';
  }
  if (token) {
    headers.authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${baseUrl}${route}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const payload = await response.json();
  return { status: response.status, payload };
}

test('returns JSON 404 responses for unknown API paths and unsupported methods', async () => {
  for (const [route, method] of [
    ['/api/auth/does-not-exist', 'GET'],
    ['/api/auth/login', 'PATCH']
  ]) {
    const response = await fetch(`${baseUrl}${route}`, { method });

    assert.equal(response.status, 404);
    assert.match(response.headers.get('content-type') || '', /^application\/json\b/);
    assert.deepEqual(await response.json(), { error: 'Route not found.' });
  }
});

function assertSanitizedUser(user) {
  assert.equal(Object.hasOwn(user, 'password'), false);
  assert.equal(Object.hasOwn(user, 'passwordHash'), false);
}

test('public user serialization allows only intended user fields', () => {
  const publicUser = toPublicUser({
    _id: 'user-id',
    name: 'Public User',
    email: 'public@example.com',
    createdAt: '2026-10-06T00:00:00.000Z',
    updatedAt: '2026-10-06T00:00:00.000Z',
    deleting: true,
    password: 'stored-password',
    passwordHash: 'stored-hash',
    internalSecret: 'must-not-be-returned'
  });

  assert.deepEqual(publicUser, {
    id: 'user-id',
    name: 'Public User',
    email: 'public@example.com',
    createdAt: '2026-10-06T00:00:00.000Z',
    updatedAt: '2026-10-06T00:00:00.000Z'
  });
  assert.equal(Object.hasOwn(publicUser, 'password'), false);
  assert.equal(Object.hasOwn(publicUser, 'passwordHash'), false);
  assert.equal(Object.hasOwn(publicUser, 'deleting'), false);
  assert.equal(Object.hasOwn(publicUser, 'internalSecret'), false);
});

test('authentication, account management, and document API', async (t) => {
  const registration = await request('/api/auth/register', {
    method: 'POST',
    body: { name: 'Primary User', email: 'primary@example.com', password: passwordAtBcryptLimit }
  });
  const primaryToken = registration.payload.token;

  await t.test('registers a user and rejects duplicate email', async () => {
    assert.equal(Buffer.byteLength(passwordAtBcryptLimit, 'utf8'), 72);
    assert.equal(registration.status, 201);
    assertSanitizedUser(registration.payload.user);

    const duplicate = await request('/api/auth/register', {
      method: 'POST',
      body: { name: 'Another User', email: 'PRIMARY@example.com', password: 'correct-horse-2' }
    });
    assert.equal(duplicate.status, 409);
  });

  await t.test('logs in with correct credentials and rejects incorrect credentials', async () => {
    const successfulLogin = await request('/api/auth/login', {
      method: 'POST',
      body: { email: 'primary@example.com', password: passwordAtBcryptLimit }
    });
    assert.equal(successfulLogin.status, 200);
    assertSanitizedUser(successfulLogin.payload.user);
    assert.equal(typeof successfulLogin.payload.token, 'string');

    const failedLogin = await request('/api/auth/login', {
      method: 'POST',
      body: { email: 'primary@example.com', password: 'incorrect-horse' }
    });
    assert.equal(failedLogin.status, 401);
  });

  await t.test('rejects passwords that bcrypt would truncate on registration and login', async () => {
    const tooLongAsciiPassword = 'a'.repeat(73);
    const tooLongUnicodePassword = 'é'.repeat(37);

    assert.equal(Buffer.byteLength(tooLongAsciiPassword, 'utf8'), 73);
    assert.equal(Buffer.byteLength(tooLongUnicodePassword, 'utf8'), 74);

    for (const [email, password] of [
      ['long-ascii@example.com', tooLongAsciiPassword],
      ['long-unicode@example.com', tooLongUnicodePassword]
    ]) {
      const registrationAttempt = await request('/api/auth/register', {
        method: 'POST',
        body: { name: 'Long Password User', email, password }
      });
      assert.equal(registrationAttempt.status, 400);
      assert.deepEqual(registrationAttempt.payload, {
        error: 'Validation failed.',
        details: ['Password must not exceed 72 UTF-8 bytes.']
      });

      const loginAttempt = await request('/api/auth/login', {
        method: 'POST',
        body: { email: 'primary@example.com', password }
      });
      assert.equal(loginAttempt.status, 400);
      assert.deepEqual(loginAttempt.payload, {
        error: 'Validation failed.',
        details: ['Password must not exceed 72 UTF-8 bytes.']
      });
    }
  });

  await t.test('rejects protected requests without a valid token', async () => {
    for (const route of ['/api/auth/me', '/api/documents']) {
      assert.equal((await request(route)).status, 401);
      assert.equal((await request(route, { token: 'not-a-valid-token' })).status, 401);
    }
  });

  await t.test('returns a generic server error when authenticated user lookup fails', async () => {
    const originalFindOne = database.findOne;
    const originalConsoleError = console.error;
    const databaseError = new Error('Sensitive database failure at C:\\private\\users.db');

    database.findOne = (_query, callback) => callback(databaseError);
    console.error = () => {};

    try {
      const response = await request('/api/auth/me', { token: primaryToken });
      assert.equal(response.status, 500);
      assert.deepEqual(response.payload, { error: 'An unexpected server error occurred.' });
      assert.doesNotMatch(JSON.stringify(response.payload), /Sensitive database failure|private\\users\.db/);
    } finally {
      database.findOne = originalFindOne;
      console.error = originalConsoleError;
    }
  });

  await t.test('supports document create, list, retrieve, update, and delete', async () => {
    const created = await request('/api/documents', {
      method: 'POST', token: primaryToken, body: { name: 'Passport' }
    });
    assert.equal(created.status, 201);
    assert.equal(created.payload.document.name, 'Passport');
    assert.equal(created.payload.document.completed, false);
    const documentId = created.payload.document.id;

    const listed = await request('/api/documents', { token: primaryToken });
    assert.equal(listed.status, 200);
    assert.deepEqual(listed.payload.documents.map((document) => document.id), [documentId]);

    const retrieved = await request(`/api/documents/${documentId}`, { token: primaryToken });
    assert.equal(retrieved.status, 200);
    assert.equal(retrieved.payload.document.id, documentId);

    const updated = await request(`/api/documents/${documentId}`, {
      method: 'PUT', token: primaryToken, body: { name: 'Updated Passport', completed: true }
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.payload.document.name, 'Updated Passport');
    assert.equal(updated.payload.document.completed, true);

    const deleted = await request(`/api/documents/${documentId}`, {
      method: 'DELETE', token: primaryToken
    });
    assert.equal(deleted.status, 200);
    assert.equal((await request(`/api/documents/${documentId}`, { token: primaryToken })).status, 404);
  });

  await t.test('prevents users from accessing another user\'s documents', async () => {
    const secondRegistration = await request('/api/auth/register', {
      method: 'POST',
      body: { name: 'Second User', email: 'second@example.com', password: 'another-horse-1' }
    });
    assert.equal(secondRegistration.status, 201);

    const secondDocument = await request('/api/documents', {
      method: 'POST', token: secondRegistration.payload.token, body: { name: 'Private Record' }
    });
    assert.equal(secondDocument.status, 201);
    const documentId = secondDocument.payload.document.id;

    assert.equal((await request(`/api/documents/${documentId}`, { token: primaryToken })).status, 404);
    assert.equal((await request(`/api/documents/${documentId}`, {
      method: 'PUT', token: primaryToken, body: { name: 'Changed by another user' }
    })).status, 404);
    assert.equal((await request(`/api/documents/${documentId}`, {
      method: 'DELETE', token: primaryToken
    })).status, 404);
    assert.equal((await request(`/api/documents/${documentId}`, {
      token: secondRegistration.payload.token
    })).status, 200);
  });

  await t.test('rejects invalid document data', async () => {
    assert.equal((await request('/api/documents', {
      method: 'POST', token: primaryToken, body: { name: '   ' }
    })).status, 400);
    assert.equal((await request('/api/documents', {
      method: 'POST', token: primaryToken, body: { name: 'Passport', completed: 'yes' }
    })).status, 400);
    assert.equal((await request('/api/documents', {
      method: 'POST', token: primaryToken, body: { name: 'Passport', ownerId: 'someone-else' }
    })).status, 400);
    assert.equal((await request('/api/documents/not-an-id', { token: primaryToken })).status, 400);
    assert.equal((await request('/api/documents/not-an-id', {
      method: 'PUT', token: primaryToken, body: {}
    })).status, 400);
  });

  await t.test('rejects oversized JSON request bodies', async () => {
    const oversizedRegistration = await request('/api/auth/register', {
      method: 'POST',
      body: {
        name: 'A'.repeat(11 * 1024),
        email: 'oversized@example.com',
        password: 'correct-horse-1'
      }
    });

    assert.equal(oversizedRegistration.status, 413);
    assert.deepEqual(oversizedRegistration.payload, { error: 'Request body is too large.' });
  });

  await t.test('maps malformed JSON and unsupported JSON encodings to client errors', async () => {
    const malformed = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{ invalid'
    });
    assert.equal(malformed.status, 400);
    assert.deepEqual(await malformed.json(), {
      error: 'Request body must contain valid JSON.'
    });

    for (const [headers, body] of [
      [{ 'content-type': 'application/json; charset=x-unknown-charset' }, '{}'],
      [{ 'content-type': 'application/json', 'content-encoding': 'x-unknown-encoding' }, '{}']
    ]) {
      const unsupported = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers,
        body
      });
      assert.equal(unsupported.status, 415);
      assert.deepEqual(await unsupported.json(), { error: 'Unsupported request encoding.' });
    }
  });

  await t.test('never returns passwords or hashes and supports profile routes', async () => {
    const profile = await request('/api/auth/me', { token: primaryToken });
    assert.equal(profile.status, 200);
    assertSanitizedUser(profile.payload.user);

    const updatedProfile = await request('/api/auth/me', {
      method: 'PUT', token: primaryToken, body: { name: 'Renamed User' }
    });
    assert.equal(updatedProfile.status, 200);
    assert.equal(updatedProfile.payload.user.name, 'Renamed User');
    assertSanitizedUser(updatedProfile.payload.user);

    assertSanitizedUser(registration.payload.user);
    const login = await request('/api/auth/login', {
      method: 'POST',
      body: { email: 'primary@example.com', password: passwordAtBcryptLimit }
    });
    assert.equal(login.status, 200);
    assertSanitizedUser(login.payload.user);
  });

  await t.test('deletes an account and invalidates its token', async () => {
    const account = await request('/api/auth/register', {
      method: 'POST',
      body: { name: 'Account To Delete', email: 'delete@example.com', password: 'delete-horse-1' }
    });
    assert.equal(account.status, 201);

    const document = await request('/api/documents', {
      method: 'POST', token: account.payload.token, body: { name: 'Document to clean up' }
    });
    assert.equal(document.status, 201);

    const deleted = await request('/api/auth/me', {
      method: 'DELETE', token: account.payload.token
    });
    assert.equal(deleted.status, 200);
    assert.equal(deleted.payload.message, 'Account deleted successfully.');
    assert.deepEqual(await findDocumentsByOwnerId(account.payload.user.id), []);
    assert.equal(await findUserById(account.payload.user.id), null);
    assert.equal((await request('/api/auth/me', { token: account.payload.token })).status, 401);
  });

  await t.test('resumes a failed deletion and rejects writes after deletion begins', async () => {
    const account = await request('/api/auth/register', {
      method: 'POST',
      body: { name: 'Retry Delete', email: 'retry-delete@example.com', password: 'retry-delete-pass' }
    });
    const accountId = account.payload.user.id;
    const document = await request('/api/documents', {
      method: 'POST', token: account.payload.token, body: { name: 'Pending cleanup' }
    });
    assert.equal(document.status, 201);

    const originalRemove = database.remove;
    const originalConsoleError = console.error;
    let failFirstUserRemoval = true;
    database.remove = function remove(query, options, callback) {
      if (query._id === accountId && failFirstUserRemoval) {
        failFirstUserRemoval = false;
        return callback(new Error('Injected document cleanup failure.'));
      }

      return originalRemove.call(this, query, options, callback);
    };
    console.error = () => {};

    try {
      const failedDeletion = await request('/api/auth/me', {
        method: 'DELETE', token: account.payload.token
      });
      assert.equal(failedDeletion.status, 500);
      assert.deepEqual(await findDocumentsByOwnerId(accountId), []);

      const deniedWrite = await request('/api/documents', {
        method: 'POST', token: account.payload.token, body: { name: 'Must not become orphaned' }
      });
      assert.equal(deniedWrite.status, 401);

      const retriedDeletion = await request('/api/auth/me', {
        method: 'DELETE', token: account.payload.token
      });
      assert.equal(retriedDeletion.status, 200);
    } finally {
      database.remove = originalRemove;
      console.error = originalConsoleError;
    }

    assert.deepEqual(await findDocumentsByOwnerId(accountId), []);
    assert.equal(await findUserById(accountId), null);
  });

  await t.test('recovers a deletion interrupted after its marker was persisted', async () => {
    const account = await request('/api/auth/register', {
      method: 'POST',
      body: { name: 'Recover Delete', email: 'recover-delete@example.com', password: 'recover-delete-pass' }
    });
    const accountId = account.payload.user.id;
    const document = await request('/api/documents', {
      method: 'POST', token: account.payload.token, body: { name: 'Recover on startup' }
    });
    assert.equal(document.status, 201);

    assert.ok(await markUserDeletingById(accountId));
    await authRoutes.recoverPendingAccountDeletions();

    assert.deepEqual(await findDocumentsByOwnerId(accountId), []);
    assert.equal(await findUserById(accountId), null);
  });

  await t.test('serializes in-flight document creation before account deletion', async () => {
    const account = await request('/api/auth/register', {
      method: 'POST',
      body: { name: 'Racing User', email: 'racing-user@example.com', password: 'racing-user-pass' }
    });
    const accountId = account.payload.user.id;
    const originalInsert = documentsDatabase.insert;
    const originalFindOne = database.findOne;
    let insertStartedResolve;
    let deletionAuthResolve;
    let releaseInsertResolve;
    const insertStarted = new Promise((resolve) => { insertStartedResolve = resolve; });
    const deletionAuthReached = new Promise((resolve) => { deletionAuthResolve = resolve; });
    const releaseInsert = new Promise((resolve) => { releaseInsertResolve = resolve; });
    let ownerLookups = 0;

    documentsDatabase.insert = function insert(document, callback) {
      return originalInsert.call(this, document, (error, inserted) => {
        insertStartedResolve();
        releaseInsert.then(() => callback(error, inserted));
      });
    };
    database.findOne = function findOne(query, callback) {
      return originalFindOne.call(this, query, (error, user) => {
        callback(error, user);
        if (query._id === accountId) {
          ownerLookups += 1;
          if (ownerLookups === 3) {
            deletionAuthResolve();
          }
        }
      });
    };

    try {
      const creating = request('/api/documents', {
        method: 'POST', token: account.payload.token, body: { name: 'Created during deletion race' }
      });
      await insertStarted;

      const deleting = request('/api/auth/me', {
        method: 'DELETE', token: account.payload.token
      });
      await deletionAuthReached;
      releaseInsertResolve();

      const [created, deleted] = await Promise.all([creating, deleting]);
      assert.equal(created.status, 201);
      assert.equal(deleted.status, 200);
    } finally {
      documentsDatabase.insert = originalInsert;
      database.findOne = originalFindOne;
      releaseInsertResolve();
    }

    assert.deepEqual(await findDocumentsByOwnerId(accountId), []);
    assert.equal(await findUserById(accountId), null);
  });
});
