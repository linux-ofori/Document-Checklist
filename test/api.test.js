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

const publicDocumentFields = [
  'id',
  'name',
  'completed',
  'documentType',
  'status',
  'applicationId',
  'expiresAt',
  'note',
  'fileName',
  'fileSizeKb',
  'uploadedAt',
  'createdAt',
  'updatedAt'
].sort();

function assertPublicDocument(document) {
  assert.deepEqual(Object.keys(document).sort(), publicDocumentFields);
  assert.equal(Object.hasOwn(document, 'ownerId'), false);
  assert.equal(Object.hasOwn(document, '_id'), false);
}

function insertLegacyDocument(document) {
  return new Promise((resolve, reject) => {
    documentsDatabase.insert(document, (error, inserted) => error ? reject(error) : resolve(inserted));
  });
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
    assert.equal(created.payload.document.documentType, null);
    assert.equal(created.payload.document.status, 'in-review');
    assert.equal(created.payload.document.applicationId, null);
    assert.equal(created.payload.document.expiresAt, null);
    assert.equal(created.payload.document.note, null);
    assert.equal(created.payload.document.fileName, null);
    assert.equal(created.payload.document.fileSizeKb, null);
    assert.equal(created.payload.document.uploadedAt, null);
    assertPublicDocument(created.payload.document);
    const documentId = created.payload.document.id;

    const listed = await request('/api/documents', { token: primaryToken });
    assert.equal(listed.status, 200);
    assert.deepEqual(listed.payload.documents.map((document) => document.id), [documentId]);

    const retrieved = await request(`/api/documents/${documentId}`, { token: primaryToken });
    assert.equal(retrieved.status, 200);
    assert.equal(retrieved.payload.document.id, documentId);
    assertPublicDocument(retrieved.payload.document);
    assertPublicDocument(listed.payload.documents[0]);

    const updated = await request(`/api/documents/${documentId}`, {
      method: 'PUT', token: primaryToken, body: { name: 'Updated Passport', completed: true }
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.payload.document.name, 'Updated Passport');
    assert.equal(updated.payload.document.completed, true);
    assert.equal(updated.payload.document.status, 'in-review');

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
    const primaryList = await request('/api/documents', { token: primaryToken });
    assert.equal(primaryList.payload.documents.some((document) => document.id === documentId), false);
  });

  await t.test('lists owned documents newest first', async () => {
    const older = await insertLegacyDocument({
      ownerId: registration.payload.user.id,
      name: 'Older list record',
      completed: false,
      createdAt: '2020-01-01T00:00:00.000Z',
      updatedAt: '2020-01-01T00:00:00.000Z'
    });
    const newer = await insertLegacyDocument({
      ownerId: registration.payload.user.id,
      name: 'Newer list record',
      completed: false,
      createdAt: '2021-01-01T00:00:00.000Z',
      updatedAt: '2021-01-01T00:00:00.000Z'
    });
    const listed = await request('/api/documents', { token: primaryToken });
    const matchingDocuments = listed.payload.documents.filter(
      (document) => [older._id, newer._id].includes(document.id)
    );

    assert.deepEqual(matchingDocuments.map((document) => document.id), [newer._id, older._id]);
    for (const document of matchingDocuments) {
      assertPublicDocument(document);
    }
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

  await t.test('rejects invalid document fields on both create and update', async () => {
    const created = await request('/api/documents', {
      method: 'POST',
      token: primaryToken,
      body: { name: 'Invalid update target' }
    });
    assert.equal(created.status, 201);

    const invalidUpdates = [
      { name: '   ' },
      { name: 'x'.repeat(151) },
      { completed: 'true' },
      { documentType: 'passport' },
      { status: 'pending' },
      { applicationId: '../foreign-application' },
      { expiresAt: 'not-a-date' },
      { note: 42 },
      { note: 'x'.repeat(2001) },
      { unexpected: true }
    ];
    for (const body of invalidUpdates) {
      const response = await request(`/api/documents/${created.payload.document.id}`, {
        method: 'PUT',
        token: primaryToken,
        body
      });
      assert.equal(response.status, 400, `${Object.keys(body)[0]} should be rejected`);
      assert.equal(response.payload.error, 'Validation failed.');
    }
  });

  await t.test('persists and returns document metadata with independent defaults', async () => {
    const created = await request('/api/documents', {
      method: 'POST',
      token: primaryToken,
      body: {
        name: 'Metadata Passport',
        completed: true,
        documentType: 'identity-card',
        applicationId: 'app-passport-2026',
        expiresAt: '2027-04-05',
        note: 'Stored as plain text: <em>memo</em>'
      }
    });

    assert.equal(created.status, 201);
    const document = created.payload.document;
    assert.equal(document.completed, true);
    assert.equal(document.documentType, 'identity-card');
    assert.equal(document.status, 'in-review');
    assert.equal(document.applicationId, 'app-passport-2026');
    assert.equal(document.expiresAt, '2027-04-05T00:00:00.000Z');
    assert.equal(document.note, 'Stored as plain text: <em>memo</em>');
    assert.equal(document.fileName, null);
    assert.equal(document.fileSizeKb, null);
    assert.equal(document.uploadedAt, null);
    assert.equal(Object.hasOwn(document, '_id'), false);
    assert.equal(Object.hasOwn(document, 'ownerId'), false);

    const listed = await request('/api/documents', { token: primaryToken });
    const listedDocument = listed.payload.documents.find((entry) => entry.id === document.id);
    assert.deepEqual(listedDocument, document);
    assertPublicDocument(listedDocument);

    const retrieved = await request(`/api/documents/${document.id}`, { token: primaryToken });
    assert.deepEqual(retrieved.payload.document, document);
    assertPublicDocument(retrieved.payload.document);

    await new Promise((resolve) => setTimeout(resolve, 5));
    const updates = [
      { name: 'Updated Metadata Passport' },
      { completed: false },
      { documentType: 'other' },
      { status: 'verified' },
      { applicationId: 'app-business-2026' },
      { expiresAt: '2028-06-07T13:14:15+02:00' },
      { note: 'Updated note' },
      { name: 'Combined metadata update', note: 'Changed with name' }
    ];
    let updatedAt = document.updatedAt;
    let previousStatus = document.status;
    let previousCompleted = document.completed;
    for (const body of updates) {
      const updated = await request(`/api/documents/${document.id}`, {
        method: 'PUT',
        token: primaryToken,
        body
      });
      assert.equal(updated.status, 200);
      assert.notEqual(updated.payload.document.updatedAt, updatedAt);
      if (Object.hasOwn(body, 'status')) {
        assert.equal(updated.payload.document.completed, previousCompleted);
      } else {
        assert.equal(updated.payload.document.status, previousStatus);
      }
      assertPublicDocument(updated.payload.document);
      updatedAt = updated.payload.document.updatedAt;
      previousStatus = updated.payload.document.status;
      previousCompleted = updated.payload.document.completed;
    }

    const updatedDocument = (await request(`/api/documents/${document.id}`, {
      token: primaryToken
    })).payload.document;
    assert.equal(updatedDocument.name, 'Combined metadata update');
    assert.equal(updatedDocument.completed, false);
    assert.equal(updatedDocument.documentType, 'other');
    assert.equal(updatedDocument.status, 'verified');
    assert.equal(updatedDocument.applicationId, 'app-business-2026');
    assert.equal(updatedDocument.expiresAt, '2028-06-07T11:14:15.000Z');
    assert.equal(updatedDocument.note, 'Changed with name');

    const statusOnly = await request(`/api/documents/${document.id}`, {
      method: 'PUT',
      token: primaryToken,
      body: { status: 'draft' }
    });
    assert.equal(statusOnly.payload.document.status, 'draft');
    assert.equal(statusOnly.payload.document.completed, false);
    const completedOnly = await request(`/api/documents/${document.id}`, {
      method: 'PUT',
      token: primaryToken,
      body: { completed: true }
    });
    assert.equal(completedOnly.payload.document.status, 'draft');
    assert.equal(completedOnly.payload.document.completed, true);

    const cleared = await request(`/api/documents/${document.id}`, {
      method: 'PUT',
      token: primaryToken,
      body: { documentType: null, applicationId: null, expiresAt: null, note: null }
    });
    assert.equal(cleared.status, 200);
    assert.equal(cleared.payload.document.documentType, null);
    assert.equal(cleared.payload.document.applicationId, null);
    assert.equal(cleared.payload.document.expiresAt, null);
    assert.equal(cleared.payload.document.note, null);
    assert.equal(cleared.payload.document.status, 'draft');
    assert.equal(cleared.payload.document.completed, true);
  });

  await t.test('accepts explicit null metadata at creation', async () => {
    const created = await request('/api/documents', {
      method: 'POST',
      token: primaryToken,
      body: {
        name: 'Null metadata document',
        documentType: null,
        applicationId: null,
        expiresAt: null,
        note: null
      }
    });

    assert.equal(created.status, 201);
    assert.equal(created.payload.document.documentType, null);
    assert.equal(created.payload.document.status, 'in-review');
    assert.equal(created.payload.document.applicationId, null);
    assert.equal(created.payload.document.expiresAt, null);
    assert.equal(created.payload.document.note, null);
    assertPublicDocument(created.payload.document);
  });

  await t.test('rejects unsupported metadata values and protected client fields', async () => {
    const invalidBodies = [
      [{ name: 'Invalid type', documentType: 'passport' }, 'documentType'],
      [{ name: 'Invalid status', status: 'pending' }, 'status'],
      [{ name: 'Invalid application', applicationId: '../other-user' }, 'applicationId'],
      [{ name: 'Invalid expiry', expiresAt: '2027-02-30' }, 'expiresAt'],
      [{ name: 'Invalid note', note: 42 }, 'note'],
      [{ name: 'Oversized note', note: 'x'.repeat(2001) }, 'note']
    ];

    for (const [body, field] of invalidBodies) {
      const response = await request('/api/documents', {
        method: 'POST',
        token: primaryToken,
        body
      });
      assert.equal(response.status, 400, `${field} should be rejected`);
      assert.equal(response.payload.error, 'Validation failed.');
    }

    for (const field of [
      'unexpected',
      '_id',
      'id',
      'ownerId',
      'createdAt',
      'updatedAt',
      'fileName',
      'fileSizeKb',
      'fileSizeBytes',
      'uploadedAt',
      'storage',
      'storagePath',
      'storageKey',
      'path'
    ]) {
      const response = await request('/api/documents', {
        method: 'POST',
        token: primaryToken,
        body: { name: 'Protected field test', [field]: 'client-controlled' }
      });
      assert.equal(response.status, 400, `${field} should not be client controlled`);
    }

    const existing = await request('/api/documents', {
      method: 'POST',
      token: primaryToken,
      body: { name: 'Protected update target' }
    });
    for (const field of [
      'id',
      '_id',
      'ownerId',
      'createdAt',
      'updatedAt',
      'fileName',
      'fileSizeKb',
      'fileSizeBytes',
      'uploadedAt',
      'storage',
      'storagePath',
      'storageKey',
      'path'
    ]) {
      const response = await request(`/api/documents/${existing.payload.document.id}`, {
        method: 'PUT',
        token: primaryToken,
        body: { [field]: 'client-controlled' }
      });
      assert.equal(response.status, 400, `${field} should not be updatable`);
    }
  });

  await t.test('returns legacy documents without requiring a database migration', async () => {
    const createdAt = '2024-01-02T03:04:05.000Z';
    const updatedAt = '2024-02-03T04:05:06.000Z';
    const legacyDocument = await insertLegacyDocument({
      ownerId: registration.payload.user.id,
      name: 'Legacy Passport',
      completed: true,
      createdAt,
      updatedAt
    });

    const retrieved = await request(`/api/documents/${legacyDocument._id}`, { token: primaryToken });
    assert.equal(retrieved.status, 200);
    assert.deepEqual(retrieved.payload.document, {
      id: legacyDocument._id,
      name: 'Legacy Passport',
      completed: true,
      documentType: null,
      status: 'in-review',
      applicationId: null,
      fileName: null,
      fileSizeKb: null,
      uploadedAt: null,
      expiresAt: null,
      note: null,
      createdAt,
      updatedAt
    });
    assertPublicDocument(retrieved.payload.document);
  });

  await t.test('returns consistent delete errors and requires authentication for every operation', async () => {
    for (const [route, options] of [
      ['/api/documents', { method: 'POST', body: { name: 'No token' } }],
      ['/api/documents', { method: 'GET' }],
      ['/api/documents/0123456789abcdef', { method: 'GET' }],
      ['/api/documents/0123456789abcdef', { method: 'PUT', body: { completed: true } }],
      ['/api/documents/0123456789abcdef', { method: 'DELETE' }]
    ]) {
      const response = await request(route, options);
      assert.equal(response.status, 401);
    }

    const missing = await request('/api/documents/0123456789abcdef', {
      method: 'DELETE',
      token: primaryToken
    });
    assert.equal(missing.status, 404);
    assert.deepEqual(missing.payload, { error: 'Document not found.' });

    const invalidId = await request('/api/documents/not-an-id', {
      method: 'DELETE',
      token: primaryToken
    });
    assert.equal(invalidId.status, 400);
    assert.deepEqual(invalidId.payload, { error: 'Invalid document ID.' });

    const otherAccount = await request('/api/auth/register', {
      method: 'POST',
      body: { name: 'Delete Isolation', email: 'delete-isolation@example.com', password: 'delete-isolation-pass' }
    });
    const otherDocument = await request('/api/documents', {
      method: 'POST',
      token: otherAccount.payload.token,
      body: { name: 'Not owned by primary' }
    });
    const forbiddenDelete = await request(`/api/documents/${otherDocument.payload.document.id}`, {
      method: 'DELETE',
      token: primaryToken
    });
    assert.equal(forbiddenDelete.status, 404);
    assert.deepEqual(forbiddenDelete.payload, { error: 'Document not found.' });
    assert.equal((await request(`/api/documents/${otherDocument.payload.document.id}`, {
      token: otherAccount.payload.token
    })).status, 200);
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
