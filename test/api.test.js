const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsPromises = require('node:fs/promises');
const path = require('node:path');
const { after, before, test } = require('node:test');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const dataDirectory = path.resolve(__dirname, '..', 'data');
const testDataDirectory = fs.mkdtempSync(path.join(dataDirectory, '.test-'));
const testJwtSecret = 'document-checklist-automated-test-secret';
const passwordAtBcryptLimit = 'a'.repeat(72);

process.env.JWT_SECRET = testJwtSecret;
process.env.NODE_ENV = 'test';
delete process.env.TRUSTED_PROXY_IPS;
process.env.DOCUMENT_CHECKLIST_USERS_DB_PATH = path.join(testDataDirectory, 'users.db');
process.env.DOCUMENT_CHECKLIST_DOCUMENTS_DB_PATH = path.join(testDataDirectory, 'documents.db');
process.env.DOCUMENT_CHECKLIST_APPLICATIONS_DB_PATH = path.join(testDataDirectory, 'applications.db');
process.env.DOCUMENT_CHECKLIST_UPLOADS_DIRECTORY = path.join(testDataDirectory, 'uploads');
process.env.LOGIN_RATE_LIMIT_MAX = '30';
process.env.PASSWORD_CHANGE_RATE_LIMIT_MAX = '30';
process.env.REGISTRATION_RATE_LIMIT_MAX = '50';

const app = require('../src/server');
const database = require('../src/config/database');
const documentsDatabase = require('../src/config/documentsDatabase');
const { uploadsDirectory } = require('../src/config/databasePaths');
const authRoutes = require('../src/routes/authRoutes');
const { findDocumentsByOwnerId } = require('../src/models/documentModel');
const {
  deleteUserById,
  findUserByEmail,
  findUserById,
  incrementUserTokenVersionById,
  markUserDeletingById,
  toPublicUser
} = require('../src/models/userModel');
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

async function requestMultipart(route, { method = 'POST', token, fields = {}, files = [] } = {}) {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    form.append(name, String(value));
  }
  for (const file of files) {
    form.append(file.fieldName || 'file', new Blob([file.buffer], { type: file.type }), file.name);
  }

  const headers = {};
  if (token) {
    headers.authorization = 'Bearer ' + token;
  }
  const response = await fetch(`${baseUrl}${route}`, { method, headers, body: form });
  return { status: response.status, payload: await response.json() };
}

async function requestFile(route, token) {
  const headers = {};
  if (token) {
    headers.authorization = `Bearer ${token}`;
  }
  const response = await fetch(`${baseUrl}${route}`, { headers });
  return {
    status: response.status,
    headers: response.headers,
    body: Buffer.from(await response.arrayBuffer())
  };
}

function validJpeg() {
  return Buffer.from([
    0xff, 0xd8,
    0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00,
    0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0x00,
    0xff, 0xd9
  ]);
}

function validPng() {
  const png = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png);
  png.writeUInt32BE(13, 8);
  png.write('IHDR', 12, 'ascii');
  png.writeUInt32BE(1, 16);
  png.writeUInt32BE(1, 20);
  return png;
}

function uploadPdf(token, name, fields = {}) {
  return requestMultipart('/api/documents', {
    token,
    fields: { name, ...fields },
    files: [{
      name: `${name}.pdf`,
      type: 'application/pdf',
      buffer: Buffer.from('%PDF-1.7\n')
    }]
  });
}

function findStoredDocument(id) {
  return new Promise((resolve, reject) => {
    documentsDatabase.findOne({ _id: id }, (error, document) =>
      error ? reject(error) : resolve(document));
  });
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
  assert.equal(Object.hasOwn(user, 'tokenVersion'), false);
  assert.equal(Object.hasOwn(user, 'deleting'), false);
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
    phone: null,
    preferences: {
      notifications: {
        documentExpiry: true,
        applicationUpdates: true,
        securityAccount: true
      }
    },
    createdAt: '2026-10-06T00:00:00.000Z',
    updatedAt: '2026-10-06T00:00:00.000Z'
  });
  assert.equal(Object.hasOwn(publicUser, 'password'), false);
  assert.equal(Object.hasOwn(publicUser, 'passwordHash'), false);
  assert.equal(Object.hasOwn(publicUser, 'deleting'), false);
  assert.equal(Object.hasOwn(publicUser, 'internalSecret'), false);
  assert.equal(Object.hasOwn(publicUser, 'tokenVersion'), false);
});

function insertLegacyUser(user) {
  return new Promise((resolve, reject) => {
    database.insert(user, (error, inserted) => error ? reject(error) : resolve(inserted));
  });
}

test('legacy users and version-zero tokens receive defaults and remain authenticated', async () => {
  const passwordHash = await bcrypt.hash('legacy-account-password', 12);
  const legacyUser = await insertLegacyUser({
    name: 'Legacy Account',
    email: 'legacy-account@example.com',
    password: passwordHash,
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z'
  });
  const legacyToken = jwt.sign({}, testJwtSecret, {
    subject: legacyUser._id,
    expiresIn: '1d'
  });

  const response = await request('/api/auth/me', { token: legacyToken });
  assert.equal(response.status, 200);
  assert.equal(response.payload.user.phone, null);
  assert.deepEqual(response.payload.user.preferences, {
    notifications: {
      documentExpiry: true,
      applicationUpdates: true,
      securityAccount: true
    }
  });
  assertSanitizedUser(response.payload.user);

  const updatedLegacyProfile = await request('/api/auth/me', {
    method: 'PUT',
    token: legacyToken,
    body: {
      phone: ' +1 555 0100 ',
      preferences: { notifications: { documentExpiry: false } }
    }
  });
  assert.equal(updatedLegacyProfile.status, 200);
  assert.equal(updatedLegacyProfile.payload.user.phone, '+1 555 0100');
  assert.deepEqual(updatedLegacyProfile.payload.user.preferences, {
    notifications: {
      documentExpiry: false,
      applicationUpdates: true,
      securityAccount: true
    }
  });

  for (const tokenVersion of ['0', -1, 1]) {
    const malformedToken = jwt.sign({ tokenVersion }, testJwtSecret, {
      subject: legacyUser._id,
      expiresIn: '1d'
    });
    assert.equal((await request('/api/auth/me', { token: malformedToken })).status, 401);
  }

  const changedPassword = await request('/api/auth/change-password', {
    method: 'POST',
    token: legacyToken,
    body: {
      currentPassword: 'legacy-account-password',
      newPassword: 'legacy-account-password-updated'
    }
  });
  assert.equal(changedPassword.status, 200);
  assert.equal((await request('/api/auth/me', { token: legacyToken })).status, 401);
  assert.equal((await request('/api/auth/me', { token: changedPassword.payload.token })).status, 200);

  const oldPasswordLogin = await request('/api/auth/login', {
    method: 'POST',
    body: { email: 'legacy-account@example.com', password: 'legacy-account-password' }
  });
  assert.equal(oldPasswordLogin.status, 401);
  const newPasswordLogin = await request('/api/auth/login', {
    method: 'POST',
    body: { email: 'legacy-account@example.com', password: 'legacy-account-password-updated' }
  });
  assert.equal(newPasswordLogin.status, 200);
});

test('logout invalidates all existing tokens and allows a new login', async () => {
  const account = await request('/api/auth/register', {
    method: 'POST',
    body: { name: 'Logout User', email: 'logout@example.com', password: 'logout-test-password' }
  });
  assert.equal(account.status, 201);

  const secondToken = await request('/api/auth/login', {
    method: 'POST',
    body: { email: 'logout@example.com', password: 'logout-test-password' }
  });
  assert.equal(secondToken.status, 200);

  const unauthenticated = await request('/api/auth/logout', { method: 'POST' });
  assert.equal(unauthenticated.status, 401);

  const loggedOut = await request('/api/auth/logout', {
    method: 'POST',
    token: account.payload.token
  });
  assert.equal(loggedOut.status, 200);
  assert.deepEqual(loggedOut.payload, { message: 'Logged out successfully.' });
  assert.equal(Object.hasOwn(loggedOut.payload, 'token'), false);
  assert.equal((await request('/api/auth/me', { token: account.payload.token })).status, 401);
  assert.equal((await request('/api/auth/me', { token: secondToken.payload.token })).status, 401);

  const relogin = await request('/api/auth/login', {
    method: 'POST',
    body: { email: 'logout@example.com', password: 'logout-test-password' }
  });
  assert.equal(relogin.status, 200);
  assert.equal((await request('/api/auth/me', { token: relogin.payload.token })).status, 200);
});

test('legacy user without tokenVersion can log out and revoke its version-zero token', async () => {
  const passwordHash = await bcrypt.hash('legacy-logout-password', 12);
  const legacyUser = await insertLegacyUser({
    name: 'Legacy Logout User',
    email: 'legacy-logout@example.com',
    password: passwordHash,
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z'
  });
  const legacyToken = jwt.sign({}, testJwtSecret, {
    subject: legacyUser._id,
    expiresIn: '1d'
  });

  const loggedOut = await request('/api/auth/logout', { method: 'POST', token: legacyToken });
  assert.equal(loggedOut.status, 200);
  assert.equal((await request('/api/auth/me', { token: legacyToken })).status, 401);
  assert.equal((await findUserById(legacyUser._id)).tokenVersion, 1);
});

test('logout does not succeed for missing or deleting users', async () => {
  const deletingAccount = await request('/api/auth/register', {
    method: 'POST',
    body: { name: 'Deleting Logout User', email: 'deleting-logout@example.com', password: 'logout-test-password' }
  });
  assert.equal(deletingAccount.status, 201);
  assert.ok(await markUserDeletingById(deletingAccount.payload.user.id));
  assert.equal(await incrementUserTokenVersionById(deletingAccount.payload.user.id), null);
  const deletingLogout = await request('/api/auth/logout', {
    method: 'POST',
    token: deletingAccount.payload.token
  });
  assert.equal(deletingLogout.status, 401);

  const missingAccount = await request('/api/auth/register', {
    method: 'POST',
    body: { name: 'Missing Logout User', email: 'missing-logout@example.com', password: 'logout-test-password' }
  });
  assert.equal(missingAccount.status, 201);
  assert.equal(await deleteUserById(missingAccount.payload.user.id), true);
  assert.equal(await incrementUserTokenVersionById(missingAccount.payload.user.id), null);
  const missingLogout = await request('/api/auth/logout', {
    method: 'POST',
    token: missingAccount.payload.token
  });
  assert.equal(missingLogout.status, 401);
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
    assert.equal(registration.payload.user.phone, null);
    assert.deepEqual(registration.payload.user.preferences, {
      notifications: {
        documentExpiry: true,
        applicationUpdates: true,
        securityAccount: true
      }
    });

    const duplicate = await request('/api/auth/register', {
      method: 'POST',
      body: { name: 'Another User', email: 'PRIMARY@example.com', password: 'correct-horse-2' }
    });
    assert.equal(duplicate.status, 409);
  });

  await t.test('registers and returns an optional normalized phone number', async () => {
    const registered = await request('/api/auth/register', {
      method: 'POST',
      body: {
        name: 'Phone Registration User',
        email: 'phone-registration@example.com',
        password: 'phone-registration-password',
        phone: '  +233 24 123 4567  '
      }
    });

    assert.equal(registered.status, 201);
    assert.equal(registered.payload.user.phone, '+233 24 123 4567');
    assertSanitizedUser(registered.payload.user);

    const storedUser = await findUserById(registered.payload.user.id);
    assert.equal(storedUser.phone, '+233 24 123 4567');

    const currentUser = await request('/api/auth/me', { token: registered.payload.token });
    assert.equal(currentUser.status, 200);
    assert.equal(currentUser.payload.user.phone, '+233 24 123 4567');
    assertSanitizedUser(currentUser.payload.user);
  });

  await t.test('stores null for an omitted or blank registration phone', async () => {
    const omittedPhone = await request('/api/auth/register', {
      method: 'POST',
      body: {
        name: 'Omitted Phone User',
        email: 'omitted-phone@example.com',
        password: 'omitted-phone-password'
      }
    });
    assert.equal(omittedPhone.status, 201);
    assert.equal(omittedPhone.payload.user.phone, null);
    assert.equal((await findUserById(omittedPhone.payload.user.id)).phone, null);

    const blankPhone = await request('/api/auth/register', {
      method: 'POST',
      body: {
        name: 'Blank Phone User',
        email: 'blank-phone@example.com',
        password: 'blank-phone-password',
        phone: '   '
      }
    });
    assert.equal(blankPhone.status, 201);
    assert.equal(blankPhone.payload.user.phone, null);
    assert.equal((await findUserById(blankPhone.payload.user.id)).phone, null);
  });

  await t.test('rejects invalid registration phone without creating an account', async () => {
    const invalid = await request('/api/auth/register', {
      method: 'POST',
      body: {
        name: 'Invalid Phone User',
        email: 'invalid-phone@example.com',
        password: 'invalid-phone-password',
        phone: '+233 24 abc'
      }
    });

    assert.equal(invalid.status, 400);
    assert.deepEqual(invalid.payload, {
      error: 'Validation failed.',
      details: ['Phone must be a valid phone number.']
    });
    assert.equal(await findUserByEmail('invalid-phone@example.com'), null);
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
    const passportApplication = await request('/api/applications', {
      method: 'POST',
      token: primaryToken,
      body: { processId: 'passport' }
    });
    const businessApplication = await request('/api/applications', {
      method: 'POST',
      token: primaryToken,
      body: { processId: 'business-registration' }
    });
    assert.equal(passportApplication.status, 201);
    assert.equal(businessApplication.status, 201);

    const created = await request('/api/documents', {
      method: 'POST',
      token: primaryToken,
      body: {
        name: 'Metadata Passport',
        completed: true,
        documentType: 'identity-card',
        applicationId: passportApplication.payload.application.id,
        expiresAt: '2027-04-05',
        note: 'Stored as plain text: <em>memo</em>'
      }
    });

    assert.equal(created.status, 201);
    const document = created.payload.document;
    assert.equal(document.completed, true);
    assert.equal(document.documentType, 'identity-card');
    assert.equal(document.status, 'in-review');
    assert.equal(document.applicationId, passportApplication.payload.application.id);
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
      { applicationId: businessApplication.payload.application.id },
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
    assert.equal(updatedDocument.applicationId, businessApplication.payload.application.id);
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

    const profileUpdate = await request('/api/auth/me', {
      method: 'PUT',
      token: primaryToken,
      body: {
        email: ' RENAMED@example.com ',
        phone: '  +233 24 123 4567  ',
        preferences: { notifications: { documentExpiry: false } }
      }
    });
    assert.equal(profileUpdate.status, 200);
    assert.equal(profileUpdate.payload.user.email, 'renamed@example.com');
    assert.equal(profileUpdate.payload.user.phone, '+233 24 123 4567');
    assert.deepEqual(profileUpdate.payload.user.preferences, {
      notifications: {
        documentExpiry: false,
        applicationUpdates: true,
        securityAccount: true
      }
    });
    assertSanitizedUser(profileUpdate.payload.user);

    const partialPreferenceUpdate = await request('/api/auth/me', {
      method: 'PUT',
      token: primaryToken,
      body: {
        phone: '  ',
        preferences: { notifications: { applicationUpdates: false } }
      }
    });
    assert.equal(partialPreferenceUpdate.status, 200);
    assert.equal(partialPreferenceUpdate.payload.user.phone, null);
    assert.deepEqual(partialPreferenceUpdate.payload.user.preferences, {
      notifications: {
        documentExpiry: false,
        applicationUpdates: false,
        securityAccount: true
      }
    });

    for (const body of [
      { phone: 123 },
      { phone: 'p'.repeat(41) },
      { unsupported: true },
      { tokenVersion: 1 },
      { preferences: { unknown: true } },
      { preferences: { notifications: { unknown: true } } },
      { preferences: { notifications: { documentExpiry: 'false' } } },
      { preferences: { notifications: { securityAccount: false } } }
    ]) {
      const invalid = await request('/api/auth/me', { method: 'PUT', token: primaryToken, body });
      assert.equal(invalid.status, 400, JSON.stringify(body));
    }

    const unchangedProfile = await request('/api/auth/me', { token: primaryToken });
    assert.equal(unchangedProfile.status, 200);
    assert.equal(unchangedProfile.payload.user.phone, null);
    assert.deepEqual(unchangedProfile.payload.user.preferences, {
      notifications: {
        documentExpiry: false,
        applicationUpdates: false,
        securityAccount: true
      }
    });
    const otherProfileAccount = await request('/api/auth/register', {
      method: 'POST',
      body: {
        name: 'Isolated Profile User',
        email: 'isolated-profile@example.com',
        password: 'isolated-profile-password'
      }
    });
    assert.equal(otherProfileAccount.status, 201);
    const otherUserProfile = await request('/api/auth/me', { token: otherProfileAccount.payload.token });
    assert.equal(otherUserProfile.status, 200);
    assert.equal(otherUserProfile.payload.user.phone, null);
    assert.deepEqual(otherUserProfile.payload.user.preferences.notifications, {
      documentExpiry: true,
      applicationUpdates: true,
      securityAccount: true
    });

    const conflictingEmail = await request('/api/auth/me', {
      method: 'PUT',
      token: primaryToken,
      body: { email: 'legacy-account@example.com' }
    });
    assert.equal(conflictingEmail.status, 409);

    assertSanitizedUser(registration.payload.user);
    const login = await request('/api/auth/login', {
      method: 'POST',
      body: { email: 'renamed@example.com', password: passwordAtBcryptLimit }
    });
    assert.equal(login.status, 200);
    assertSanitizedUser(login.payload.user);
  });

  await t.test('changes password atomically and invalidates the previous token', async () => {
    const account = await request('/api/auth/register', {
      method: 'POST',
      body: { name: 'Password Change User', email: 'password-change@example.com', password: 'initial-password-1' }
    });
    assert.equal(account.status, 201);

    for (const newPassword of ['short', 'a'.repeat(129), 'é'.repeat(37)]) {
      const invalidNewPassword = await request('/api/auth/change-password', {
        method: 'POST',
        token: account.payload.token,
        body: { currentPassword: 'initial-password-1', newPassword }
      });
      assert.equal(invalidNewPassword.status, 400);
    }

    const incorrectCurrentPassword = await request('/api/auth/change-password', {
      method: 'POST',
      token: account.payload.token,
      body: { currentPassword: 'incorrect-password', newPassword: 'replacement-password-2' }
    });
    assert.equal(incorrectCurrentPassword.status, 401);
    assert.deepEqual(incorrectCurrentPassword.payload, {
      error: 'Current password is incorrect or account is unavailable.'
    });
    assert.equal((await request('/api/auth/me', { token: account.payload.token })).status, 200);

    const changed = await request('/api/auth/change-password', {
      method: 'POST',
      token: account.payload.token,
      body: {
        currentPassword: 'initial-password-1',
        newPassword: 'replacement-password-2',
        tokenVersion: 100
      }
    });
    assert.equal(changed.status, 400);

    const success = await request('/api/auth/change-password', {
      method: 'POST',
      token: account.payload.token,
      body: {
        currentPassword: 'initial-password-1',
        newPassword: 'replacement-password-2'
      }
    });
    assert.equal(success.status, 200);
    assertSanitizedUser(success.payload.user);
    assert.equal(Object.hasOwn(success.payload, 'password'), false);
    assert.equal(Object.hasOwn(success.payload, 'passwordHash'), false);
    assert.equal((await request('/api/auth/me', { token: account.payload.token })).status, 401);
    assert.equal((await request('/api/auth/me', { token: success.payload.token })).status, 200);

    const oldPasswordLogin = await request('/api/auth/login', {
      method: 'POST',
      body: { email: 'password-change@example.com', password: 'initial-password-1' }
    });
    assert.equal(oldPasswordLogin.status, 401);
    const newPasswordLogin = await request('/api/auth/login', {
      method: 'POST',
      body: { email: 'password-change@example.com', password: 'replacement-password-2' }
    });
    assert.equal(newPasswordLogin.status, 200);
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

  await t.test('uploads supported files with server-generated metadata and private storage', async () => {
    const application = await request('/api/applications', {
      method: 'POST',
      token: primaryToken,
      body: { processId: 'passport' }
    });
    assert.equal(application.status, 201);
    const applicationId = application.payload.application.id;

    const png = Buffer.alloc(24);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png);
    png.writeUInt32BE(13, 8);
    png.write('IHDR', 12, 'ascii');
    png.writeUInt32BE(1, 16);
    png.writeUInt32BE(1, 20);
    const jpeg = Buffer.from([
      0xff, 0xd8,
      0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00,
      0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0x00,
      0xff, 0xd9
    ]);
    const fixtures = [
      { name: '../../passport.pdf', type: 'application/pdf', fileName: 'passport.pdf', buffer: Buffer.from('%PDF-1.7\n') },
      { name: 'scan.jpg', type: 'image/jpeg', fileName: 'scan.jpg', buffer: jpeg },
      { name: 'scan.jpeg', type: 'image/jpeg', fileName: 'scan.jpeg', buffer: jpeg },
      { name: 'scan.png', type: 'image/png', fileName: 'scan.png', buffer: png }
    ];

    for (const fixture of fixtures) {
      const response = await requestMultipart('/api/documents', {
        token: primaryToken,
        fields: {
          name: 'Uploaded file',
          documentType: 'identity-card',
          applicationId,
          expiresAt: '2030-01-01',
          note: 'Multipart metadata',
          status: 'in-review'
        },
        files: [fixture]
      });

      assert.equal(response.status, 201, JSON.stringify(response.payload));
      const document = response.payload.document;
      assert.equal(document.fileName, fixture.fileName);
      assert.equal(document.fileSizeKb, Math.ceil(fixture.buffer.length / 1024));
      assert.ok(Number.isFinite(Date.parse(document.uploadedAt)));
      assert.equal(document.applicationId, applicationId);
      assert.equal(document.documentType, 'identity-card');
      assert.equal(Object.hasOwn(document, 'storageKey'), false);
      assertPublicDocument(document);

      const storedDocument = await findStoredDocument(document.id);
      assert.match(storedDocument.storageKey, /^[a-f0-9]{64}\.(?:pdf|jpg|jpeg|png)$/);
      assert.equal(path.isAbsolute(storedDocument.storageKey), false);
      const storedPath = path.join(uploadsDirectory, storedDocument.storageKey);
      assert.equal(path.dirname(path.resolve(storedPath)), path.resolve(uploadsDirectory));
      assert.deepEqual(fs.readFileSync(storedPath), fixture.buffer);
    }

    const exactLimitBuffer = Buffer.alloc(5 * 1024 * 1024);
    Buffer.from('%PDF-1.7\n').copy(exactLimitBuffer);
    const exactLimit = await requestMultipart('/api/documents', {
      token: primaryToken,
      fields: { name: 'At the upload limit' },
      files: [{ name: 'limit.pdf', type: 'application/pdf', buffer: exactLimitBuffer }]
    });
    assert.equal(exactLimit.status, 201);
    assert.equal(exactLimit.payload.document.fileSizeKb, 5120);
  });

  await t.test('rejects unauthenticated, missing, multiple, malformed, and oversized uploads', async () => {
    const file = { name: 'valid.pdf', type: 'application/pdf', buffer: Buffer.from('%PDF-1.7\n') };
    const unauthenticated = await requestMultipart('/api/documents', { files: [file] });
    assert.equal(unauthenticated.status, 401);

    const noFile = await requestMultipart('/api/documents', {
      token: primaryToken,
      fields: { name: 'Missing file' }
    });
    assert.equal(noFile.status, 400);

    const multipleFiles = await requestMultipart('/api/documents', {
      token: primaryToken,
      fields: { name: 'Multiple files' },
      files: [file, { ...file, name: 'second.pdf' }]
    });
    assert.equal(multipleFiles.status, 400);

    const tooLarge = await requestMultipart('/api/documents', {
      token: primaryToken,
      fields: { name: 'Oversized file' },
      files: [{
        ...file,
        buffer: Buffer.concat([file.buffer, Buffer.alloc(5 * 1024 * 1024 + 1 - file.buffer.length)])
      }]
    });
    assert.equal(tooLarge.status, 413);

    const malformed = await fetch(`${baseUrl}/api/documents`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer ' + primaryToken,
        'content-type': 'multipart/form-data; boundary=broken-boundary'
      },
      body: '--broken-boundary\r\nContent-Disposition: form-data; name="file"; filename="broken.pdf"\r\n'
        + 'Content-Type: application/pdf\r\n\r\n%PDF-1.7'
    });
    assert.equal(malformed.status, 400);
    assert.deepEqual(await malformed.json(), {
      error: 'Validation failed.',
      details: ['Multipart request is malformed.']
    });
  });

  await t.test('rejects unsupported, mismatched, unsafe, or client-controlled upload metadata', async () => {
    const user = await request('/api/auth/register', {
      method: 'POST',
      body: { name: 'Upload Other', email: 'upload-other@example.com', password: 'upload-other-password' }
    });
    assert.equal(user.status, 201);
    const foreignApplication = await request('/api/applications', {
      method: 'POST',
      token: user.payload.token,
      body: { processId: 'passport' }
    });
    assert.equal(foreignApplication.status, 201);

    const validFile = { name: 'file.pdf', type: 'application/pdf', buffer: Buffer.from('%PDF-1.7\n') };
    for (const file of [
      { ...validFile, name: 'file.exe' },
      { ...validFile, name: 'file.pdf', type: 'image/png' },
      { ...validFile, buffer: Buffer.from('not a PDF') }
    ]) {
      const invalid = await requestMultipart('/api/documents', {
        token: primaryToken,
        fields: { name: 'Invalid file' },
        files: [file]
      });
      assert.equal(invalid.status, 400);
      assert.equal(invalid.payload.error, 'Validation failed.');
    }

    const foreignReference = await requestMultipart('/api/documents', {
      token: primaryToken,
      fields: { name: 'Foreign application', applicationId: foreignApplication.payload.application.id },
      files: [validFile]
    });
    assert.equal(foreignReference.status, 404);
    assert.deepEqual(foreignReference.payload, { error: 'Application not found.' });

    for (const field of ['fileName', 'fileSizeKb', 'uploadedAt', 'storageKey', 'storagePath']) {
      const forgedMetadata = await requestMultipart('/api/documents', {
        token: primaryToken,
        fields: { name: 'Forged metadata', [field]: 'client-value' },
        files: [validFile]
      });
      assert.equal(forgedMetadata.status, 400, `${field} must remain server-controlled`);
    }
  });

  await t.test('retrieves uploaded files only for their owner with safe inline headers', async () => {
    const fixtures = [
      {
        name: 'retrieve-pdf.pdf',
        type: 'application/pdf',
        contentType: 'application/pdf',
        buffer: Buffer.from('%PDF-1.7\nretrieval')
      },
      {
        name: 'retrieve-jpeg.jpg',
        type: 'image/jpeg',
        contentType: 'image/jpeg',
        buffer: validJpeg()
      },
      {
        name: 'retrieve-jpeg.jpeg',
        type: 'image/jpeg',
        contentType: 'image/jpeg',
        buffer: validJpeg()
      },
      {
        name: 'retrieve-png.png',
        type: 'image/png',
        contentType: 'image/png',
        buffer: validPng()
      }
    ];

    const uploadedDocuments = [];
    for (const fixture of fixtures) {
      const uploaded = await requestMultipart('/api/documents', {
        token: primaryToken,
        fields: { name: fixture.name },
        files: [fixture]
      });
      assert.equal(uploaded.status, 201);
      uploadedDocuments.push({ ...fixture, document: uploaded.payload.document });

      const retrieved = await requestFile(
        `/api/documents/${uploaded.payload.document.id}/file`,
        primaryToken
      );
      assert.equal(retrieved.status, 200);
      assert.equal(retrieved.headers.get('content-type'), fixture.contentType);
      assert.match(retrieved.headers.get('content-disposition'), /^inline;/);
      assert.deepEqual(retrieved.body, fixture.buffer);
      assert.doesNotMatch(retrieved.headers.get('content-disposition'), /[\r\n]/);
      assert.doesNotMatch(retrieved.headers.get('content-disposition'), /storageKey|uploads/i);
    }

    const encodedNameUpload = await requestMultipart('/api/documents', {
      token: primaryToken,
      fields: { name: 'Encoded filename' },
      files: [{
        name: 'résumé "final".pdf',
        type: 'application/pdf',
        buffer: Buffer.from('%PDF-1.7\nfilename')
      }]
    });
    assert.equal(encodedNameUpload.status, 201);
    const encodedNameResponse = await requestFile(
      `/api/documents/${encodedNameUpload.payload.document.id}/file`,
      primaryToken
    );
    assert.equal(encodedNameResponse.status, 200);
    assert.match(
      encodedNameResponse.headers.get('content-disposition'),
      /filename\*=UTF-8''r%C3%A9sum%C3%A9%20%22final%22\.pdf/
    );

    const otherUser = await request('/api/auth/register', {
      method: 'POST',
      body: { name: 'Retrieval Other', email: 'retrieval-other@example.com', password: 'retrieval-other-password' }
    });
    assert.equal(otherUser.status, 201);
    const foreignDocument = uploadedDocuments[0].document;
    const manipulatedKey = await requestFile(
      `/api/documents/${foreignDocument.id}/file?storageKey=../../users.db`,
      primaryToken
    );
    assert.equal(manipulatedKey.status, 200);
    assert.deepEqual(manipulatedKey.body, fixtures[0].buffer);
    const foreign = await requestFile(
      `/api/documents/${foreignDocument.id}/file`,
      otherUser.payload.token
    );
    assert.equal(foreign.status, 404);
    assert.deepEqual(JSON.parse(foreign.body.toString()), { error: 'Document file not found.' });

    const unauthenticated = await requestFile(`/api/documents/${foreignDocument.id}/file`);
    assert.equal(unauthenticated.status, 401);
    assert.deepEqual(JSON.parse(unauthenticated.body.toString()), { error: 'A Bearer token is required.' });

    const metadataOnly = await request('/api/documents', {
      method: 'POST',
      token: primaryToken,
      body: { name: 'No physical file' }
    });
    assert.equal(metadataOnly.status, 201);
    const noFile = await requestFile(
      `/api/documents/${metadataOnly.payload.document.id}/file`,
      primaryToken
    );
    assert.equal(noFile.status, 404);
    assert.deepEqual(JSON.parse(noFile.body.toString()), { error: 'Document file not found.' });

    const missingFileDocument = await findStoredDocument(foreignDocument.id);
    await fsPromises.unlink(path.join(uploadsDirectory, missingFileDocument.storageKey));
    const missingPhysicalFile = await requestFile(
      `/api/documents/${foreignDocument.id}/file`,
      primaryToken
    );
    assert.equal(missingPhysicalFile.status, 404);
    assert.deepEqual(
      JSON.parse(missingPhysicalFile.body.toString()),
      { error: 'Document file not found.' }
    );

    const invalidId = await requestFile('/api/documents/%2e%2e%2fusers.db/file', primaryToken);
    assert.equal(invalidId.status, 400);
    assert.deepEqual(JSON.parse(invalidId.body.toString()), { error: 'Invalid document ID.' });

    for (const document of uploadedDocuments.slice(1)) {
      const stored = await findStoredDocument(document.document.id);
      await fsPromises.unlink(path.join(uploadsDirectory, stored.storageKey));
    }
    const encodedNameStored = await findStoredDocument(encodedNameUpload.payload.document.id);
    await fsPromises.unlink(path.join(uploadsDirectory, encodedNameStored.storageKey));
  });

  await t.test('replaces a document file without changing document or requirement relationships', async () => {
    const application = await request('/api/applications', {
      method: 'POST',
      token: primaryToken,
      body: { processId: 'passport' }
    });
    assert.equal(application.status, 201);
    const applicationId = application.payload.application.id;
    const uploaded = await requestMultipart('/api/documents', {
      token: primaryToken,
      fields: {
        name: 'Replace this ID',
        completed: 'true',
        documentType: 'identity-card',
        status: 'verified',
        applicationId,
        expiresAt: '2031-04-05',
        note: 'Preserve this metadata'
      },
      files: [{
        name: 'old-copy.pdf',
        type: 'application/pdf',
        buffer: Buffer.from('%PDF-1.7\nold copy')
      }]
    });
    assert.equal(uploaded.status, 201);
    const documentId = uploaded.payload.document.id;
    const oldRecord = await findStoredDocument(documentId);
    const oldPath = path.join(uploadsDirectory, oldRecord.storageKey);

    const link = await request(`/api/applications/${applicationId}/requirements/identity-card`, {
      method: 'PATCH',
      token: primaryToken,
      body: { status: 'completed', documentId }
    });
    assert.equal(link.status, 200);

    const newBytes = Buffer.from('%PDF-1.7\nreplacement bytes');
    const replaced = await requestMultipart(`/api/documents/${documentId}/file`, {
      method: 'PUT',
      token: primaryToken,
      files: [{ name: 'new-copy.pdf', type: 'application/pdf', buffer: newBytes }]
    });
    assert.equal(replaced.status, 200, JSON.stringify(replaced.payload));
    assert.equal(replaced.payload.document.id, documentId);
    assert.equal(replaced.payload.document.name, oldRecord.name);
    assert.equal(replaced.payload.document.completed, oldRecord.completed);
    assert.equal(replaced.payload.document.applicationId, oldRecord.applicationId);
    assert.equal(replaced.payload.document.documentType, oldRecord.documentType);
    assert.equal(replaced.payload.document.status, oldRecord.status);
    assert.equal(replaced.payload.document.note, oldRecord.note);
    assert.equal(replaced.payload.document.expiresAt, oldRecord.expiresAt);
    assert.equal(replaced.payload.document.fileName, 'new-copy.pdf');
    assert.equal(replaced.payload.document.fileSizeKb, Math.ceil(newBytes.length / 1024));
    assert.ok(Number.isFinite(Date.parse(replaced.payload.document.uploadedAt)));
    assert.equal(Object.hasOwn(replaced.payload.document, 'storageKey'), false);

    const newRecord = await findStoredDocument(documentId);
    assert.notEqual(newRecord.storageKey, oldRecord.storageKey);
    assert.equal(fs.existsSync(oldPath), false);
    assert.deepEqual(fs.readFileSync(path.join(uploadsDirectory, newRecord.storageKey)), newBytes);

    const applicationAfter = await request(`/api/applications/${applicationId}`, { token: primaryToken });
    const requirement = applicationAfter.payload.application.requirements
      .find((entry) => entry.key === 'identity-card');
    assert.equal(requirement.documentId, documentId);
    assert.equal(requirement.status, 'completed');
  });

  await t.test('replacement can add a file to a metadata-only document', async () => {
    const created = await request('/api/documents', {
      method: 'POST',
      token: primaryToken,
      body: {
        name: 'Metadata-only until now',
        completed: true,
        documentType: 'other',
        status: 'draft',
        applicationId: null,
        expiresAt: '2032-06-07',
        note: 'Keep all existing data'
      }
    });
    assert.equal(created.status, 201);
    const original = await findStoredDocument(created.payload.document.id);
    assert.equal(original.storageKey, undefined);

    const bytes = Buffer.from('%PDF-1.7\nfirst file');
    const replaced = await requestMultipart(`/api/documents/${original._id}/file`, {
      method: 'PUT',
      token: primaryToken,
      files: [{ name: 'first-file.pdf', type: 'application/pdf', buffer: bytes }]
    });
    assert.equal(replaced.status, 200);
    assert.equal(replaced.payload.document.id, original._id);
    assert.equal(replaced.payload.document.name, original.name);
    assert.equal(replaced.payload.document.completed, original.completed);
    assert.equal(replaced.payload.document.documentType, original.documentType);
    assert.equal(replaced.payload.document.status, original.status);
    assert.equal(replaced.payload.document.applicationId, original.applicationId);
    assert.equal(replaced.payload.document.expiresAt, original.expiresAt);
    assert.equal(replaced.payload.document.note, original.note);
    assert.equal(replaced.payload.document.fileName, 'first-file.pdf');

    const updated = await findStoredDocument(original._id);
    assert.match(updated.storageKey, /^[a-f0-9]{64}\.pdf$/);
    assert.deepEqual(fs.readFileSync(path.join(uploadsDirectory, updated.storageKey)), bytes);
  });

  await t.test('rejects invalid, oversized, missing, and multiple replacement files without changing the old file', async () => {
    const uploaded = await uploadPdf(primaryToken, 'Keep on invalid replacement');
    assert.equal(uploaded.status, 201);
    const original = await findStoredDocument(uploaded.payload.document.id);
    const originalPath = path.join(uploadsDirectory, original.storageKey);

    for (const invalidFile of [
      { name: 'wrong.txt', type: 'text/plain', buffer: Buffer.from('text') },
      { name: 'wrong-mime.pdf', type: 'image/png', buffer: Buffer.from('%PDF-1.7\n') },
      { name: 'wrong-signature.pdf', type: 'application/pdf', buffer: Buffer.from('not pdf') }
    ]) {
      const rejected = await requestMultipart(`/api/documents/${original._id}/file`, {
        method: 'PUT',
        token: primaryToken,
        files: [invalidFile]
      });
      assert.equal(rejected.status, 400);
    }

    const oversizedBytes = Buffer.alloc(5 * 1024 * 1024 + 1);
    Buffer.from('%PDF-1.7\n').copy(oversizedBytes);
    const oversized = await requestMultipart(`/api/documents/${original._id}/file`, {
      method: 'PUT',
      token: primaryToken,
      files: [{ name: 'oversized.pdf', type: 'application/pdf', buffer: oversizedBytes }]
    });
    assert.equal(oversized.status, 413);

    const missing = await requestMultipart(`/api/documents/${original._id}/file`, {
      method: 'PUT',
      token: primaryToken
    });
    assert.equal(missing.status, 400);
    const multiple = await requestMultipart(`/api/documents/${original._id}/file`, {
      method: 'PUT',
      token: primaryToken,
      files: [
        { name: 'one.pdf', type: 'application/pdf', buffer: Buffer.from('%PDF-1.7\n') },
        { name: 'two.pdf', type: 'application/pdf', buffer: Buffer.from('%PDF-1.7\n') }
      ]
    });
    assert.equal(multiple.status, 400);
    const metadata = await requestMultipart(`/api/documents/${original._id}/file`, {
      method: 'PUT',
      token: primaryToken,
      fields: { status: 'expired' },
      files: [{ name: 'metadata.pdf', type: 'application/pdf', buffer: Buffer.from('%PDF-1.7\n') }]
    });
    assert.equal(metadata.status, 400);

    const unchanged = await findStoredDocument(original._id);
    assert.equal(unchanged.storageKey, original.storageKey);
    assert.equal(unchanged.fileName, original.fileName);
    assert.equal(fs.existsSync(originalPath), true);
  });

  await t.test('replacement requires authentication and document ownership', async () => {
    const owner = await request('/api/auth/register', {
      method: 'POST',
      body: { name: 'Replacement Owner', email: 'replacement-owner@example.com', password: 'replacement-owner-pass' }
    });
    const other = await request('/api/auth/register', {
      method: 'POST',
      body: { name: 'Replacement Other', email: 'replacement-other@example.com', password: 'replacement-other-pass' }
    });
    assert.equal(owner.status, 201);
    assert.equal(other.status, 201);
    const uploaded = await uploadPdf(owner.payload.token, 'Owned replacement target');
    assert.equal(uploaded.status, 201);

    const file = { name: 'unauthorized.pdf', type: 'application/pdf', buffer: Buffer.from('%PDF-1.7\n') };
    const unauthenticated = await requestMultipart(`/api/documents/${uploaded.payload.document.id}/file`, {
      method: 'PUT',
      files: [file]
    });
    assert.equal(unauthenticated.status, 401);
    const foreign = await requestMultipart(`/api/documents/${uploaded.payload.document.id}/file`, {
      method: 'PUT',
      token: other.payload.token,
      files: [file]
    });
    assert.equal(foreign.status, 404);
    assert.deepEqual(foreign.payload, { error: 'Document not found.' });
  });

  await t.test('database update failure retains the old file and cleans the staged replacement', async () => {
    const uploaded = await uploadPdf(primaryToken, 'Database failure replacement');
    assert.equal(uploaded.status, 201);
    const original = await findStoredDocument(uploaded.payload.document.id);
    const oldPath = path.join(uploadsDirectory, original.storageKey);
    const originalUpdate = documentsDatabase.update;
    const originalUnlink = fsPromises.unlink;
    const originalConsoleError = console.error;
    const attemptedUnlinks = [];
    documentsDatabase.update = function update(query, changes, options, callback) {
      if (query._id === original._id && changes.$set && changes.$set.storageKey) {
        return callback(new Error('Injected replacement database failure.'), 0, null);
      }
      return originalUpdate.call(this, query, changes, options, callback);
    };
    fsPromises.unlink = async (filePath) => {
      attemptedUnlinks.push(filePath);
      return originalUnlink(filePath);
    };
    console.error = () => {};

    try {
      const failed = await requestMultipart(`/api/documents/${original._id}/file`, {
        method: 'PUT',
        token: primaryToken,
        files: [{
          name: 'staged replacement.pdf',
          type: 'application/pdf',
          buffer: Buffer.from('%PDF-1.7\nstaged')
        }]
      });
      assert.equal(failed.status, 500);
      assert.deepEqual(failed.payload, { error: 'An unexpected server error occurred.' });
    } finally {
      documentsDatabase.update = originalUpdate;
      fsPromises.unlink = originalUnlink;
      console.error = originalConsoleError;
    }

    const current = await findStoredDocument(original._id);
    assert.equal(current.storageKey, original.storageKey);
    assert.equal(fs.existsSync(oldPath), true);
    assert.equal(attemptedUnlinks.length, 1);
    assert.notEqual(attemptedUnlinks[0], oldPath);
    assert.equal(fs.existsSync(attemptedUnlinks[0]), false);
  });

  await t.test('old-file deletion failure does not undo a successful replacement', async () => {
    const uploaded = await uploadPdf(primaryToken, 'Old-file cleanup failure');
    assert.equal(uploaded.status, 201);
    const original = await findStoredDocument(uploaded.payload.document.id);
    const oldPath = path.join(uploadsDirectory, original.storageKey);
    const originalUnlink = fsPromises.unlink;
    const originalConsoleError = console.error;
    fsPromises.unlink = async (filePath) => {
      if (filePath === oldPath) {
        throw Object.assign(new Error('Injected old-file cleanup failure.'), { code: 'EACCES' });
      }
      return originalUnlink(filePath);
    };
    console.error = () => {};

    let replaced;
    try {
      replaced = await requestMultipart(`/api/documents/${original._id}/file`, {
        method: 'PUT',
        token: primaryToken,
        files: [{
          name: 'new-authoritative-file.pdf',
          type: 'application/pdf',
          buffer: Buffer.from('%PDF-1.7\nnew authoritative bytes')
        }]
      });
    } finally {
      fsPromises.unlink = originalUnlink;
      console.error = originalConsoleError;
    }

    assert.equal(replaced.status, 200);
    const current = await findStoredDocument(original._id);
    assert.notEqual(current.storageKey, original.storageKey);
    assert.equal(fs.existsSync(oldPath), true);
    assert.equal(fs.existsSync(path.join(uploadsDirectory, current.storageKey)), true);
    assert.equal(replaced.payload.document.id, original._id);
    assert.equal(replaced.payload.document.fileName, 'new-authoritative-file.pdf');
    await originalUnlink(oldPath);
  });

  await t.test('deletes uploaded files with documents and preserves metadata-only deletion', async () => {
    const uploaded = await uploadPdf(primaryToken, 'Delete uploaded document');
    assert.equal(uploaded.status, 201);
    const fileDocument = await findStoredDocument(uploaded.payload.document.id);
    const filePath = path.join(uploadsDirectory, fileDocument.storageKey);
    assert.equal(fs.existsSync(filePath), true);

    const deletedFileDocument = await request(`/api/documents/${fileDocument._id}`, {
      method: 'DELETE',
      token: primaryToken
    });
    assert.equal(deletedFileDocument.status, 200);
    assert.equal(fs.existsSync(filePath), false);
    assert.equal(await findStoredDocument(fileDocument._id), null);

    const metadataOnly = await request('/api/documents', {
      method: 'POST',
      token: primaryToken,
      body: { name: 'Delete metadata-only document' }
    });
    assert.equal(metadataOnly.status, 201);
    const deletedMetadataOnly = await request(`/api/documents/${metadataOnly.payload.document.id}`, {
      method: 'DELETE',
      token: primaryToken
    });
    assert.equal(deletedMetadataOnly.status, 200);
    assert.equal(await findStoredDocument(metadataOnly.payload.document.id), null);
  });

  await t.test('deletes documents whose file is missing without affecting other files', async () => {
    const missingFileUpload = await uploadPdf(primaryToken, 'Already missing file');
    const retainedFileUpload = await uploadPdf(primaryToken, 'Retained unrelated file');
    assert.equal(missingFileUpload.status, 201);
    assert.equal(retainedFileUpload.status, 201);

    const missingDocument = await findStoredDocument(missingFileUpload.payload.document.id);
    const retainedDocument = await findStoredDocument(retainedFileUpload.payload.document.id);
    const missingPath = path.join(uploadsDirectory, missingDocument.storageKey);
    const retainedPath = path.join(uploadsDirectory, retainedDocument.storageKey);
    await fsPromises.unlink(missingPath);

    const deleted = await request(`/api/documents/${missingDocument._id}`, {
      method: 'DELETE',
      token: primaryToken
    });
    assert.equal(deleted.status, 200);
    assert.equal(await findStoredDocument(missingDocument._id), null);
    assert.equal(fs.existsSync(retainedPath), true);
  });

  await t.test('document deletion cannot remove another user\'s uploaded file', async () => {
    const owner = await request('/api/auth/register', {
      method: 'POST',
      body: { name: 'File Owner', email: 'file-owner@example.com', password: 'file-owner-password' }
    });
    const other = await request('/api/auth/register', {
      method: 'POST',
      body: { name: 'Other File Owner', email: 'other-file-owner@example.com', password: 'other-file-owner-password' }
    });
    assert.equal(owner.status, 201);
    assert.equal(other.status, 201);

    const ownerUpload = await uploadPdf(owner.payload.token, 'Owner uploaded file');
    const otherUpload = await uploadPdf(other.payload.token, 'Other user uploaded file');
    assert.equal(ownerUpload.status, 201);
    assert.equal(otherUpload.status, 201);
    const ownerDocument = await findStoredDocument(ownerUpload.payload.document.id);
    const otherDocument = await findStoredDocument(otherUpload.payload.document.id);
    const ownerPath = path.join(uploadsDirectory, ownerDocument.storageKey);
    const otherPath = path.join(uploadsDirectory, otherDocument.storageKey);

    const deleted = await request(`/api/documents/${ownerDocument._id}`, {
      method: 'DELETE',
      token: owner.payload.token
    });
    assert.equal(deleted.status, 200);
    assert.equal(fs.existsSync(ownerPath), false);
    assert.equal(fs.existsSync(otherPath), true);
  });

  await t.test('clears requirement references when deleting an uploaded document', async () => {
    const application = await request('/api/applications', {
      method: 'POST',
      token: primaryToken,
      body: { processId: 'passport' }
    });
    assert.equal(application.status, 201);

    const uploaded = await uploadPdf(primaryToken, 'Linked identity document', {
      documentType: 'identity-card',
      applicationId: application.payload.application.id
    });
    assert.equal(uploaded.status, 201);
    const linked = await request(
      `/api/applications/${application.payload.application.id}/requirements/identity-card`,
      {
        method: 'PATCH',
        token: primaryToken,
        body: { status: 'completed', documentId: uploaded.payload.document.id }
      }
    );
    assert.equal(linked.status, 200);

    const fileDocument = await findStoredDocument(uploaded.payload.document.id);
    const filePath = path.join(uploadsDirectory, fileDocument.storageKey);
    const deleted = await request(`/api/documents/${fileDocument._id}`, {
      method: 'DELETE',
      token: primaryToken
    });
    assert.equal(deleted.status, 200);
    assert.equal(fs.existsSync(filePath), false);

    const retrievedApplication = await request(
      `/api/applications/${application.payload.application.id}`,
      { token: primaryToken }
    );
    assert.equal(retrievedApplication.status, 200);
    const requirement = retrievedApplication.payload.application.requirements
      .find((entry) => entry.key === 'identity-card');
    assert.equal(requirement.status, 'missing');
    assert.equal(requirement.documentId, null);
    assert.equal(requirement.completedAt, null);
  });

  await t.test('does not delete a document or its requirement reference when file removal fails', async () => {
    const application = await request('/api/applications', {
      method: 'POST',
      token: primaryToken,
      body: { processId: 'passport' }
    });
    assert.equal(application.status, 201);

    const uploaded = await uploadPdf(primaryToken, 'File deletion failure document', {
      documentType: 'identity-card',
      applicationId: application.payload.application.id
    });
    assert.equal(uploaded.status, 201);
    const linked = await request(
      `/api/applications/${application.payload.application.id}/requirements/identity-card`,
      {
        method: 'PATCH',
        token: primaryToken,
        body: { status: 'completed', documentId: uploaded.payload.document.id }
      }
    );
    assert.equal(linked.status, 200);

    const fileDocument = await findStoredDocument(uploaded.payload.document.id);
    const filePath = path.join(uploadsDirectory, fileDocument.storageKey);
    const originalUnlink = fsPromises.unlink;
    const originalConsoleError = console.error;
    fsPromises.unlink = async () => {
      throw Object.assign(new Error('Injected file deletion failure.'), { code: 'EACCES' });
    };
    console.error = () => {};

    try {
      const failedDeletion = await request(`/api/documents/${fileDocument._id}`, {
        method: 'DELETE',
        token: primaryToken
      });
      assert.equal(failedDeletion.status, 500);
      assert.deepEqual(failedDeletion.payload, { error: 'An unexpected server error occurred.' });
    } finally {
      fsPromises.unlink = originalUnlink;
      console.error = originalConsoleError;
    }

    assert.ok(await findStoredDocument(fileDocument._id));
    assert.equal(fs.existsSync(filePath), true);
    const stillLinked = await request(
      `/api/applications/${application.payload.application.id}`,
      { token: primaryToken }
    );
    const requirement = stillLinked.payload.application.requirements
      .find((entry) => entry.key === 'identity-card');
    assert.equal(requirement.documentId, fileDocument._id);
  });

  await t.test('account deletion removes only owned files and tolerates missing files', async () => {
    const accountA = await request('/api/auth/register', {
      method: 'POST',
      body: { name: 'Upload Cleanup A', email: 'upload-cleanup-a@example.com', password: 'upload-cleanup-a-pass' }
    });
    const accountB = await request('/api/auth/register', {
      method: 'POST',
      body: { name: 'Upload Cleanup B', email: 'upload-cleanup-b@example.com', password: 'upload-cleanup-b-pass' }
    });
    assert.equal(accountA.status, 201);
    assert.equal(accountB.status, 201);

    const accountAUpload = await uploadPdf(accountA.payload.token, 'Account A file to remove');
    const accountAMissingUpload = await uploadPdf(accountA.payload.token, 'Account A already missing file');
    const accountBUpload = await uploadPdf(accountB.payload.token, 'Account B retained file');
    assert.equal(accountAUpload.status, 201);
    assert.equal(accountAMissingUpload.status, 201);
    assert.equal(accountBUpload.status, 201);

    const accountADocument = await findStoredDocument(accountAUpload.payload.document.id);
    const accountAMissingDocument = await findStoredDocument(accountAMissingUpload.payload.document.id);
    const accountBDocument = await findStoredDocument(accountBUpload.payload.document.id);
    const accountAPath = path.join(uploadsDirectory, accountADocument.storageKey);
    const accountAMissingPath = path.join(uploadsDirectory, accountAMissingDocument.storageKey);
    const accountBPath = path.join(uploadsDirectory, accountBDocument.storageKey);
    await fsPromises.unlink(accountAMissingPath);

    const metadataOnly = await request('/api/documents', {
      method: 'POST',
      token: accountA.payload.token,
      body: { name: 'Account A metadata-only document' }
    });
    assert.equal(metadataOnly.status, 201);

    const deleted = await request('/api/auth/me', {
      method: 'DELETE',
      token: accountA.payload.token
    });
    assert.equal(deleted.status, 200);
    assert.equal(fs.existsSync(accountAPath), false);
    assert.equal(fs.existsSync(accountAMissingPath), false);
    assert.equal(fs.existsSync(accountBPath), true);
    assert.deepEqual(await findDocumentsByOwnerId(accountA.payload.user.id), []);
    assert.deepEqual((await findDocumentsByOwnerId(accountB.payload.user.id)).map((document) => document._id), [
      accountBDocument._id
    ]);
  });

  await t.test('does not clean up account records when an owned file cannot be removed', async () => {
    const account = await request('/api/auth/register', {
      method: 'POST',
      body: { name: 'Account File Failure', email: 'account-file-failure@example.com', password: 'account-file-failure-pass' }
    });
    assert.equal(account.status, 201);

    const uploaded = await uploadPdf(account.payload.token, 'Account file failure');
    const metadataOnly = await request('/api/documents', {
      method: 'POST',
      token: account.payload.token,
      body: { name: 'Account metadata-only failure' }
    });
    assert.equal(uploaded.status, 201);
    assert.equal(metadataOnly.status, 201);
    const fileDocument = await findStoredDocument(uploaded.payload.document.id);
    const filePath = path.join(uploadsDirectory, fileDocument.storageKey);
    const originalUnlink = fsPromises.unlink;
    const originalConsoleError = console.error;
    fsPromises.unlink = async () => {
      throw Object.assign(new Error('Injected account file deletion failure.'), { code: 'EACCES' });
    };
    console.error = () => {};

    try {
      const failedDeletion = await request('/api/auth/me', {
        method: 'DELETE',
        token: account.payload.token
      });
      assert.equal(failedDeletion.status, 500);
      assert.deepEqual(failedDeletion.payload, { error: 'An unexpected server error occurred.' });
    } finally {
      fsPromises.unlink = originalUnlink;
      console.error = originalConsoleError;
    }

    assert.ok(await findUserById(account.payload.user.id));
    assert.equal((await findUserById(account.payload.user.id)).deleting, true);
    assert.equal((await findDocumentsByOwnerId(account.payload.user.id)).length, 2);
    assert.equal(fs.existsSync(filePath), true);

    const retriedDeletion = await request('/api/auth/me', {
      method: 'DELETE',
      token: account.payload.token
    });
    assert.equal(retriedDeletion.status, 200);
    assert.deepEqual(await findDocumentsByOwnerId(account.payload.user.id), []);
    assert.equal(await findUserById(account.payload.user.id), null);
    assert.equal(fs.existsSync(filePath), false);
  });

  await t.test('cleans stored files if document persistence fails', async () => {
    const file = { name: 'database-failure.pdf', type: 'application/pdf', buffer: Buffer.from('%PDF-1.7\n') };
    const existingFiles = new Set(fs.existsSync(uploadsDirectory) ? fs.readdirSync(uploadsDirectory) : []);
    const originalInsert = documentsDatabase.insert;
    const originalConsoleError = console.error;
    documentsDatabase.insert = (_document, callback) => callback(new Error('Injected document insert failure.'));
    console.error = () => {};

    try {
      const failure = await requestMultipart('/api/documents', {
        token: primaryToken,
        fields: { name: 'Database failure' },
        files: [file]
      });
      assert.equal(failure.status, 500);
      assert.deepEqual(await findDocumentsByOwnerId(registration.payload.user.id)
        .then((documents) => documents.filter((document) => document.name === 'Database failure')), []);
    } finally {
      documentsDatabase.insert = originalInsert;
      console.error = originalConsoleError;
    }

    const filesAfterFailure = new Set(fs.existsSync(uploadsDirectory) ? fs.readdirSync(uploadsDirectory) : []);
    assert.deepEqual(filesAfterFailure, existingFiles);
  });
});
