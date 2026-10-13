const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const { after, before, test } = require('node:test');

const dataDirectory = path.resolve(__dirname, '..', 'data');
const temporaryDirectory = fs.mkdtempSync(path.join(dataDirectory, '.test-password-reset-'));
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'password-reset-route-test-secret-123456';
process.env.DOCUMENT_CHECKLIST_USERS_DB_PATH = path.join(temporaryDirectory, 'users.db');
process.env.DOCUMENT_CHECKLIST_DOCUMENTS_DB_PATH = path.join(temporaryDirectory, 'documents.db');
process.env.DOCUMENT_CHECKLIST_APPLICATIONS_DB_PATH = path.join(temporaryDirectory, 'applications.db');
process.env.DOCUMENT_CHECKLIST_NOTIFICATIONS_DB_PATH = path.join(temporaryDirectory, 'notifications.db');
process.env.DOCUMENT_CHECKLIST_EXPIRY_REMINDERS_DB_PATH =
  path.join(temporaryDirectory, 'expiry-reminders.db');
process.env.DOCUMENT_CHECKLIST_EXPIRY_REMINDER_CLEANUP_DB_PATH =
  path.join(temporaryDirectory, 'expiry-reminder-cleanup.db');
process.env.DOCUMENT_CHECKLIST_UPLOADS_DIRECTORY = path.join(temporaryDirectory, 'uploads');
process.env.PASSWORD_RESET_REQUEST_RATE_LIMIT_MAX = '100';
process.env.PASSWORD_RESET_CONFIRM_RATE_LIMIT_MAX = '100';
process.env.REGISTRATION_RATE_LIMIT_MAX = '100';

const authRoutes = require('../src/routes/authRoutes');
const database = require('../src/config/database');
const {
  findUserById,
  issuePasswordResetChallenge
} = require('../src/models/userModel');
const { createChallengeToken, hashChallengeToken } = require('../src/services/challengeToken');
const FakeEmailProvider = require('../src/services/fakeEmailProvider');
const { createEmailService } = require('../src/services/emailService');
const { createPasswordResetRouter } = require('../src/routes/passwordResetRoutes');

const frontendPasswordResetUrl = 'http://localhost:5173/reset-password';
const passwordResetMessage =
  'If an eligible account exists and email delivery is available, password reset instructions will be sent.';

function createApplication({
  emailService,
  createToken,
  issueChallenge,
  activateChallenge,
  invalidateChallenge,
  now = Date.now
} = {}) {
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRoutes);
  app.use('/api/auth', createPasswordResetRouter({
    emailService,
    frontendPasswordResetUrl,
    createToken,
    issueChallenge,
    activateChallenge,
    invalidateChallenge,
    now
  }));
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
  return { server, baseUrl: `http://127.0.0.1:${server.address().port}` };
}

async function closeServer(server) {
  await new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

async function call(baseUrl, route, { method = 'POST', body } = {}) {
  const response = await fetch(`${baseUrl}${route}`, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return { status: response.status, payload: await response.json() };
}

async function registerUser(baseUrl, email) {
  const result = await call(baseUrl, '/api/auth/register', {
    body: { name: 'Reset User', email, password: 'old-safe-password' }
  });
  assert.equal(result.status, 201);
  return result.payload;
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
const provider = new FakeEmailProvider();
const emailService = createEmailService({
  enabled: true,
  from: 'security@example.test',
  provider
});

before(async () => {
  await database.initializeUserDatabase();
  ({ server, baseUrl } = await startServer(createApplication({ emailService })));
});

after(async () => {
  if (server) {
    await closeServer(server);
  }
  const cleanupTarget = path.resolve(temporaryDirectory);
  if (path.dirname(cleanupTarget) !== dataDirectory
      || !path.basename(cleanupTarget).startsWith('.test-password-reset-')) {
    throw new Error('Refusing to remove a path outside this test\'s temporary directory.');
  }
  fs.rmSync(cleanupTarget, { recursive: true, force: true });
});

test('request validates the exact email body and gives a generic response for unknown and unverified accounts', async () => {
  assert.equal((await call(baseUrl, '/api/auth/password-reset/request', {
    body: { email: 'not-an-email', extra: true }
  })).status, 400);

  const unknown = await call(baseUrl, '/api/auth/password-reset/request', {
    body: { email: 'unknown-reset@example.test' }
  });
  const account = await registerUser(baseUrl, 'unverified-reset@example.test');
  const unverified = await call(baseUrl, '/api/auth/password-reset/request', {
    body: { email: ' UNVERIFIED-RESET@example.test ' }
  });

  assert.equal(unknown.status, 200);
  assert.deepEqual(unknown.payload, { message: passwordResetMessage });
  assert.deepEqual(unverified, unknown);
  assert.equal(provider.sentMessages.length, 0);
  assert.equal((await findUserById(account.user.id)).passwordResetTokenHash, undefined);
});

test('token-generation failure has the same response as an ineligible account', async () => {
  const account = await registerUser(baseUrl, 'token-generation-failure@example.test');
  await updateUser(account.user.id, { $set: { emailVerifiedAt: new Date().toISOString() } });
  const generationServer = await startServer(createApplication({
    emailService,
    createToken() {
      throw new Error('private token generation detail');
    }
  }));
  const originalConsoleError = console.error;
  const loggedMessages = [];
  console.error = (...messages) => loggedMessages.push(messages.join(' '));

  try {
    const ineligible = await call(generationServer.baseUrl, '/api/auth/password-reset/request', {
      body: { email: 'unknown-token-generation@example.test' }
    });
    const result = await call(generationServer.baseUrl, '/api/auth/password-reset/request', {
      body: { email: 'token-generation-failure@example.test' }
    });

    assert.deepEqual(result, ineligible);
    assert.deepEqual(result.payload, { message: passwordResetMessage });
    assert.equal(loggedMessages.some((message) => (
      message.includes('Password reset challenge could not be prepared.')
    )), true);
    assert.doesNotMatch(loggedMessages.join(' '), /private|token-generation-failure@example\.test/);
    assert.equal((await findUserById(account.user.id)).passwordResetTokenHash, undefined);
  } finally {
    console.error = originalConsoleError;
    await closeServer(generationServer.server);
  }
});

test('challenge-storage failure has the same response and leaves any stored challenge inactive', async () => {
  const account = await registerUser(baseUrl, 'challenge-storage-failure@example.test');
  await updateUser(account.user.id, { $set: { emailVerifiedAt: new Date().toISOString() } });
  const token = createChallengeToken();
  const storageServer = await startServer(createApplication({
    emailService,
    createToken: () => token,
    async issueChallenge(userId, tokenHash, expiresAt) {
      await issuePasswordResetChallenge(userId, tokenHash, expiresAt);
      throw new Error('private database detail');
    }
  }));
  const originalConsoleError = console.error;
  const loggedMessages = [];
  console.error = (...messages) => loggedMessages.push(messages.join(' '));

  try {
    const ineligible = await call(storageServer.baseUrl, '/api/auth/password-reset/request', {
      body: { email: 'unknown-challenge-storage@example.test' }
    });
    const result = await call(storageServer.baseUrl, '/api/auth/password-reset/request', {
      body: { email: 'challenge-storage-failure@example.test' }
    });

    assert.deepEqual(result, ineligible);
    assert.deepEqual(result.payload, { message: passwordResetMessage });
    assert.equal(loggedMessages.some((message) => (
      message.includes('Password reset challenge could not be prepared.')
    )), true);
    assert.doesNotMatch(loggedMessages.join(' '), /private|challenge-storage-failure@example\.test/);
    const stored = await findUserById(account.user.id);
    assert.equal(stored.passwordResetTokenHash, token.tokenHash);
    assert.equal(stored.passwordResetActivated, false);
    assert.equal((await call(storageServer.baseUrl, '/api/auth/password-reset/confirm', {
      body: { token: token.token, password: 'new-safe-password' }
    })).status, 400);
    assert.equal(await bcrypt.compare('old-safe-password', stored.password), true);
  } finally {
    console.error = originalConsoleError;
    await closeServer(storageServer.server);
  }
});

test('eligible account receives a token link, stores only its hash, and can consume it once', async () => {
  const account = await registerUser(baseUrl, 'verified-reset@example.test');
  await updateUser(account.user.id, { $set: { emailVerifiedAt: new Date().toISOString() } });
  const result = await call(baseUrl, '/api/auth/password-reset/request', {
    body: { email: ' VERIFIED-RESET@example.test ' }
  });

  assert.equal(result.status, 200);
  assert.deepEqual(result.payload, { message: passwordResetMessage });
  assert.equal(provider.sentMessages.length, 1);
  const message = provider.sentMessages[0];
  const linkText = /https?:\/\/\S+/.exec(message.text)?.[0];
  assert.ok(linkText);
  const link = new URL(linkText);
  assert.equal(`${link.origin}${link.pathname}`, frontendPasswordResetUrl);
  const token = link.searchParams.get('token');
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);

  const stored = await findUserById(account.user.id);
  assert.equal(stored.passwordResetTokenHash, hashChallengeToken(token));
  assert.equal(stored.passwordResetActivated, true);
  assert.equal(JSON.stringify(result.payload).includes(token), false);

  const reset = await call(baseUrl, '/api/auth/password-reset/confirm', {
    body: { token, password: 'new-safe-password' }
  });
  assert.equal(reset.status, 200);
  assert.deepEqual(reset.payload, { message: 'Password reset successfully.' });
  const updatedUser = await findUserById(account.user.id);
  assert.equal(updatedUser.passwordResetTokenHash, undefined);
  assert.equal(await bcrypt.compare('new-safe-password', updatedUser.password), true);
  assert.equal(await bcrypt.compare('old-safe-password', updatedUser.password), false);
  assert.equal((await call(baseUrl, '/api/auth/password-reset/confirm', {
    body: { token, password: 'another-safe-password' }
  })).status, 400);
});

test('expired password-reset links cannot change the password', async () => {
  const account = await registerUser(baseUrl, 'expired-reset@example.test');
  await updateUser(account.user.id, { $set: { emailVerifiedAt: new Date().toISOString() } });
  const token = createChallengeToken();
  let currentTime = Date.now();
  const expiredServer = await startServer(createApplication({
    emailService,
    createToken: () => token,
    now: () => currentTime
  }));

  try {
    const result = await call(expiredServer.baseUrl, '/api/auth/password-reset/request', {
      body: { email: 'expired-reset@example.test' }
    });
    assert.equal(result.status, 200);
    assert.match(provider.sentMessages.at(-1).text, new RegExp(token.token));

    currentTime += 30 * 60 * 1000 + 1;
    const reset = await call(expiredServer.baseUrl, '/api/auth/password-reset/confirm', {
      body: { token: token.token, password: 'new-safe-password' }
    });
    assert.equal(reset.status, 400);
    assert.equal(await bcrypt.compare('old-safe-password', (await findUserById(account.user.id)).password), true);
  } finally {
    await closeServer(expiredServer.server);
  }
});

test('a newer password-reset request invalidates the previous token', async () => {
  const account = await registerUser(baseUrl, 'rotated-reset@example.test');
  await updateUser(account.user.id, { $set: { emailVerifiedAt: new Date().toISOString() } });
  const challenges = [createChallengeToken(), createChallengeToken()];
  let challengeIndex = 0;
  const sentMessageCount = provider.sentMessages.length;
  const rotationServer = await startServer(createApplication({
    emailService,
    createToken: () => challenges[challengeIndex++]
  }));

  try {
    for (let requestIndex = 0; requestIndex < 2; requestIndex += 1) {
      assert.equal((await call(rotationServer.baseUrl, '/api/auth/password-reset/request', {
        body: { email: 'rotated-reset@example.test' }
      })).status, 200);
    }
    const firstUrl = new URL(/https?:\/\/\S+/.exec(provider.sentMessages[sentMessageCount].text)[0]);
    const secondUrl = new URL(/https?:\/\/\S+/.exec(provider.sentMessages[sentMessageCount + 1].text)[0]);
    assert.equal(firstUrl.searchParams.get('token'), challenges[0].token);
    assert.equal(secondUrl.searchParams.get('token'), challenges[1].token);
    assert.equal((await call(rotationServer.baseUrl, '/api/auth/password-reset/confirm', {
      body: { token: challenges[0].token, password: 'new-safe-password' }
    })).status, 400);
    assert.equal((await call(rotationServer.baseUrl, '/api/auth/password-reset/confirm', {
      body: { token: challenges[1].token, password: 'new-safe-password' }
    })).status, 200);
  } finally {
    await closeServer(rotationServer.server);
  }
});

test('confirm enforces exact body and password policy', async () => {
  for (const body of [
    { token: 'bad-token', password: 'long-enough-password' },
    { token: 'A'.repeat(43), password: 'short' },
    { token: 'A'.repeat(43), password: 'a'.repeat(71) + '💩' },
    { token: 'A'.repeat(43), password: 'long-enough-password', extra: true },
    { token: 'A'.repeat(43), newPassword: 'long-enough-password' }
  ]) {
    assert.equal((await call(baseUrl, '/api/auth/password-reset/confirm', { body })).status, 400);
  }
});

test('failed delivery invalidates only the challenge from that request', async () => {
  const account = await registerUser(baseUrl, 'delivery-failure-reset@example.test');
  await updateUser(account.user.id, { $set: { emailVerifiedAt: new Date().toISOString() } });
  const issued = createChallengeToken();
  const newer = createChallengeToken();
  const service = {
    enabled: true,
    async sendEmail() {
      await issuePasswordResetChallenge(
        account.user.id,
        newer.tokenHash,
        Date.now() + 15 * 60 * 1000
      );
      throw new Error('private provider detail');
    }
  };
  const failureServer = await startServer(createApplication({
    emailService: service,
    createToken: () => issued
  }));

  try {
    const ineligible = await call(failureServer.baseUrl, '/api/auth/password-reset/request', {
      body: { email: 'unknown-delivery-reset@example.test' }
    });
    const result = await call(failureServer.baseUrl, '/api/auth/password-reset/request', {
      body: { email: 'delivery-failure-reset@example.test' }
    });
    assert.equal(result.status, 200);
    assert.deepEqual(result, ineligible);
    assert.doesNotMatch(JSON.stringify(result.payload), /private provider detail/);
    assert.equal((await findUserById(account.user.id)).passwordResetTokenHash, newer.tokenHash);
  } finally {
    await closeServer(failureServer.server);
  }
});

test('a provider reporting undelivered has the same response as an ineligible account', async () => {
  const account = await registerUser(baseUrl, 'undelivered-reset@example.test');
  await updateUser(account.user.id, { $set: { emailVerifiedAt: new Date().toISOString() } });
  const token = createChallengeToken();
  const service = {
    enabled: true,
    async sendEmail() {
      return { status: 'disabled', delivered: false };
    }
  };
  const undeliveredServer = await startServer(createApplication({
    emailService: service,
    createToken: () => token
  }));

  try {
    const ineligible = await call(undeliveredServer.baseUrl, '/api/auth/password-reset/request', {
      body: { email: 'unknown-undelivered-reset@example.test' }
    });
    const result = await call(undeliveredServer.baseUrl, '/api/auth/password-reset/request', {
      body: { email: 'undelivered-reset@example.test' }
    });
    assert.equal(result.status, 200);
    assert.deepEqual(result, ineligible);
    assert.equal((await findUserById(account.user.id)).passwordResetTokenHash, undefined);
  } finally {
    await closeServer(undeliveredServer.server);
  }
});

test('challenge invalidation failure after delivery failure keeps the generic response', async () => {
  const account = await registerUser(baseUrl, 'invalidation-failure-reset@example.test');
  await updateUser(account.user.id, { $set: { emailVerifiedAt: new Date().toISOString() } });
  const token = createChallengeToken();
  const service = {
    enabled: true,
    async sendEmail() {
      throw new Error('private provider detail');
    }
  };
  const invalidationServer = await startServer(createApplication({
    emailService: service,
    createToken: () => token,
    invalidateChallenge: async () => {
      throw new Error('private database detail');
    }
  }));
  const originalConsoleError = console.error;
  const loggedMessages = [];
  console.error = (...messages) => loggedMessages.push(messages.join(' '));

  try {
    const ineligible = await call(invalidationServer.baseUrl, '/api/auth/password-reset/request', {
      body: { email: 'unknown-invalidation-reset@example.test' }
    });
    const result = await call(invalidationServer.baseUrl, '/api/auth/password-reset/request', {
      body: { email: 'invalidation-failure-reset@example.test' }
    });

    assert.deepEqual(result, ineligible);
    assert.deepEqual(result.payload, { message: passwordResetMessage });
    assert.equal(loggedMessages.some((message) => (
      message.includes('invalidation failed after email delivery failure')
    )), true);
    assert.doesNotMatch(loggedMessages.join(' '), /private|invalidation-failure-reset@example\.test/);
    const stored = await findUserById(account.user.id);
    assert.equal(stored.passwordResetTokenHash, token.tokenHash);
    assert.equal(stored.passwordResetActivated, false);
    assert.equal((await call(invalidationServer.baseUrl, '/api/auth/password-reset/confirm', {
      body: { token: token.token, password: 'new-safe-password' }
    })).status, 400);
    assert.equal(await bcrypt.compare(
      'old-safe-password',
      (await findUserById(account.user.id)).password
    ), true);
  } finally {
    console.error = originalConsoleError;
    await closeServer(invalidationServer.server);
  }
});

test('activation failure after confirmed delivery leaves the challenge unusable', async () => {
  const account = await registerUser(baseUrl, 'activation-failure-reset@example.test');
  await updateUser(account.user.id, { $set: { emailVerifiedAt: new Date().toISOString() } });
  const token = createChallengeToken();
  const service = {
    enabled: true,
    async sendEmail() {
      return { delivered: true };
    }
  };
  const activationServer = await startServer(createApplication({
    emailService: service,
    createToken: () => token,
    activateChallenge: async () => {
      throw new Error('private database detail');
    }
  }));
  const originalConsoleError = console.error;
  const loggedMessages = [];
  console.error = (...messages) => loggedMessages.push(messages.join(' '));

  try {
    const ineligible = await call(activationServer.baseUrl, '/api/auth/password-reset/request', {
      body: { email: 'unknown-activation-reset@example.test' }
    });
    const result = await call(activationServer.baseUrl, '/api/auth/password-reset/request', {
      body: { email: 'activation-failure-reset@example.test' }
    });

    assert.deepEqual(result, ineligible);
    assert.deepEqual(result.payload, { message: passwordResetMessage });
    assert.equal(loggedMessages.some((message) => (
      message.includes('activation failed after email delivery')
    )), true);
    assert.doesNotMatch(loggedMessages.join(' '), /private|activation-failure-reset@example\.test/);
    const stored = await findUserById(account.user.id);
    assert.equal(stored.passwordResetTokenHash, token.tokenHash);
    assert.equal(stored.passwordResetActivated, false);
    assert.equal((await call(activationServer.baseUrl, '/api/auth/password-reset/confirm', {
      body: { token: token.token, password: 'new-safe-password' }
    })).status, 400);
    assert.equal(await bcrypt.compare('old-safe-password', stored.password), true);
  } finally {
    console.error = originalConsoleError;
    await closeServer(activationServer.server);
  }
});

test('email-disabled service does not issue challenges or claim delivery', async () => {
  const account = await registerUser(baseUrl, 'disabled-reset@example.test');
  await updateUser(account.user.id, { $set: { emailVerifiedAt: new Date().toISOString() } });
  const disabledProvider = new FakeEmailProvider();
  const disabledServer = await startServer(createApplication({
    emailService: createEmailService({ enabled: false, provider: disabledProvider })
  }));

  try {
    const ineligible = await call(disabledServer.baseUrl, '/api/auth/password-reset/request', {
      body: { email: 'unknown-disabled-reset@example.test' }
    });
    const result = await call(disabledServer.baseUrl, '/api/auth/password-reset/request', {
      body: { email: 'disabled-reset@example.test' }
    });
    assert.equal(result.status, 503);
    assert.deepEqual(result, ineligible);
    assert.deepEqual(result.payload, {
      error: 'Password reset is temporarily unavailable. Please try again later.'
    });
    assert.equal((await findUserById(account.user.id)).passwordResetTokenHash, undefined);
    assert.deepEqual(disabledProvider.sentMessages, []);
  } finally {
    await closeServer(disabledServer.server);
  }
});

test('request and confirm have dedicated rate limits', async () => {
  process.env.PASSWORD_RESET_REQUEST_RATE_LIMIT_MAX = '1';
  process.env.PASSWORD_RESET_CONFIRM_RATE_LIMIT_MAX = '1';
  const limitedServer = await startServer(createApplication({ emailService }));
  try {
    const requestBody = { email: 'rate-limit-reset@example.test' };
    assert.equal((await call(limitedServer.baseUrl, '/api/auth/password-reset/request', {
      body: requestBody
    })).status, 200);
    assert.equal((await call(limitedServer.baseUrl, '/api/auth/password-reset/request', {
      body: requestBody
    })).status, 429);

    const confirmBody = { token: 'A'.repeat(43), password: 'long-enough-password' };
    assert.equal((await call(limitedServer.baseUrl, '/api/auth/password-reset/confirm', {
      body: confirmBody
    })).status, 400);
    assert.equal((await call(limitedServer.baseUrl, '/api/auth/password-reset/confirm', {
      body: confirmBody
    })).status, 429);
  } finally {
    await closeServer(limitedServer.server);
  }
});
