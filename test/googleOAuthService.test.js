const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { afterEach, test } = require('node:test');
const {
  createGoogleOAuthService,
  GoogleOAuthError
} = require('../src/services/googleOAuthService');

const configuration = {
  enabled: true,
  clientId: 'google-client-id',
  clientSecret: 'google-client-secret',
  redirectUri: 'https://api.example.test/api/auth/google/callback'
};
const services = [];

afterEach(() => {
  while (services.length) {
    services.pop().dispose();
  }
});

function createService({ now = () => Date.now(), payloadOverrides = {} } = {}) {
  const clientState = {};
  const client = {
    generateAuthUrl(parameters) {
      clientState.authorizationParameters = parameters;
      return `https://accounts.google.test/auth?state=${parameters.state}`;
    },
    async getToken(parameters) {
      clientState.tokenParameters = parameters;
      return { tokens: { id_token: 'verified-id-token' } };
    },
    async verifyIdToken(parameters) {
      clientState.verificationParameters = parameters;
      return {
        getPayload() {
          return {
            iss: 'https://accounts.google.com',
            sub: 'google-subject-123',
            email: 'Person@example.test',
            email_verified: true,
            name: 'Person Example',
            nonce: clientState.authorizationParameters.nonce,
            ...payloadOverrides
          };
        }
      };
    }
  };
  const service = createGoogleOAuthService({ config: configuration, client, now });
  services.push(service);
  return { service, clientState };
}

test('creates authorization transactions with state, nonce, and an S256 PKCE challenge', async () => {
  const { service, clientState } = createService();
  const flow = service.beginAuthorization({ intent: 'login' });
  const parameters = clientState.authorizationParameters;

  assert.equal(parameters.state, flow.state);
  assert.equal(parameters.nonce.length, 43);
  assert.equal(parameters.code_challenge_method, 'S256');
  assert.equal(parameters.code_challenge.length, 43);
  assert.equal(parameters.redirect_uri, configuration.redirectUri);
  assert.equal(parameters.response_type, 'code');
  assert.deepEqual(parameters.scope, ['openid', 'email', 'profile']);

  const result = await service.consumeAuthorization({
    state: flow.state,
    browserBinding: flow.browserBinding,
    code: 'authorization-code'
  });
  assert.equal(result.identity.subject, 'google-subject-123');
  assert.equal(result.identity.email, 'person@example.test');
  assert.equal(result.identity.name, 'Person Example');
  assert.equal(result.identity.emailVerified, true);
  assert.equal(clientState.tokenParameters.code, 'authorization-code');
  assert.equal(clientState.tokenParameters.codeVerifier.length, 43);
  assert.equal(clientState.verificationParameters.audience, configuration.clientId);
  assert.equal(
    parameters.code_challenge,
    crypto.createHash('sha256')
      .update(clientState.tokenParameters.codeVerifier)
      .digest('base64url')
  );
});

test('consumes authorization state once and binds it to the initiating browser', async () => {
  const { service } = createService();
  const wrongBrowserFlow = service.beginAuthorization({ intent: 'login' });
  await assert.rejects(service.consumeAuthorization({
    state: wrongBrowserFlow.state,
    browserBinding: 'different-browser',
    code: 'authorization-code'
  }), GoogleOAuthError);

  const replayFlow = service.beginAuthorization({ intent: 'login' });
  await service.consumeAuthorization({
    state: replayFlow.state,
    browserBinding: replayFlow.browserBinding,
    code: 'authorization-code'
  });
  await assert.rejects(service.consumeAuthorization({
    state: replayFlow.state,
    browserBinding: replayFlow.browserBinding,
    code: 'authorization-code'
  }), GoogleOAuthError);
});

test('rejects expired authorization transactions and link sessions', async () => {
  let currentTime = 1000;
  const { service } = createService({ now: () => currentTime });
  const flow = service.beginAuthorization({ intent: 'login' });
  currentTime += 10 * 60 * 1000;
  await assert.rejects(service.consumeAuthorization({
    state: flow.state,
    browserBinding: flow.browserBinding,
    code: 'authorization-code'
  }), GoogleOAuthError);

  const expiredLink = service.beginAuthorization({
    intent: 'link',
    userId: 'user-id',
    tokenVersion: 0,
    sessionExpiresAt: 2
  });
  currentTime = 2000;
  await assert.rejects(service.consumeAuthorization({
    state: expiredLink.state,
    browserBinding: expiredLink.browserBinding,
    code: 'authorization-code'
  }), GoogleOAuthError);
});

test('rejects unverified, nonce-mismatched, and malformed Google identities', async (context) => {
  for (const payloadOverrides of [
    { email_verified: false },
    { nonce: 'wrong-nonce' },
    { email: 'invalid-email' },
    { sub: '' }
  ]) {
    await context.test(JSON.stringify(payloadOverrides), async () => {
      const { service } = createService({ payloadOverrides });
      const flow = service.beginAuthorization({ intent: 'login' });
      await assert.rejects(service.consumeAuthorization({
        state: flow.state,
        browserBinding: flow.browserBinding,
        code: 'authorization-code'
      }), GoogleOAuthError);
    });
  }
});

test('makes exchange tickets short-lived and single-use', () => {
  let currentTime = 1000;
  const { service } = createService({ now: () => currentTime });
  const ticket = service.issueExchangeTicket({
    intent: 'login',
    userId: 'user-id',
    tokenVersion: 0,
    googleSubject: 'google-subject-123'
  });
  assert.equal(service.consumeExchangeTicket(ticket).userId, 'user-id');
  assert.equal(service.consumeExchangeTicket(ticket), null);

  const expiredTicket = service.issueExchangeTicket({
    intent: 'login',
    userId: 'user-id',
    tokenVersion: 0,
    googleSubject: 'google-subject-123'
  });
  currentTime += 60 * 1000;
  assert.equal(service.consumeExchangeTicket(expiredTicket), null);
});
