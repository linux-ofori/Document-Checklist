const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const { after, before, test } = require('node:test');

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'document-checklist-assistant-'));
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'document-checklist-assistant-test-secret';
process.env.GOOGLE_OAUTH_ENABLED = 'false';
process.env.EMAIL_ENABLED = 'false';
process.env.ASSISTANT_ENABLED = 'false';
process.env.ASSISTANT_REQUEST_RATE_LIMIT_MAX = '100';
process.env.ASSISTANT_REQUEST_RATE_LIMIT_WINDOW_MS = '900000';
process.env.ASSISTANT_REQUEST_TIMEOUT_MS = '40';
process.env.ASSISTANT_MAX_CONTEXT_BYTES = '32000';
process.env.REGISTRATION_RATE_LIMIT_MAX = '100';
process.env.DOTENV_CONFIG_PATH = path.join(temporaryDirectory, 'no-dotenv-file');
delete process.env.TRUSTED_PROXY_IPS;

for (const [variable, filename] of [
  ['DOCUMENT_CHECKLIST_USERS_DB_PATH', 'users.db'],
  ['DOCUMENT_CHECKLIST_DOCUMENTS_DB_PATH', 'documents.db'],
  ['DOCUMENT_CHECKLIST_APPLICATIONS_DB_PATH', 'applications.db'],
  ['DOCUMENT_CHECKLIST_NOTIFICATIONS_DB_PATH', 'notifications.db'],
  ['DOCUMENT_CHECKLIST_EXPIRY_REMINDERS_DB_PATH', 'expiry-reminders.db'],
  ['DOCUMENT_CHECKLIST_EXPIRY_REMINDER_CLEANUP_DB_PATH', 'expiry-reminder-cleanup.db']
]) {
  process.env[variable] = path.join(temporaryDirectory, filename);
}
process.env.DOCUMENT_CHECKLIST_UPLOADS_DIRECTORY = path.join(temporaryDirectory, 'uploads');

const disabledApp = require('../src/server');
const authRoutes = require('../src/routes/authRoutes');
const database = require('../src/config/database');
const applicationModel = require('../src/models/applicationModel');
const documentModel = require('../src/models/documentModel');
const {
  createAssistantContextAssembler,
  AssistantContextError
} = require('../src/services/assistantContext');
const { createAssistantProvider } = require('../src/services/assistantProvider');
const { createAssistantRouter } = require('../src/routes/assistantRoutes');
const { processCatalog } = require('../src/config/processCatalog');
const { loadAssistantConfig } = require('../src/config/assistant');

function createApplication(provider, overrides = {}) {
  const app = express();
  app.use(express.json({ limit: '10kb' }));
  app.use('/api/auth', authRoutes);
  app.use('/api/assistant', createAssistantRouter({
    config: {
      requestRateLimitMax: 100,
      requestRateLimitWindowMs: 15 * 60 * 1000,
      requestTimeoutMs: 40,
      maxContextBytes: 32000,
      ...overrides
    },
    provider,
    contextAssembler: require('../src/services/assistantContext').defaultAssistantContextAssembler
  }));
  app.use((error, _request, response, _next) => {
    response.status(500).json({ error: 'An unexpected server error occurred.' });
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

async function call(baseUrl, route, { method = 'POST', token, body } = {}) {
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

async function registerUser(baseUrl, email) {
  const response = await call(baseUrl, '/api/auth/register', {
    body: { name: 'Assistant Test User', email, password: 'assistant-test-password' }
  });
  assert.equal(response.status, 201);
  return response.payload;
}

let disabledServer;
let disabledBaseUrl;
let assistantServer;
let assistantBaseUrl;
let recordedCalls;

before(async () => {
  await database.initializeUserDatabase();
  ({ server: disabledServer, baseUrl: disabledBaseUrl } = await startServer(disabledApp));

  recordedCalls = [];
  const adapter = {
    async complete(input) {
      recordedCalls.push(input);
      if (input.message === 'provider rejection') {
        throw new Error('sensitive provider details');
      }
      if (input.message === 'provider timeout') {
        return new Promise((_resolve, reject) => {
          input.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        });
      }
      if (input.message === 'malformed output') {
        return { answer: 'answer', sources: [], extra: 'not allowed' };
      }
      if (input.message === 'oversized answer') {
        return { answer: 'a'.repeat(4001), sources: [] };
      }
      if (input.message === 'invented source') {
        return { answer: 'answer', sources: ['record:arbitrary-id'] };
      }
      if (input.message === 'too many sources') {
        const sourceKeys = input.context.processes.flatMap((process) =>
          process.requirements.map((requirement) => requirement.sourceKey));
        return { answer: 'answer', sources: sourceKeys.slice(0, 11) };
      }
      const sourceKey = input.context.requirements?.[0]?.sourceKey
        || input.context.processes?.[0]?.requirements?.[0]?.sourceKey;
      return {
        answer: `Answer for ${input.message}`,
        sources: sourceKey ? [sourceKey] : []
      };
    }
  };
  const provider = createAssistantProvider({ enabled: true, adapter, timeoutMs: 40 });
  ({ server: assistantServer, baseUrl: assistantBaseUrl } = await startServer(
    createApplication(provider)
  ));
});

after(async () => {
  if (assistantServer) {
    await closeServer(assistantServer);
  }
  if (disabledServer) {
    await closeServer(disabledServer);
  }

  const cleanupTarget = path.resolve(temporaryDirectory);
  if (path.dirname(cleanupTarget) !== path.resolve(os.tmpdir())
      || !path.basename(cleanupTarget).startsWith('document-checklist-assistant-')) {
    throw new Error('Refusing to remove a path outside this test\'s temporary directory.');
  }
  fs.rmSync(cleanupTarget, { recursive: true, force: true });
});

test('assistant route is authenticated and disabled deployments return a generic 503', async () => {
  assert.equal((await call(assistantBaseUrl, '/api/assistant/ask', {
    body: { message: 'Hello' }
  })).status, 401);

  const user = await registerUser(disabledBaseUrl, 'assistant-disabled@example.test');
  const unavailable = await call(disabledBaseUrl, '/api/assistant/ask', {
    token: user.token,
    body: { message: 'Hello' }
  });
  assert.equal(unavailable.status, 503);
  assert.deepEqual(unavailable.payload, { error: 'The assistant is temporarily unavailable.' });
});

test('ASSISTANT_ENABLED=true without an adapter remains unavailable and never calls the provider', async () => {
  const enabledConfig = loadAssistantConfig({ ASSISTANT_ENABLED: 'true' });
  const unconfiguredProvider = createAssistantProvider({ enabled: enabledConfig.enabled });
  let providerCallCount = 0;
  const ask = unconfiguredProvider.ask;
  unconfiguredProvider.ask = (...args) => {
    providerCallCount += 1;
    return ask(...args);
  };
  const user = await registerUser(assistantBaseUrl, 'assistant-no-adapter@example.test');
  const { server, baseUrl } = await startServer(createApplication(unconfiguredProvider));

  try {
    const response = await call(baseUrl, '/api/assistant/ask', {
      token: user.token,
      body: { message: 'Hello' }
    });
    assert.equal(response.status, 503);
    assert.deepEqual(response.payload, { error: 'The assistant is temporarily unavailable.' });
    assert.equal(unconfiguredProvider.enabled, false);
    assert.equal(providerCallCount, 0);
  } finally {
    await closeServer(server);
  }
});

test('validates exact request fields and message size before calling the provider', async () => {
  const user = await registerUser(assistantBaseUrl, 'assistant-validation@example.test');
  const invalidBodies = [
    {},
    { message: '   ' },
    { message: 'x'.repeat(2001) },
    { message: 'valid', ownerId: user.user.id },
    { message: 'valid', applicationId: null },
    { message: 'valid', applicationId: 'not-an-application-id' },
    ['valid']
  ];
  const callCount = recordedCalls.length;
  for (const body of invalidBodies) {
    assert.equal((await call(assistantBaseUrl, '/api/assistant/ask', {
      token: user.token,
      body
    })).status, 400);
  }
  assert.equal(recordedCalls.length, callCount);

  const response = await call(assistantBaseUrl, '/api/assistant/ask', {
    token: user.token,
    body: { message: '  What is required?  ' }
  });
  assert.equal(response.status, 200);
  assert.equal(recordedCalls.at(-1).message, 'What is required?');
});

test('general mode uses only the static catalog and validates returned source keys', async () => {
  const queryAttempts = [];
  const assembler = createAssistantContextAssembler({
    findApplicationById: async (...args) => queryAttempts.push(['application', ...args]),
    findDocumentById: async (...args) => queryAttempts.push(['document', ...args]),
    getDocumentApplicationIds: () => [],
    catalog: processCatalog
  });
  const assembled = await assembler.assemble('owner-a', undefined, 32000);
  assert.equal(assembled.context.mode, 'catalog');
  assert.deepEqual(queryAttempts, []);
  assert.equal(assembled.context.processes.length, Object.keys(processCatalog).length);

  const user = await registerUser(assistantBaseUrl, 'assistant-general@example.test');
  const successful = await call(assistantBaseUrl, '/api/assistant/ask', {
    token: user.token,
    body: { message: 'Explain the checklist.' }
  });
  assert.equal(successful.status, 200);
  assert.deepEqual(Object.keys(successful.payload).sort(), ['answer', 'sources']);
  assert.equal(successful.payload.sources.length, 1);
  const returnedSource = successful.payload.sources[0];
  const matchingCatalogRequirement = Object.values(processCatalog)
    .flatMap((process) => process.requirements.map((requirement) => ({
      process,
      requirement
    })))
    .find(({ process, requirement }) => (
      returnedSource.type === 'requirement'
      && returnedSource.label === `${process.name}: ${requirement.name}`
    ));
  assert.ok(matchingCatalogRequirement);
  assert.deepEqual(await call(assistantBaseUrl, '/api/assistant/ask', {
    token: user.token,
    body: { message: 'invented source' }
  }), {
    status: 502,
    payload: { error: 'The assistant returned an invalid response.' }
  });
  assert.equal((await call(assistantBaseUrl, '/api/assistant/ask', {
    token: user.token,
    body: { message: 'too many sources' }
  })).status, 502);
});

test('assistant configuration defaults off and rejects invalid environment values', () => {
  const defaults = loadAssistantConfig({});
  assert.equal(defaults.enabled, false);
  assert.equal(defaults.requestRateLimitMax, 10);
  assert.equal(defaults.requestRateLimitWindowMs, 900000);
  assert.equal(defaults.requestTimeoutMs, 10000);
  assert.equal(defaults.maxContextBytes, 32000);

  const integerSettings = [
    ['ASSISTANT_REQUEST_RATE_LIMIT_MAX', '10000'],
    ['ASSISTANT_REQUEST_RATE_LIMIT_WINDOW_MS', '86400000'],
    ['ASSISTANT_REQUEST_TIMEOUT_MS', '60000'],
    ['ASSISTANT_MAX_CONTEXT_BYTES', '100000']
  ];
  for (const [variable, maximum] of integerSettings) {
    const aboveMaximum = String(Number(maximum) + 1);
    for (const value of ['0', '-1', '1.5', '1e2', 'not-a-number', 'Infinity', aboveMaximum]) {
      const original = process.env[variable];
      try {
        process.env[variable] = value;
        assert.throws(() => loadAssistantConfig(), new RegExp(variable));
      } finally {
        if (original === undefined) {
          delete process.env[variable];
        } else {
          process.env[variable] = original;
        }
      }
    }
  }

  for (const value of ['yes', 'TRUE', '', '1']) {
    const original = process.env.ASSISTANT_ENABLED;
    try {
      process.env.ASSISTANT_ENABLED = value;
      assert.throws(() => loadAssistantConfig(), /ASSISTANT_ENABLED/);
    } finally {
      if (original === undefined) {
        delete process.env.ASSISTANT_ENABLED;
      } else {
        process.env.ASSISTANT_ENABLED = original;
      }
    }
  }
});

test('selected application context is owner-scoped, allowlisted, and bounded', async () => {
  const owner = await registerUser(assistantBaseUrl, 'assistant-owner@example.test');
  const foreign = await registerUser(assistantBaseUrl, 'assistant-foreign@example.test');
  const ownApplication = await applicationModel.createApplication({
    ownerId: owner.user.id,
    processId: 'passport',
    name: 'PRIVATE_APPLICATION_NAME',
    details: { secret: 'PRIVATE_APPLICATION_DETAILS' }
  });
  const foreignApplication = await applicationModel.createApplication({
    ownerId: foreign.user.id,
    processId: 'business-registration',
    name: 'FOREIGN_APPLICATION_NAME'
  });
  const document = await documentModel.createDocument({
    ownerId: owner.user.id,
    name: 'PRIVATE_DOCUMENT_NAME',
    completed: true,
    documentType: 'identity-card',
    applicationId: ownApplication._id,
    expiresAt: '2035-04-10',
    note: 'PRIVATE_DOCUMENT_NOTE',
    fileMetadata: {
      storageKey: 'PRIVATE_STORAGE_KEY',
      fileName: 'PRIVATE_FILE_NAME',
      fileSizeKb: 123
    }
  });
  const requirements = ownApplication.requirements.map((requirement) =>
    requirement.key === 'identity-card'
      ? { ...requirement, status: 'completed', documentId: document._id }
      : requirement
  );
  await applicationModel.updateApplicationRequirements(
    ownApplication._id,
    owner.user.id,
    requirements
  );

  const beforeApplications = await applicationModel.findApplicationById(
    ownApplication._id,
    owner.user.id
  );
  const beforeDocuments = await documentModel.findDocumentsByOwnerId(owner.user.id);
  const successful = await call(assistantBaseUrl, '/api/assistant/ask', {
    token: owner.token,
    body: { message: 'How is my checklist?', applicationId: ownApplication._id }
  });
  assert.equal(successful.status, 200);
  const providerContext = recordedCalls.at(-1).context;
  assert.equal(providerContext.application.status, 'in-progress');
  assert.equal(providerContext.process.processId, 'passport');
  assert.equal(providerContext.requirements.find((entry) => entry.key === 'identity-card').status, 'completed');
  assert.equal(providerContext.expiries.length, 1);

  const serializedContext = JSON.stringify(providerContext);
  for (const excludedValue of [
    'PRIVATE_APPLICATION_NAME',
    'PRIVATE_APPLICATION_DETAILS',
    'PRIVATE_DOCUMENT_NAME',
    'PRIVATE_DOCUMENT_NOTE',
    'PRIVATE_STORAGE_KEY',
    'PRIVATE_FILE_NAME',
    '123'
  ]) {
    assert.equal(serializedContext.includes(excludedValue), false);
  }

  const callsBeforeNotFoundRequests = recordedCalls.length;
  const foreignResponse = await call(assistantBaseUrl, '/api/assistant/ask', {
    token: owner.token,
    body: { message: 'Read it', applicationId: foreignApplication._id }
  });
  const nonexistentResponse = await call(assistantBaseUrl, '/api/assistant/ask', {
    token: owner.token,
    body: {
      message: 'Read it',
      applicationId: 'app-00000000-0000-0000-0000-000000000000'
    }
  });
  assert.deepEqual(foreignResponse, { status: 404, payload: { error: 'Application not found.' } });
  assert.deepEqual(nonexistentResponse, foreignResponse);
  assert.equal(recordedCalls.length, callsBeforeNotFoundRequests);

  const afterApplications = await applicationModel.findApplicationById(
    ownApplication._id,
    owner.user.id
  );
  const afterDocuments = await documentModel.findDocumentsByOwnerId(owner.user.id);
  assert.deepEqual(afterApplications, beforeApplications);
  assert.deepEqual(afterDocuments, beforeDocuments);
});

test('context assembly rejects oversized context without exposing extra stored fields', async () => {
  const assembler = createAssistantContextAssembler({
    catalog: {
      sample: {
        id: 'sample',
        name: 'Sample',
        authority: 'Sample Authority',
        requirements: [{
          key: 'sample',
          name: 'Sample requirement',
          type: 'sample',
          description: 'x'.repeat(200),
          guidance: 'y'.repeat(200),
          isRequired: true,
          privateField: 'not-in-context'
        }]
      }
    }
  });
  await assert.rejects(
    assembler.assemble('owner-a', undefined, 100),
    (error) => error instanceof AssistantContextError && error.code === 'too-large'
  );
});

test('normalizes provider timeout, rejection, malformed output, and answer limits', async () => {
  const user = await registerUser(assistantBaseUrl, 'assistant-errors@example.test');
  for (const [message, status, errorText] of [
    ['provider timeout', 504, 'The assistant request timed out. Please try again.'],
    ['provider rejection', 503, 'The assistant is temporarily unavailable.'],
    ['malformed output', 502, 'The assistant returned an invalid response.'],
    ['oversized answer', 502, 'The assistant returned an invalid response.']
  ]) {
    const response = await call(assistantBaseUrl, '/api/assistant/ask', {
      token: user.token,
      body: { message }
    });
    assert.equal(response.status, status);
    assert.deepEqual(response.payload, { error: errorText });
  }
});

test('per-user rate limits reject excess calls without blocking another user', async () => {
  const user = await registerUser(assistantBaseUrl, 'assistant-rate-limited@example.test');
  const otherUser = await registerUser(assistantBaseUrl, 'assistant-rate-other@example.test');
  const limitedApp = createApplication(
    createAssistantProvider({
      enabled: true,
      adapter: {
        async complete() {
          return { answer: 'Read-only answer', sources: [] };
        }
      },
      timeoutMs: 40
    }),
    { requestRateLimitMax: 1 }
  );
  const { server, baseUrl } = await startServer(limitedApp);
  try {
    assert.equal((await call(baseUrl, '/api/assistant/ask', {
      token: user.token,
      body: { message: 'First request' }
    })).status, 200);
    assert.equal((await call(baseUrl, '/api/assistant/ask', {
      token: user.token,
      body: { message: 'Second request' }
    })).status, 429);
    assert.equal((await call(baseUrl, '/api/assistant/ask', {
      token: otherUser.token,
      body: { message: 'Separate user' }
    })).status, 200);
  } finally {
    await closeServer(server);
  }
});
