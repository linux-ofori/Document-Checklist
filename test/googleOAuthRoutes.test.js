const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const jwt = require('jsonwebtoken');
const { after, before, test } = require('node:test');

const temporaryDirectory = fs.mkdtempSync(
  path.join(os.tmpdir(), 'document-checklist-google-oauth-test-')
);
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'google-oauth-route-test-jwt-secret-123456';
process.env.GOOGLE_OAUTH_ENABLED = 'false';
process.env.GOOGLE_OAUTH_RATE_LIMIT_MAX = '20';
process.env.GOOGLE_OAUTH_RATE_LIMIT_WINDOW_MS = '900000';
process.env.DOCUMENT_CHECKLIST_USERS_DB_PATH = path.join(temporaryDirectory, 'users.db');
process.env.DOCUMENT_CHECKLIST_DOCUMENTS_DB_PATH = path.join(temporaryDirectory, 'documents.db');
process.env.DOCUMENT_CHECKLIST_APPLICATIONS_DB_PATH = path.join(temporaryDirectory, 'applications.db');
process.env.DOCUMENT_CHECKLIST_NOTIFICATIONS_DB_PATH = path.join(temporaryDirectory, 'notifications.db');
process.env.DOCUMENT_CHECKLIST_EXPIRY_REMINDERS_DB_PATH = path.join(
  temporaryDirectory,
  'expiry-reminders.db'
);
process.env.DOCUMENT_CHECKLIST_EXPIRY_REMINDER_CLEANUP_DB_PATH = path.join(
  temporaryDirectory,
  'expiry-reminder-cleanup.db'
);

const database = require('../src/config/database');
const {
  createUser,
  createGoogleUser,
  findUserByEmail,
  findUserByGoogleSubject
} = require('../src/models/userModel');
const { createAuthToken } = require('../src/services/authToken');
const { createGoogleOAuthRouter } = require('../src/routes/googleOAuthRoutes');

const config = {
  enabled: true,
  frontendCallbackUrl: 'http://localhost:5173/auth/google/callback'
};
const identity = {
  subject: 'google-subject-route-test',
  email: 'google.user@example.test',
  name: 'Google User',
  emailVerified: true
};
const temporaryDirectoryParent = path.resolve(os.tmpdir());
let server;
let baseUrl;
let localPasswordHash;
let localUser;

function createFakeService() {
  const transactions = new Map();
  const tickets = new Map();
  let ticketNumber = 0;
  let identityForNextCallback = identity;

  return {
    setIdentity(value) {
      identityForNextCallback = value;
    },
    beginAuthorization(transaction) {
      const state = crypto.randomBytes(24).toString('base64url');
      const browserBinding = crypto.randomBytes(24).toString('base64url');
      transactions.set(state, transaction);
      return {
        state,
        browserBinding,
        authorizationUrl: `https://accounts.google.test/auth?state=${state}`
      };
    },
    async consumeAuthorization({ state, browserBinding, code }) {
      const transaction = transactions.get(state);
      transactions.delete(state);
      if (!transaction || !browserBinding || code !== 'test-code') {
        throw new Error('Invalid fake authorization transaction.');
      }
      return { transaction, identity: identityForNextCallback };
    },
    issueExchangeTicket(ticket) {
      ticketNumber += 1;
      const value = `single-use-ticket-${ticketNumber}`;
      tickets.set(value, ticket);
      return value;
    },
    consumeExchangeTicket(value) {
      const ticket = tickets.get(value);
      tickets.delete(value);
      return ticket || null;
    }
  };
}

const oauthService = createFakeService();

before(async () => {
  await database.initializeUserDatabase();
  localPasswordHash = await bcrypt.hash('correct horse battery staple', 4);
  localUser = await createUser({
    name: 'Existing Local User',
    email: 'local.user@example.test',
    password: localPasswordHash
  });

  const app = express();
  app.use(express.json());
  app.use('/api/auth/google', createGoogleOAuthRouter({
    config,
    service: oauthService
  }));
  server = await new Promise((resolve) => {
    const listeningServer = app.listen(0, '127.0.0.1', () => resolve(listeningServer));
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }

  const cleanupTarget = path.resolve(temporaryDirectory);
  if (path.dirname(cleanupTarget) !== temporaryDirectoryParent
      || !path.basename(cleanupTarget).startsWith('document-checklist-google-oauth-test-')) {
    throw new Error('Refusing to remove a path outside this test\'s temporary directory.');
  }
  fs.rmSync(cleanupTarget, { recursive: true, force: true });
});

async function beginAuthorization({ intent, currentPassword, token } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const response = await fetch(`${baseUrl}/api/auth/google/authorization`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      intent,
      ...(currentPassword === undefined ? {} : { currentPassword })
    })
  });
  return { response, body: await response.json() };
}

async function finishCallback(state, cookie) {
  return fetch(
    `${baseUrl}/api/auth/google/callback?state=${encodeURIComponent(state)}&code=test-code`,
    {
      headers: { Cookie: cookie },
      redirect: 'manual'
    }
  );
}

function cookieFrom(response, state) {
  const setCookie = response.headers.get('set-cookie');
  assert.ok(setCookie);
  const name = `document_checklist_google_${state}`;
  const match = setCookie.match(new RegExp(`${name}=([^;]*)`));
  assert.ok(match);
  return `${name}=${match[1]}`;
}

test('creates a Google-only account and returns a normal backend session through ticket exchange', async () => {
  oauthService.setIdentity(identity);
  const { response: startResponse, body: startBody } = await beginAuthorization({ intent: 'login' });
  assert.equal(startResponse.status, 200);
  assert.match(startBody.authorizationUrl, /^https:\/\/accounts\.google\.test\//);

  const state = new URL(startBody.authorizationUrl).searchParams.get('state');
  const callback = await finishCallback(state, cookieFrom(startResponse, state));
  assert.equal(callback.status, 303);
  const callbackUrl = new URL(callback.headers.get('location'));
  assert.equal(callbackUrl.origin, new URL(config.frontendCallbackUrl).origin);
  const ticket = new URLSearchParams(callbackUrl.hash.slice(1)).get('ticket');
  assert.ok(ticket);

  const exchangeResponse = await fetch(`${baseUrl}/api/auth/google/exchange`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ticket })
  });
  assert.equal(exchangeResponse.status, 200);
  const session = await exchangeResponse.json();
  assert.equal(session.user.email, identity.email);
  assert.equal(Object.hasOwn(session.user, 'googleSubject'), false);

  const tokenPayload = jwt.verify(session.token, process.env.JWT_SECRET);
  assert.equal(tokenPayload.tokenVersion, 0);
  const googleUser = await findUserByGoogleSubject(identity.subject);
  assert.ok(googleUser);
  assert.equal(Object.hasOwn(googleUser, 'password'), false);
  assert.ok(googleUser.emailVerifiedAt);

  const replayResponse = await fetch(`${baseUrl}/api/auth/google/exchange`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ticket })
  });
  assert.equal(replayResponse.status, 410);
});

test('does not automatically link a Google email to an existing local account', async () => {
  oauthService.setIdentity({
    subject: 'different-google-subject',
    email: localUser.email,
    name: 'Local User'
  });
  const { response: startResponse, body } = await beginAuthorization({ intent: 'login' });
  const state = new URL(body.authorizationUrl).searchParams.get('state');
  const callback = await finishCallback(state, cookieFrom(startResponse, state));

  assert.equal(callback.status, 303);
  assert.match(callback.headers.get('location'), /#error=google_sign_in_failed$/);
  assert.equal(await findUserByGoogleSubject('different-google-subject'), null);
});

test('requires current-password confirmation for explicit linking and binds the result to the account', async () => {
  const token = createAuthToken(localUser);
  const oversizedPassword = await beginAuthorization({
    intent: 'link',
    currentPassword: `correct horse battery staple${'x'.repeat(80)}`,
    token
  });
  assert.equal(oversizedPassword.response.status, 400);

  const rejected = await beginAuthorization({
    intent: 'link',
    currentPassword: 'incorrect password',
    token
  });
  assert.equal(rejected.response.status, 401);

  oauthService.setIdentity({
    subject: 'linked-google-subject',
    email: 'a-different-verified-email@example.test',
    name: 'Linked Identity'
  });
  const { response: startResponse, body } = await beginAuthorization({
    intent: 'link',
    currentPassword: 'correct horse battery staple',
    token
  });
  assert.equal(startResponse.status, 200);
  const state = new URL(body.authorizationUrl).searchParams.get('state');
  const callback = await finishCallback(state, cookieFrom(startResponse, state));
  assert.equal(callback.status, 303);
  const ticket = new URLSearchParams(new URL(callback.headers.get('location')).hash.slice(1))
    .get('ticket');

  const exchangeResponse = await fetch(`${baseUrl}/api/auth/google/exchange`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ticket })
  });
  assert.equal(exchangeResponse.status, 200);
  assert.deepEqual(await exchangeResponse.json(), { linked: true });

  const linkedUser = await findUserByGoogleSubject('linked-google-subject');
  assert.equal(linkedUser._id, localUser._id);
  assert.equal(linkedUser.email, localUser.email);
  assert.equal(linkedUser.emailVerifiedAt, undefined);
});

test('rejects linking an identity already owned by another account', async () => {
  const existingGoogleUser = await createGoogleUser({
    name: 'Already Linked',
    email: 'already.linked@example.test',
    googleSubject: 'owned-google-subject'
  });
  await assert.rejects(createGoogleUser({
    name: 'Duplicate Identity',
    email: 'duplicate.identity@example.test',
    googleSubject: 'owned-google-subject'
  }), (error) => error.errorType === 'uniqueViolated');
  const unlinkedLocalUser = await createUser({
    name: 'Unlinked Local User',
    email: 'unlinked.local@example.test',
    password: localPasswordHash
  });
  oauthService.setIdentity({
    subject: 'owned-google-subject',
    email: 'owned-google@example.test',
    name: 'Owned Identity'
  });
  const token = createAuthToken(unlinkedLocalUser);
  const { response: startResponse, body } = await beginAuthorization({
    intent: 'link',
    currentPassword: 'correct horse battery staple',
    token
  });
  const state = new URL(body.authorizationUrl).searchParams.get('state');
  const callback = await finishCallback(state, cookieFrom(startResponse, state));

  assert.equal(callback.status, 303);
  assert.match(callback.headers.get('location'), /#error=google_sign_in_failed$/);
  assert.equal((await findUserByGoogleSubject('owned-google-subject'))._id, existingGoogleUser._id);
  assert.equal(await findUserByEmail(unlinkedLocalUser.email).then((user) => user.googleSubject), undefined);
});
