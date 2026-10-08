const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { after, before, test } = require('node:test');

const dataDirectory = path.resolve(__dirname, '..', 'data');
const testDataDirectory = fs.mkdtempSync(path.join(dataDirectory, '.test-security-headers-'));

process.env.JWT_SECRET = 'document-checklist-security-header-test-secret';
process.env.NODE_ENV = 'production';
process.env.TRUSTED_PROXY_IPS = '127.0.0.1';
process.env.CORS_ALLOWED_ORIGINS = 'https://frontend.example.test, https://admin.example.test';
process.env.DOCUMENT_CHECKLIST_USERS_DB_PATH = path.join(testDataDirectory, 'users.db');
process.env.DOCUMENT_CHECKLIST_DOCUMENTS_DB_PATH = path.join(testDataDirectory, 'documents.db');
process.env.DOCUMENT_CHECKLIST_APPLICATIONS_DB_PATH = path.join(testDataDirectory, 'applications.db');
process.env.DOCUMENT_CHECKLIST_NOTIFICATIONS_DB_PATH = path.join(testDataDirectory, 'notifications.db');

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
  if (path.dirname(cleanupTarget) !== dataDirectory || !path.basename(cleanupTarget).startsWith('.test-security-headers-')) {
    throw new Error('Refusing to remove a path outside this run\'s temporary test directory.');
  }
  fs.rmSync(cleanupTarget, { recursive: true, force: true });
});

async function request(route, { method = 'GET', body, forwardedProto = 'https', headers: extraHeaders = {} } = {}) {
  const headers = body === undefined ? {} : { 'content-type': 'application/json' };
  if (forwardedProto) {
    headers['x-forwarded-proto'] = forwardedProto;
  }
  Object.assign(headers, extraHeaders);

  const response = await fetch(`${baseUrl}${route}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return response;
}

function assertSecurityHeaders(response) {
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('x-frame-options'), 'SAMEORIGIN');
  assert.equal(response.headers.get('content-security-policy'), null);
}

test('allows a configured production frontend CORS preflight with required methods and headers', async () => {
  const response = await request('/api/documents', {
    method: 'OPTIONS',
    headers: {
      origin: 'https://frontend.example.test',
      'access-control-request-method': 'POST',
      'access-control-request-headers': 'Content-Type,Authorization'
    }
  });

  assert.equal(response.status, 204);
  assert.equal(response.headers.get('access-control-allow-origin'), 'https://frontend.example.test');
  assert.equal(response.headers.get('access-control-allow-methods'), 'GET,HEAD,POST,PUT,PATCH,DELETE');
  assert.equal(response.headers.get('access-control-allow-headers'), 'Content-Type,Authorization');
  assert.equal(response.headers.get('access-control-allow-credentials'), null);
  assertSecurityHeaders(response);
});

test('allows multiple configured origins and rejects unconfigured origins', async () => {
  const allowedResponse = await request('/api/auth/me', {
    headers: { origin: 'https://admin.example.test' }
  });
  const rejectedResponses = await Promise.all([
    request('/api/auth/me', { headers: { origin: 'https://unconfigured.example.test' } }),
    request('/api/auth/me', { headers: { origin: 'http://localhost:5173' } })
  ]);

  assert.equal(allowedResponse.headers.get('access-control-allow-origin'), 'https://admin.example.test');
  for (const response of rejectedResponses) {
    assert.equal(response.headers.get('access-control-allow-origin'), null);
    assertSecurityHeaders(response);
  }
});

test('sets Helmet headers on successful and error API responses', async () => {
  const successfulResponse = await request('/api/auth/register', {
    method: 'POST',
    body: { name: 'Header User', email: 'headers@example.com', password: 'safe-test-password' }
  });
  assert.equal(successfulResponse.status, 201);
  assertSecurityHeaders(successfulResponse);

  const errorResponse = await request('/api/auth/me');
  assert.equal(errorResponse.status, 401);
  assertSecurityHeaders(errorResponse);
});

test('requires HTTPS as reported by the explicitly trusted proxy in production', async () => {
  for (const forwardedProto of ['http', null]) {
    const response = await request('/api/auth/me', { forwardedProto });
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: 'HTTPS is required.' });
  }

  const secureResponse = await request('/api/auth/me');
  assert.equal(secureResponse.status, 401);
});
