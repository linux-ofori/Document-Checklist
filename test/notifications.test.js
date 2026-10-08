const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { after, before, test } = require('node:test');

const dataDirectory = path.resolve(__dirname, '..', 'data');
const testDataDirectory = fs.mkdtempSync(path.join(dataDirectory, '.test-notifications-'));
process.env.JWT_SECRET = 'document-checklist-notification-test-secret';
process.env.NODE_ENV = 'test';
delete process.env.TRUSTED_PROXY_IPS;
process.env.DOCUMENT_CHECKLIST_USERS_DB_PATH = path.join(testDataDirectory, 'users.db');
process.env.DOCUMENT_CHECKLIST_DOCUMENTS_DB_PATH = path.join(testDataDirectory, 'documents.db');
process.env.DOCUMENT_CHECKLIST_APPLICATIONS_DB_PATH = path.join(testDataDirectory, 'applications.db');
process.env.DOCUMENT_CHECKLIST_NOTIFICATIONS_DB_PATH = path.join(testDataDirectory, 'notifications.db');
process.env.DOCUMENT_CHECKLIST_UPLOADS_DIRECTORY = path.join(testDataDirectory, 'uploads');
process.env.REGISTRATION_RATE_LIMIT_MAX = '50';

const app = require('../src/server');
const notificationsDatabase = require('../src/config/notificationsDatabase');
const {
  createNotification,
  findNotificationsByOwnerId
} = require('../src/models/notificationModel');
let server;
let baseUrl;
let userCounter = 0;

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
  if (path.dirname(cleanupTarget) !== dataDirectory
      || !path.basename(cleanupTarget).startsWith('.test-notifications-')) {
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

async function registerUser() {
  userCounter += 1;
  const response = await request('/api/auth/register', {
    method: 'POST',
    body: {
      name: `Notification User ${userCounter}`,
      email: `notification-user-${userCounter}@example.com`,
      password: 'notification-test-password'
    }
  });
  assert.equal(response.status, 201);
  return response.payload;
}

function addNotification(ownerId, overrides = {}) {
  return createNotification({
    ownerId,
    kind: 'application',
    title: 'Checklist requirement completed',
    body: 'Ghana Card for Passport Application is complete.',
    severity: 'success',
    applicationId: '0123456789abcdef',
    ...overrides
  });
}

test('notification endpoints require authentication', async () => {
  assert.equal((await request('/api/notifications')).status, 401);
  assert.equal((await request('/api/notifications/0123456789abcdef/read', { method: 'PATCH' })).status, 401);
  assert.equal((await request('/api/notifications/read-all', { method: 'POST' })).status, 401);

  const user = await registerUser();
  const unsupported = await request('/api/notifications', {
    method: 'POST',
    token: user.token,
    body: { title: 'Client-generated notification' }
  });
  assert.equal(unsupported.status, 404);
});

test('lists only the authenticated user notifications newest first without internal fields', async () => {
  const owner = await registerUser();
  const other = await registerUser();
  const older = await addNotification(owner.user.id, { title: 'Older notification' });
  await new Promise((resolve) => setTimeout(resolve, 5));
  const newer = await addNotification(owner.user.id, { title: 'Newer notification' });
  await addNotification(other.user.id, { title: 'Other user notification' });

  const result = await request('/api/notifications', { token: owner.token });
  assert.equal(result.status, 200);
  assert.deepEqual(result.payload.notifications.map(({ id }) => id), [newer._id, older._id]);
  assert.deepEqual(result.payload.notifications.map(({ title }) => title), [
    'Newer notification',
    'Older notification'
  ]);
  for (const notification of result.payload.notifications) {
    assert.equal(Object.hasOwn(notification, '_id'), false);
    assert.equal(Object.hasOwn(notification, 'ownerId'), false);
  }
});

test('rejects malformed IDs and hides unknown or another user notifications as not found', async () => {
  const owner = await registerUser();
  const other = await registerUser();
  const otherNotification = await addNotification(other.user.id);

  const malformed = await request('/api/notifications/not-a-valid-id/read', {
    method: 'PATCH',
    token: owner.token
  });
  assert.equal(malformed.status, 400);
  assert.deepEqual(malformed.payload, { error: 'Invalid notification ID.' });

  const unknown = await request('/api/notifications/0000000000000000/read', {
    method: 'PATCH',
    token: owner.token
  });
  assert.equal(unknown.status, 404);
  assert.deepEqual(unknown.payload, { error: 'Notification not found.' });

  const foreign = await request(`/api/notifications/${otherNotification._id}/read`, {
    method: 'PATCH',
    token: owner.token
  });
  assert.equal(foreign.status, 404);
  assert.deepEqual(foreign.payload, unknown.payload);
  assert.equal((await findNotificationsByOwnerId(other.user.id))[0].isRead, false);
});

test('rejects unexpected body fields for mark-one-read and mark-all-read', async () => {
  const owner = await registerUser();
  const notification = await addNotification(owner.user.id);

  const markOne = await request(`/api/notifications/${notification._id}/read`, {
    method: 'PATCH',
    token: owner.token,
    body: { isRead: false }
  });
  assert.equal(markOne.status, 400);
  assert.deepEqual(markOne.payload, {
    error: 'Validation failed.',
    details: ['The isRead field cannot be set.']
  });

  const markAll = await request('/api/notifications/read-all', {
    method: 'POST',
    token: owner.token,
    body: { ownerId: 'client-controlled' }
  });
  assert.equal(markAll.status, 400);
  assert.deepEqual(markAll.payload, {
    error: 'Validation failed.',
    details: ['The ownerId field cannot be set.']
  });
  assert.equal((await findNotificationsByOwnerId(owner.user.id))[0].isRead, false);
});

test('mark-one-read succeeds idempotently and returns a sanitized notification', async () => {
  const owner = await registerUser();
  const notification = await addNotification(owner.user.id);

  const first = await request(`/api/notifications/${notification._id}/read`, {
    method: 'PATCH',
    token: owner.token
  });
  const second = await request(`/api/notifications/${notification._id}/read`, {
    method: 'PATCH',
    token: owner.token
  });

  assert.equal(first.status, 200);
  assert.equal(first.payload.notification.id, notification._id);
  assert.equal(first.payload.notification.isRead, true);
  assert.deepEqual(second, first);
  assert.equal(Object.hasOwn(first.payload.notification, '_id'), false);
  assert.equal(Object.hasOwn(first.payload.notification, 'ownerId'), false);
});

test('mark-all-read updates only unread notifications belonging to the caller', async () => {
  const owner = await registerUser();
  const other = await registerUser();
  const alreadyRead = await addNotification(owner.user.id);
  const unread = await addNotification(owner.user.id);
  const foreign = await addNotification(other.user.id);
  const preRead = await request(`/api/notifications/${alreadyRead._id}/read`, {
    method: 'PATCH',
    token: owner.token
  });
  assert.equal(preRead.status, 200);

  const marked = await request('/api/notifications/read-all', {
    method: 'POST',
    token: owner.token
  });
  assert.equal(marked.status, 200);
  assert.deepEqual(marked.payload, { updatedCount: 1 });
  const ownerNotifications = await findNotificationsByOwnerId(owner.user.id);
  const otherNotifications = await findNotificationsByOwnerId(other.user.id);
  assert.equal(ownerNotifications.find(({ _id }) => _id === alreadyRead._id).isRead, true);
  assert.equal(ownerNotifications.find(({ _id }) => _id === unread._id).isRead, true);
  assert.equal(otherNotifications.find(({ _id }) => _id === foreign._id).isRead, false);

  const empty = await request('/api/notifications/read-all', {
    method: 'POST',
    token: owner.token
  });
  assert.deepEqual(empty, { status: 200, payload: { updatedCount: 0 } });
});

test('database failures use the generic server error response', async () => {
  const owner = await registerUser();
  const originalFind = notificationsDatabase.find;
  const originalConsoleError = console.error;
  notificationsDatabase.find = function find(_query, callback) {
    callback(new Error('Sensitive database details.'));
  };
  console.error = () => {};

  try {
    const result = await request('/api/notifications', { token: owner.token });
    assert.equal(result.status, 500);
    assert.deepEqual(result.payload, { error: 'An unexpected server error occurred.' });
  } finally {
    notificationsDatabase.find = originalFind;
    console.error = originalConsoleError;
  }
});
