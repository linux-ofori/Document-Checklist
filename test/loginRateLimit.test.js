const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { after, before, test } = require('node:test');

const dataDirectory = path.resolve(__dirname, '..', 'data');
const testDataDirectory = fs.mkdtempSync(path.join(dataDirectory, '.test-rate-limit-'));

process.env.JWT_SECRET = 'document-checklist-rate-limit-test-secret';
process.env.NODE_ENV = 'test';
delete process.env.TRUSTED_PROXY_IPS;
process.env.DOCUMENT_CHECKLIST_USERS_DB_PATH = path.join(testDataDirectory, 'users.db');
process.env.DOCUMENT_CHECKLIST_DOCUMENTS_DB_PATH = path.join(testDataDirectory, 'documents.db');
process.env.DOCUMENT_CHECKLIST_APPLICATIONS_DB_PATH = path.join(testDataDirectory, 'applications.db');
process.env.LOGIN_RATE_LIMIT_WINDOW_MS = '900000';
process.env.LOGIN_RATE_LIMIT_MAX = '5';
process.env.REGISTRATION_RATE_LIMIT_WINDOW_MS = '900000';
process.env.REGISTRATION_RATE_LIMIT_MAX = '2';
process.env.PASSWORD_CHANGE_RATE_LIMIT_WINDOW_MS = '900000';
process.env.PASSWORD_CHANGE_RATE_LIMIT_MAX = '2';

const app = require('../src/server');
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
  if (path.dirname(cleanupTarget) !== dataDirectory || !path.basename(cleanupTarget).startsWith('.test-rate-limit-')) {
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
  return { status: response.status, payload: await response.json() };
}

test('limits repeated login requests without limiting other auth routes', async () => {
  const credentials = {
    name: 'Rate Limit User',
    email: 'rate-limit@example.com',
    password: 'safe-test-password'
  };
  const registration = await request('/api/auth/register', { method: 'POST', body: credentials });
  assert.equal(registration.status, 201);

  const successfulLogin = await request('/api/auth/login', {
    method: 'POST',
    body: { email: credentials.email, password: credentials.password }
  });
  assert.equal(successfulLogin.status, 200);
  assert.equal(typeof successfulLogin.payload.token, 'string');

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const failedLogin = await request('/api/auth/login', {
      method: 'POST',
      body: { email: credentials.email, password: 'incorrect-test-password' }
    });
    assert.equal(failedLogin.status, 401);
  }

  const limitedLogin = await request('/api/auth/login', {
    method: 'POST',
    body: { email: credentials.email, password: 'incorrect-test-password' }
  });
  assert.equal(limitedLogin.status, 429);
  assert.deepEqual(limitedLogin.payload, {
    error: 'Too many login attempts. Please try again later.'
  });

  const registrationAfterLimit = await request('/api/auth/register', {
    method: 'POST',
    body: { name: 'Second User', email: 'second-rate-limit@example.com', password: 'safe-test-password' }
  });
  assert.equal(registrationAfterLimit.status, 201);

  const limitedRegistration = await request('/api/auth/register', {
    method: 'POST',
    body: { name: 'Third User', email: 'third-rate-limit@example.com', password: 'safe-test-password' }
  });
  assert.equal(limitedRegistration.status, 429);
  assert.deepEqual(limitedRegistration.payload, {
    error: 'Too many registration attempts. Please try again later.'
  });

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const rejectedChange = await request('/api/auth/change-password', {
      method: 'POST',
      token: successfulLogin.payload.token,
      body: { currentPassword: 'incorrect-password', newPassword: 'replacement-password' }
    });
    assert.equal(rejectedChange.status, 401);
  }

  const limitedChange = await request('/api/auth/change-password', {
    method: 'POST',
    token: successfulLogin.payload.token,
    body: { currentPassword: 'incorrect-password', newPassword: 'replacement-password' }
  });
  assert.equal(limitedChange.status, 429);
  assert.deepEqual(limitedChange.payload, {
    error: 'Too many password change attempts. Please try again later.'
  });
});
