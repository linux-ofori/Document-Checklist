const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const { after, before, test } = require('node:test');

const dataDirectory = path.resolve(__dirname, '..', 'data');
const temporaryDirectory = fs.mkdtempSync(
  path.join(dataDirectory, '.test-email-verification-')
);
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'email-verification-route-test-secret-123456';
process.env.EMAIL_ENABLED = 'false';
process.env.DOCUMENT_CHECKLIST_USERS_DB_PATH = path.join(temporaryDirectory, 'users.db');
process.env.DOCUMENT_CHECKLIST_DOCUMENTS_DB_PATH = path.join(temporaryDirectory, 'documents.db');
process.env.DOCUMENT_CHECKLIST_APPLICATIONS_DB_PATH = path.join(temporaryDirectory, 'applications.db');
process.env.DOCUMENT_CHECKLIST_NOTIFICATIONS_DB_PATH = path.join(temporaryDirectory, 'notifications.db');
process.env.DOCUMENT_CHECKLIST_EXPIRY_REMINDERS_DB_PATH =
  path.join(temporaryDirectory, 'expiry-reminders.db');
process.env.DOCUMENT_CHECKLIST_EXPIRY_REMINDER_CLEANUP_DB_PATH =
  path.join(temporaryDirectory, 'expiry-reminder-cleanup.db');
process.env.DOCUMENT_CHECKLIST_UPLOADS_DIRECTORY = path.join(temporaryDirectory, 'uploads');
process.env.EMAIL_VERIFICATION_REQUEST_RATE_LIMIT_MAX = '100';
process.env.EMAIL_VERIFICATION_CONFIRM_RATE_LIMIT_MAX = '100';
process.env.REGISTRATION_RATE_LIMIT_MAX = '100';

const authRoutes = require('../src/routes/authRoutes');
const applicationRoutes = require('../src/routes/applicationRoutes');
const database = require('../src/config/database');
const {
  findUserByEmail,
  findUserById,
  issueEmailVerificationChallenge
} = require('../src/models/userModel');
const { createAuthToken } = require('../src/services/authToken');
const { createChallengeToken } = require('../src/services/challengeToken');
const FakeEmailProvider = require('../src/services/fakeEmailProvider');
const { createEmailService } = require('../src/services/emailService');
const { createEmailVerificationRouter } = require('../src/routes/emailVerificationRoutes');

const frontendVerificationUrl = 'http://localhost:5173/verify-email';
const fakeProvider = new FakeEmailProvider();
const attemptedMessages = [];
const emailService = createEmailService({
  enabled: true,
  from: 'verification@example.test',
  provider: {
    sendEmail(message, options) {
      attemptedMessages.push({ ...message });
      return fakeProvider.sendEmail(message, options);
    }
  }
});

function createApplication({ verificationService = emailService } = {}) {
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRoutes);
  app.use('/api/auth', createEmailVerificationRouter({
    emailService: verificationService,
    frontendVerificationUrl
  }));
  app.use('/api/applications', applicationRoutes);
  app.use((error, _request, response, _next) => {
    response.status(500).json({ error: error.message });
  });
  return app;
}

async function startServer(app) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  return {
    server,
    baseUrl: `http://127.0.0.1:${server.address().port}`
  };
}

async function closeServer(server) {
  await new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

async function call(baseUrl, route, { method = 'POST', token, body } = {}) {
  const headers = {};
  if (token) {
    headers.authorization = `Bearer ${token}`;
  }
  if (body !== undefined) {
    headers['content-type'] = 'application/json';
  }
  const response = await fetch(`${baseUrl}${route}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return { status: response.status, payload: await response.json() };
}

async function registerUser(baseUrl, email) {
  const result = await call(baseUrl, '/api/auth/register', {
    body: { name: 'Verification User', email, password: 'safe-test-password' }
  });
  assert.equal(result.status, 201);
  return result.payload;
}

function tokenFromAttempt(index = attemptedMessages.length - 1) {
  const match = /https?:\/\/\S+/.exec(attemptedMessages[index].text);
  assert.ok(match, 'email message should contain a verification link');
  return new URL(match[0]).searchParams.get('token');
}

function updateUser(userId, update) {
  return new Promise((resolve, reject) => {
    database.update({ _id: userId }, update, (error) => (
      error ? reject(error) : resolve()
    ));
  });
}

let server;
let baseUrl;

before(async () => {
  await database.initializeUserDatabase();
  ({ server, baseUrl } = await startServer(createApplication()));
});

after(async () => {
  if (server) {
    await closeServer(server);
  }
  const cleanupTarget = path.resolve(temporaryDirectory);
  if (path.dirname(cleanupTarget) !== dataDirectory
      || !path.basename(cleanupTarget).startsWith('.test-email-verification-')) {
    throw new Error('Refusing to remove a path outside this test\'s temporary directory.');
  }
  fs.rmSync(cleanupTarget, { recursive: true, force: true });
});

test('verification request requires authentication and cannot target another account', async () => {
  const first = await registerUser(baseUrl, 'verification-owner@example.test');
  const second = await registerUser(baseUrl, 'verification-other@example.test');

  const unauthenticated = await call(baseUrl, '/api/auth/email-verification/request');
  assert.equal(unauthenticated.status, 401);

  const targeted = await call(baseUrl, '/api/auth/email-verification/request', {
    token: first.token,
    body: { accountId: second.user.id }
  });
  assert.equal(targeted.status, 400);
  assert.equal((await findUserById(second.user.id)).emailVerificationTokenHash, undefined);
});

test('verification request sends a URL-encoded token and stores only its hash', async () => {
  const account = await registerUser(baseUrl, 'verification-link@example.test');
  const result = await call(baseUrl, '/api/auth/email-verification/request', {
    token: account.token
  });

  assert.equal(result.status, 202);
  assert.deepEqual(result.payload, {
    verified: false,
    delivered: true,
    message: 'A verification email was sent.'
  });
  const token = tokenFromAttempt();
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  const stored = await findUserById(account.user.id);
  assert.equal(stored.emailVerificationTokenHash.length, 64);
  assert.notEqual(stored.emailVerificationTokenHash, token);
  assert.equal(stored.emailVerificationEmail, stored.email);
  assert.equal(JSON.stringify(result.payload).includes(token), false);
});

test('already-verified accounts receive a safe response without a challenge or email', async () => {
  const account = await registerUser(baseUrl, 'already-verified@example.test');
  await updateUser(account.user.id, {
    $set: { emailVerifiedAt: new Date().toISOString() }
  });
  const messageCount = attemptedMessages.length;

  const result = await call(baseUrl, '/api/auth/email-verification/request', {
    token: account.token
  });

  assert.equal(result.status, 200);
  assert.equal(result.payload.verified, true);
  assert.equal(attemptedMessages.length, messageCount);
  assert.equal((await findUserById(account.user.id)).emailVerificationTokenHash, undefined);
});

test('confirmation rejects malformed, invalid, and expired tokens', async () => {
  const malformed = await call(baseUrl, '/api/auth/email-verification/confirm', {
    body: { token: 'not-a-token' }
  });
  assert.equal(malformed.status, 400);

  const invalid = await call(baseUrl, '/api/auth/email-verification/confirm', {
    body: { token: 'A'.repeat(43) }
  });
  assert.equal(invalid.status, 400);

  const account = await registerUser(baseUrl, 'expired-verification@example.test');
  const challenge = createChallengeToken();
  await issueEmailVerificationChallenge(
    account.user.id,
    challenge.tokenHash,
    Date.now() + 60 * 60 * 1000
  );
  await updateUser(account.user.id, {
    $set: { emailVerificationExpiresAt: Date.now() - 1 }
  });
  const expired = await call(baseUrl, '/api/auth/email-verification/confirm', {
    body: { token: challenge.token }
  });
  assert.equal(expired.status, 400);
  assert.equal((await findUserById(account.user.id)).emailVerifiedAt, undefined);
});

test('confirmation consumes a token once, including concurrent replay attempts', async () => {
  const account = await registerUser(baseUrl, 'single-use-verification@example.test');
  const request = await call(baseUrl, '/api/auth/email-verification/request', {
    token: account.token
  });
  assert.equal(request.status, 202);
  const token = tokenFromAttempt();

  const confirmations = await Promise.all([
    call(baseUrl, '/api/auth/email-verification/confirm', { body: { token } }),
    call(baseUrl, '/api/auth/email-verification/confirm', { body: { token } })
  ]);
  assert.deepEqual(confirmations.map((result) => result.status).sort(), [200, 400]);
  assert.ok((await findUserById(account.user.id)).emailVerifiedAt);
});

test('disabled and failed delivery never claim success and invalidate the issued challenge', async () => {
  const disabledProvider = new FakeEmailProvider();
  const disabledService = createEmailService({
    enabled: false,
    provider: disabledProvider
  });
  const disabledServer = await startServer(createApplication({
    verificationService: disabledService
  }));
  try {
    const account = await registerUser(disabledServer.baseUrl, 'disabled-email@example.test');
    const result = await call(
      disabledServer.baseUrl,
      '/api/auth/email-verification/request',
      { token: account.token }
    );
    assert.equal(result.status, 503);
    assert.equal(result.payload.delivered, undefined);
    assert.equal((await findUserById(account.user.id)).emailVerificationTokenHash, undefined);
    assert.deepEqual(disabledProvider.sentMessages, []);
  } finally {
    await closeServer(disabledServer.server);
  }

  const providerFailure = new Error('private provider detail');
  fakeProvider.failure = providerFailure;
  const failedAccount = await registerUser(baseUrl, 'failed-email@example.test');
  const attemptedMessageIndex = attemptedMessages.length;
  const failed = await call(baseUrl, '/api/auth/email-verification/request', {
    token: failedAccount.token
  });
  assert.equal(failed.status, 503);
  assert.doesNotMatch(JSON.stringify(failed.payload), /private provider detail/);
  const failedToken = tokenFromAttempt(attemptedMessageIndex);
  assert.equal((await findUserById(failedAccount.user.id)).emailVerificationTokenHash, undefined);
  assert.equal((await call(baseUrl, '/api/auth/email-verification/confirm', {
    body: { token: failedToken }
  })).status, 400);

  fakeProvider.failure = null;
  const retry = await call(baseUrl, '/api/auth/email-verification/request', {
    token: failedAccount.token
  });
  assert.equal(retry.status, 202);
  assert.notEqual(tokenFromAttempt(), failedToken);
  assert.equal((await findUserById(failedAccount.user.id)).emailVerificationTokenHash.length, 64);
});

test('a failed older delivery cannot invalidate a newer challenge', async () => {
  const user = await findUserByEmail('failed-email@example.test');
  const older = createChallengeToken();
  const newer = createChallengeToken();
  await issueEmailVerificationChallenge(user._id, older.tokenHash, Date.now() + 60 * 60 * 1000);
  await issueEmailVerificationChallenge(user._id, newer.tokenHash, Date.now() + 60 * 60 * 1000);

  const { invalidateEmailVerificationChallenge } = require('../src/models/userModel');
  await invalidateEmailVerificationChallenge(user._id, older.tokenHash);
  assert.equal((await findUserById(user._id)).emailVerificationTokenHash, newer.tokenHash);
});

test('verification remains optional for login and authenticated application access', async () => {
  const account = await registerUser(baseUrl, 'unverified-access@example.test');
  assert.equal((await findUserById(account.user.id)).emailVerifiedAt, undefined);

  const login = await call(baseUrl, '/api/auth/login', {
    body: { email: 'unverified-access@example.test', password: 'safe-test-password' }
  });
  assert.equal(login.status, 200);
  assert.equal((await call(baseUrl, '/api/applications', {
    method: 'GET',
    token: login.payload.token
  })).status, 200);
});

test('verification request and confirmation have dedicated rate limits', async () => {
  process.env.EMAIL_VERIFICATION_REQUEST_RATE_LIMIT_MAX = '1';
  process.env.EMAIL_VERIFICATION_CONFIRM_RATE_LIMIT_MAX = '1';
  const limitedServer = await startServer(createApplication({
    verificationService: createEmailService({ enabled: false })
  }));
  try {
    const firstRequest = await call(
      limitedServer.baseUrl,
      '/api/auth/email-verification/request'
    );
    assert.equal(firstRequest.status, 401);
    const limitedRequest = await call(
      limitedServer.baseUrl,
      '/api/auth/email-verification/request'
    );
    assert.equal(limitedRequest.status, 429);

    const firstConfirmation = await call(
      limitedServer.baseUrl,
      '/api/auth/email-verification/confirm',
      { body: { token: 'A'.repeat(43) } }
    );
    assert.equal(firstConfirmation.status, 400);
    const limitedConfirmation = await call(
      limitedServer.baseUrl,
      '/api/auth/email-verification/confirm',
      { body: { token: 'A'.repeat(43) } }
    );
    assert.equal(limitedConfirmation.status, 429);
  } finally {
    await closeServer(limitedServer.server);
  }
});
