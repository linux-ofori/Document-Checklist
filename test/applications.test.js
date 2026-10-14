const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { after, before, test } = require('node:test');

const dataDirectory = path.resolve(__dirname, '..', 'data');
const testDataDirectory = fs.mkdtempSync(path.join(dataDirectory, '.test-applications-'));
process.env.JWT_SECRET = 'document-checklist-application-test-secret';
process.env.NODE_ENV = 'test';
process.env.GOOGLE_OAUTH_ENABLED = 'false';
process.env.GOOGLE_OAUTH_RATE_LIMIT_MAX = '20';
process.env.GOOGLE_OAUTH_RATE_LIMIT_WINDOW_MS = '900000';
delete process.env.TRUSTED_PROXY_IPS;
process.env.DOCUMENT_CHECKLIST_USERS_DB_PATH = path.join(testDataDirectory, 'users.db');
process.env.DOCUMENT_CHECKLIST_DOCUMENTS_DB_PATH = path.join(testDataDirectory, 'documents.db');
process.env.DOCUMENT_CHECKLIST_APPLICATIONS_DB_PATH = path.join(testDataDirectory, 'applications.db');
process.env.DOCUMENT_CHECKLIST_NOTIFICATIONS_DB_PATH = path.join(testDataDirectory, 'notifications.db');
process.env.REGISTRATION_RATE_LIMIT_MAX = '50';

const app = require('../src/server');
const applicationsDatabase = require('../src/config/applicationsDatabase');
const usersDatabase = require('../src/config/database');
const notificationsDatabase = require('../src/config/notificationsDatabase');
const { findNotificationsByOwnerId } = require('../src/models/notificationModel');
const { findApplicationById } = require('../src/models/applicationModel');
const { findDocumentsByOwnerId } = require('../src/models/documentModel');
const { findUserById } = require('../src/models/userModel');
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
  if (path.dirname(cleanupTarget) !== dataDirectory
      || !path.basename(cleanupTarget).startsWith('.test-applications-')) {
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

async function registerUser(name, email) {
  const response = await request('/api/auth/register', {
    method: 'POST',
    body: { name, email, password: 'application-test-password' }
  });
  assert.equal(response.status, 201);
  return response.payload;
}

function insertApplication(application) {
  return new Promise((resolve, reject) => {
    applicationsDatabase.insert(application, (error, inserted) => error ? reject(error) : resolve(inserted));
  });
}

function updateApplicationRecord(id, update) {
  return new Promise((resolve, reject) => {
    applicationsDatabase.update({ _id: id }, update, {}, (error, count) =>
      error ? reject(error) : resolve(count));
  });
}

function updateUserRecord(id, update) {
  return new Promise((resolve, reject) => {
    usersDatabase.update({ _id: id }, update, {}, (error, count) =>
      error ? reject(error) : resolve(count));
  });
}

test('application endpoints require authentication', async () => {
  for (const [route, options] of [
    ['/api/applications', { method: 'GET' }],
    ['/api/applications', { method: 'POST', body: { processId: 'passport' } }],
    ['/api/applications/app-not-real', { method: 'GET' }],
    ['/api/applications/app-not-real/requirements/identity-card', {
      method: 'PATCH',
      body: { status: 'completed' }
    }],
    ['/api/applications/app-not-real/submit', { method: 'POST' }],
    ['/api/applications/app-not-real/decision', {
      method: 'PATCH',
      body: { outcome: 'accepted' }
    }]
  ]) {
    assert.equal((await request(route, options)).status, 401);
  }
});

async function completeRequiredRequirements(user, application) {
  let updated = application;
  for (const requirement of application.requirements.filter((entry) => entry.isRequired)) {
    const response = await request(
      `/api/applications/${application.id}/requirements/${requirement.key}`,
      { method: 'PATCH', token: user.token, body: { status: 'completed' } }
    );
    assert.equal(response.status, 200);
    updated = response.payload.application;
  }
  return updated;
}

test('submits only when required checklist items are complete and preserves submitted status', async () => {
  const user = await registerUser('Submission Owner', 'submission-owner@example.com');
  const created = await request('/api/applications', {
    method: 'POST',
    token: user.token,
    body: { processId: 'passport', readyToSubmit: true, outcome: 'accepted' }
  });
  assert.equal(created.status, 400);

  const application = (await request('/api/applications', {
    method: 'POST',
    token: user.token,
    body: { processId: 'passport' }
  })).payload.application;
  assert.equal(application.status, 'in-progress');
  assert.equal(application.outcome, null);
  assert.equal(application.readyToSubmit, false);

  const forgedSubmission = await request(`/api/applications/${application.id}/submit`, {
    method: 'POST',
    token: user.token,
    body: { readyToSubmit: true, status: 'submitted', outcome: 'accepted' }
  });
  assert.equal(forgedSubmission.status, 400);

  const incomplete = await request(`/api/applications/${application.id}/submit`, {
    method: 'POST',
    token: user.token
  });
  assert.equal(incomplete.status, 409);
  assert.equal(incomplete.payload.error, 'Required checklist items must be completed before submission.');
  assert.equal(incomplete.payload.details.length, 6);
  assert.equal((await request(`/api/applications/${application.id}`, {
    token: user.token
  })).payload.application.status, 'in-progress');

  const completed = await completeRequiredRequirements(user, application);
  assert.equal(completed.status, 'in-progress');
  assert.equal(completed.readyToSubmit, true);
  assert.equal(
    completed.requirements.find((requirement) => requirement.key === 'fee-receipt').status,
    'missing'
  );
  for (const requirement of completed.requirements.filter((entry) => entry.isRequired)) {
    assert.equal(requirement.documentId, null);
  }

  const persistedBeforeSubmit = await findApplicationById(application.id, user.user.id);
  assert.equal(Object.hasOwn(persistedBeforeSubmit, 'readyToSubmit'), false);

  const submitted = await request(`/api/applications/${application.id}/submit`, {
    method: 'POST',
    token: user.token
  });
  assert.equal(submitted.status, 200);
  assert.equal(submitted.payload.application.status, 'submitted');
  assert.equal(submitted.payload.application.outcome, 'pending');
  assert.ok(Number.isFinite(Date.parse(submitted.payload.application.submittedAt)));
  assert.equal(submitted.payload.application.readyToSubmit, true);
  const submittedAt = submitted.payload.application.submittedAt;

  const repeated = await request(`/api/applications/${application.id}/submit`, {
    method: 'POST',
    token: user.token
  });
  assert.equal(repeated.status, 200);
  assert.equal(repeated.payload.application.submittedAt, submittedAt);

  const edited = await request(
    `/api/applications/${application.id}/requirements/identity-card`,
    { method: 'PATCH', token: user.token, body: { status: 'missing' } }
  );
  assert.equal(edited.status, 200);
  assert.equal(edited.payload.application.status, 'submitted');
  assert.equal(edited.payload.application.outcome, 'pending');
  assert.equal(edited.payload.application.readyToSubmit, false);
});

test('records and corrects institution outcomes only after submission', async () => {
  const user = await registerUser('Decision Owner', 'decision-owner@example.com');
  const other = await registerUser('Decision Other', 'decision-other@example.com');
  const application = (await request('/api/applications', {
    method: 'POST',
    token: user.token,
    body: { processId: 'passport' }
  })).payload.application;

  const premature = await request(`/api/applications/${application.id}/decision`, {
    method: 'PATCH',
    token: user.token,
    body: { outcome: 'accepted' }
  });
  assert.equal(premature.status, 409);

  const clientLifecycleFields = await request(`/api/applications/${application.id}/decision`, {
    method: 'PATCH',
    token: user.token,
    body: { outcome: 'accepted', status: 'completed' }
  });
  assert.equal(clientLifecycleFields.status, 400);

  const invalidOutcome = await request(`/api/applications/${application.id}/decision`, {
    method: 'PATCH',
    token: user.token,
    body: { outcome: 'withdrawn' }
  });
  assert.equal(invalidOutcome.status, 400);

  const otherSubmission = await request(`/api/applications/${application.id}/submit`, {
    method: 'POST',
    token: other.token
  });
  assert.equal(otherSubmission.status, 404);
  const otherDecision = await request(`/api/applications/${application.id}/decision`, {
    method: 'PATCH',
    token: other.token,
    body: { outcome: 'accepted' }
  });
  assert.equal(otherDecision.status, 404);
  assert.equal(
    (await request(`/api/applications/${application.id}`, { token: user.token }))
      .payload.application.status,
    'in-progress'
  );

  await completeRequiredRequirements(user, application);
  const submitted = await request(`/api/applications/${application.id}/submit`, {
    method: 'POST',
    token: user.token
  });
  assert.equal(submitted.status, 200);

  const pending = await request(`/api/applications/${application.id}/decision`, {
    method: 'PATCH',
    token: user.token,
    body: { outcome: 'pending' }
  });
  assert.equal(pending.status, 200);
  assert.equal(pending.payload.application.status, 'submitted');
  assert.equal(pending.payload.application.outcome, 'pending');
  assert.equal(pending.payload.application.decisionRecordedAt, null);

  const accepted = await request(`/api/applications/${application.id}/decision`, {
    method: 'PATCH',
    token: user.token,
    body: { outcome: 'accepted' }
  });
  assert.equal(accepted.status, 200);
  assert.equal(accepted.payload.application.status, 'completed');
  assert.equal(accepted.payload.application.outcome, 'accepted');
  assert.ok(Number.isFinite(Date.parse(accepted.payload.application.decisionRecordedAt)));
  const decisionRecordedAt = accepted.payload.application.decisionRecordedAt;

  const repeatedAccepted = await request(`/api/applications/${application.id}/decision`, {
    method: 'PATCH',
    token: user.token,
    body: { outcome: 'accepted' }
  });
  assert.equal(repeatedAccepted.status, 200);
  assert.equal(repeatedAccepted.payload.application.status, 'completed');
  assert.equal(repeatedAccepted.payload.application.outcome, 'accepted');
  assert.equal(repeatedAccepted.payload.application.decisionRecordedAt, decisionRecordedAt);

  const checklistEditAfterDecision = await request(
    `/api/applications/${application.id}/requirements/identity-card`,
    { method: 'PATCH', token: user.token, body: { status: 'missing' } }
  );
  assert.equal(checklistEditAfterDecision.status, 200);
  assert.equal(checklistEditAfterDecision.payload.application.status, 'completed');
  assert.equal(checklistEditAfterDecision.payload.application.outcome, 'accepted');

  const rejected = await request(`/api/applications/${application.id}/decision`, {
    method: 'PATCH',
    token: user.token,
    body: { outcome: 'rejected' }
  });
  assert.equal(rejected.status, 200);
  assert.equal(rejected.payload.application.status, 'completed');
  assert.equal(rejected.payload.application.outcome, 'rejected');

  const pendingAgain = await request(`/api/applications/${application.id}/decision`, {
    method: 'PATCH',
    token: user.token,
    body: { outcome: 'pending' }
  });
  assert.equal(pendingAgain.status, 200);
  assert.equal(pendingAgain.payload.application.status, 'submitted');
  assert.equal(pendingAgain.payload.application.outcome, 'pending');
  assert.equal(pendingAgain.payload.application.decisionRecordedAt, null);

  const completedAgain = await request(`/api/applications/${application.id}/decision`, {
    method: 'PATCH',
    token: user.token,
    body: { outcome: 'accepted' }
  });
  assert.equal(completedAgain.status, 200);
  assert.equal(completedAgain.payload.application.status, 'completed');
  assert.equal(completedAgain.payload.application.outcome, 'accepted');
});

test('creates applications from static process templates and rejects client-controlled fields', async () => {
  const user = await registerUser('Application Owner', 'application-owner@example.com');
  const created = await request('/api/applications', {
    method: 'POST',
    token: user.token,
    body: {
      processId: 'passport',
      details: { fullName: 'Application Owner', notes: 'Initial detail values' }
    }
  });

  assert.equal(created.status, 201);
  const application = created.payload.application;
  assert.match(application.id, /^app-[a-f0-9-]{36}$/);
  assert.equal(application.processId, 'passport');
  assert.equal(application.name, 'Passport Application');
  assert.match(application.reference, /^REF-\d{4}-[A-F0-9]{16}$/);
  assert.equal(application.status, 'in-progress');
  assert.equal(application.dueDate, null);
  assert.equal(application.authority, 'Ghana Immigration Service');
  assert.equal(application.details.fullName, 'Application Owner');
  assert.equal(application.requirements.length, 7);
  assert.deepEqual(application.requirements[0], {
    key: 'identity-card',
    name: 'Ghana Card',
    type: 'identity-card',
    description: 'Clear scan of the front and back of your Ghana Card.',
    guidance: 'All four corners must be visible and the card must not be damaged or faded.',
    isRequired: true,
    status: 'missing',
    documentId: null,
    completedAt: null
  });
  assert.equal(Object.hasOwn(application, 'ownerId'), false);
  assert.deepEqual(Object.keys(application.requirements[0]).sort(), [
    'completedAt', 'description', 'documentId', 'guidance', 'isRequired', 'key', 'name', 'status', 'type'
  ]);

  const named = await request('/api/applications', {
    method: 'POST',
    token: user.token,
    body: { processId: 'university-application', name: 'Custom University Application' }
  });
  assert.equal(named.status, 201);
  assert.equal(named.payload.application.name, 'Custom University Application');
  assert.equal(named.payload.application.authority, 'University admissions offices');
  assert.equal(named.payload.application.requirements.length, 8);
  assert.equal(named.payload.application.requirements[5].key, 'reference-letter-1');
  assert.equal(named.payload.application.requirements[6].key, 'reference-letter-2');
  assert.equal(named.payload.application.requirements[5].type, named.payload.application.requirements[6].type);

  for (const body of [
    { processId: 'not-a-process' },
    { processId: 'passport', id: 'app-client-controlled' },
    { processId: 'passport', ownerId: user.user.id },
    { processId: 'passport', reference: 'CLIENT-REF' },
    { processId: 'passport', createdAt: '2026-01-01T00:00:00.000Z' },
    { processId: 'passport', updatedAt: '2026-01-01T00:00:00.000Z' },
    { processId: 'passport', requirements: [] },
    { processId: 'passport', details: [] },
    { processId: 'passport', details: { ownerId: 'another-user' } }
  ]) {
    const invalid = await request('/api/applications', {
      method: 'POST',
      token: user.token,
      body
    });
    assert.equal(invalid.status, 400);
    assert.equal(invalid.payload.error, 'Validation failed.');
  }
});

test('lists and retrieves only owned applications with privacy-preserving not-found behavior', async () => {
  const owner = await registerUser('Application List Owner', 'application-list-owner@example.com');
  const other = await registerUser('Application Other Owner', 'application-list-other@example.com');
  const owned = await request('/api/applications', {
    method: 'POST',
    token: owner.token,
    body: { processId: 'national-id' }
  });
  const foreign = await request('/api/applications', {
    method: 'POST',
    token: other.token,
    body: { processId: 'passport' }
  });
  const ownId = owned.payload.application.id;
  const foreignId = foreign.payload.application.id;

  const listed = await request('/api/applications', { token: owner.token });
  assert.equal(listed.status, 200);
  assert.deepEqual(listed.payload.applications.map((entry) => entry.id), [ownId]);
  assert.equal(Object.hasOwn(listed.payload.applications[0], 'ownerId'), false);

  const retrieved = await request(`/api/applications/${ownId}`, { token: owner.token });
  assert.equal(retrieved.status, 200);
  assert.equal(retrieved.payload.application.id, ownId);

  const missing = await request('/api/applications/app-00000000-0000-4000-8000-000000000000', {
    token: owner.token
  });
  const notOwned = await request(`/api/applications/${foreignId}`, { token: owner.token });
  assert.equal(missing.status, 404);
  assert.deepEqual(notOwned, missing);
  assert.equal((await request('/api/applications/not-an-app-id', { token: owner.token })).status, 400);
});

test('updates requirement state and enforces same-owner, same-application document links', async () => {
  const user = await registerUser('Requirement Owner', 'requirement-owner@example.com');
  const other = await registerUser('Requirement Other', 'requirement-other@example.com');
  const application = (await request('/api/applications', {
    method: 'POST',
    token: user.token,
    body: { processId: 'passport' }
  })).payload.application;
  const secondApplication = (await request('/api/applications', {
    method: 'POST',
    token: user.token,
    body: { processId: 'business-registration' }
  })).payload.application;
  const otherApplication = (await request('/api/applications', {
    method: 'POST',
    token: other.token,
    body: { processId: 'passport' }
  })).payload.application;

  const createDocument = (token, applicationId, name, documentType = 'identity-card') => request('/api/documents', {
    method: 'POST',
    token,
    body: { name, applicationId, documentType }
  });
  const linkedDocument = await createDocument(user.token, application.id, 'Owned passport ID');
  const secondApplicationDocument = await createDocument(user.token, secondApplication.id, 'Business ID');
  const otherDocument = await createDocument(other.token, otherApplication.id, 'Foreign passport ID');
  assert.equal(linkedDocument.status, 201);
  assert.equal(secondApplicationDocument.status, 201);
  assert.equal(otherDocument.status, 201);

  const wrongTypeDocument = await createDocument(
    user.token,
    application.id,
    'Wrong type passport document',
    'other'
  );
  assert.equal(wrongTypeDocument.status, 201);
  const wrongTypeLink = await request(
    `/api/applications/${application.id}/requirements/identity-card`,
    {
      method: 'PATCH',
      token: user.token,
      body: { status: 'completed', documentId: wrongTypeDocument.payload.document.id }
    }
  );
  assert.equal(wrongTypeLink.status, 400);
  assert.deepEqual(wrongTypeLink.payload, {
    error: 'Validation failed.',
    details: ['Document type must match the requirement type.']
  });

  const completed = await request(
    `/api/applications/${application.id}/requirements/identity-card`,
    {
      method: 'PATCH',
      token: user.token,
      body: { status: 'completed', documentId: linkedDocument.payload.document.id }
    }
  );
  assert.equal(completed.status, 200);
  let requirement = completed.payload.application.requirements.find((entry) => entry.key === 'identity-card');
  assert.equal(requirement.status, 'completed');
  assert.equal(requirement.documentId, linkedDocument.payload.document.id);
  assert.ok(Number.isFinite(Date.parse(requirement.completedAt)));

  for (const updates of [
    { documentType: 'other' },
    { applicationId: secondApplication.id },
    { applicationId: null }
  ]) {
    const invalidUpdate = await request(
      `/api/documents/${linkedDocument.payload.document.id}`,
      { method: 'PUT', token: user.token, body: updates }
    );
    assert.equal(invalidUpdate.status, 400);
    assert.deepEqual(invalidUpdate.payload, {
      error: 'Validation failed.',
      details: [
        'Document type and application cannot be changed while the document is linked to a requirement.'
      ]
    });
  }

  const retainedCompletedAt = requirement.completedAt;
  const completedAgain = await request(
    `/api/applications/${application.id}/requirements/identity-card`,
    { method: 'PATCH', token: user.token, body: { status: 'completed' } }
  );
  requirement = completedAgain.payload.application.requirements.find((entry) => entry.key === 'identity-card');
  assert.equal(requirement.completedAt, retainedCompletedAt);
  assert.equal(requirement.documentId, linkedDocument.payload.document.id);

  const inProgress = await request(
    `/api/applications/${application.id}/requirements/identity-card`,
    { method: 'PATCH', token: user.token, body: { status: 'in-progress' } }
  );
  requirement = inProgress.payload.application.requirements.find((entry) => entry.key === 'identity-card');
  assert.equal(requirement.completedAt, null);
  assert.equal(requirement.documentId, linkedDocument.payload.document.id);

  const missing = await request(
    `/api/applications/${application.id}/requirements/identity-card`,
    {
      method: 'PATCH',
      token: user.token,
      body: { status: 'missing', documentId: null }
    }
  );
  requirement = missing.payload.application.requirements.find((entry) => entry.key === 'identity-card');
  assert.equal(requirement.status, 'missing');
  assert.equal(requirement.completedAt, null);
  assert.equal(requirement.documentId, null);

  const invalidStatus = await request(
    `/api/applications/${application.id}/requirements/identity-card`,
    { method: 'PATCH', token: user.token, body: { status: 'pending' } }
  );
  assert.equal(invalidStatus.status, 400);
  assert.equal((await request(
    `/api/applications/${application.id}/requirements/not-a-requirement`,
    { method: 'PATCH', token: user.token, body: { status: 'completed' } }
  )).status, 404);
  assert.equal((await request(
    `/api/applications/${application.id}/requirements/identity-card`,
    { method: 'PATCH', token: user.token, body: { status: 'completed', completedAt: 'client-time' } }
  )).status, 400);

  const secondAppLink = await request(
    `/api/applications/${application.id}/requirements/identity-card`,
    {
      method: 'PATCH',
      token: user.token,
      body: { status: 'completed', documentId: secondApplicationDocument.payload.document.id }
    }
  );
  assert.equal(secondAppLink.status, 400);
  const foreignLink = await request(
    `/api/applications/${application.id}/requirements/identity-card`,
    {
      method: 'PATCH',
      token: user.token,
      body: { status: 'completed', documentId: otherDocument.payload.document.id }
    }
  );
  assert.equal(foreignLink.status, 404);
  assert.deepEqual(foreignLink.payload, { error: 'Document not found.' });
  assert.equal((await request(
    `/api/applications/${otherApplication.id}/requirements/identity-card`,
    { method: 'PATCH', token: user.token, body: { status: 'completed' } }
  )).status, 404);
});

test('persists template requirements missing from legacy application state', async () => {
  const user = await registerUser('Incomplete Checklist Owner', 'incomplete-checklist@example.com');
  const missingKeyApplication = (await request('/api/applications', {
    method: 'POST',
    token: user.token,
    body: { processId: 'passport' }
  })).payload.application;
  const absentArrayApplication = (await request('/api/applications', {
    method: 'POST',
    token: user.token,
    body: { processId: 'passport' }
  })).payload.application;
  const nonArrayRequirementsApplication = (await request('/api/applications', {
    method: 'POST',
    token: user.token,
    body: { processId: 'passport' }
  })).payload.application;

  const missingKeyDocument = await request('/api/documents', {
    method: 'POST',
    token: user.token,
    body: {
      name: 'Document for omitted checklist key',
      applicationId: missingKeyApplication.id,
      documentType: 'identity-card'
    }
  });
  const absentArrayDocument = await request('/api/documents', {
    method: 'POST',
    token: user.token,
    body: {
      name: 'Document for absent checklist array',
      applicationId: absentArrayApplication.id,
      documentType: 'identity-card'
    }
  });
  assert.equal(missingKeyDocument.status, 201);
  assert.equal(absentArrayDocument.status, 201);

  const storedMissingKeyApplication = await findApplicationById(missingKeyApplication.id, user.user.id);
  await updateApplicationRecord(missingKeyApplication.id, {
    $set: {
      requirements: storedMissingKeyApplication.requirements
        .filter((requirement) => requirement.key !== 'identity-card')
    }
  });

  const completed = await request(
    `/api/applications/${missingKeyApplication.id}/requirements/identity-card`,
    {
      method: 'PATCH',
      token: user.token,
      body: { status: 'completed', documentId: missingKeyDocument.payload.document.id }
    }
  );
  assert.equal(completed.status, 200);
  const returnedCompletedRequirement = completed.payload.application.requirements
    .find((requirement) => requirement.key === 'identity-card');
  assert.equal(returnedCompletedRequirement.status, 'completed');
  assert.equal(returnedCompletedRequirement.documentId, missingKeyDocument.payload.document.id);
  assert.ok(Number.isFinite(Date.parse(returnedCompletedRequirement.completedAt)));

  const persistedCompletedApplication = await findApplicationById(missingKeyApplication.id, user.user.id);
  const persistedCompletedRequirements = persistedCompletedApplication.requirements
    .filter((requirement) => requirement.key === 'identity-card');
  assert.equal(persistedCompletedRequirements.length, 1);
  assert.deepEqual(persistedCompletedRequirements[0], {
    key: 'identity-card',
    status: 'completed',
    documentId: missingKeyDocument.payload.document.id,
    completedAt: returnedCompletedRequirement.completedAt
  });

  const repeatedCompletion = await request(
    `/api/applications/${missingKeyApplication.id}/requirements/identity-card`,
    {
      method: 'PATCH',
      token: user.token,
      body: { status: 'completed', documentId: missingKeyDocument.payload.document.id }
    }
  );
  assert.equal(Object.hasOwn(repeatedCompletion.payload, 'notification'), false);
  assert.equal((await findNotificationsByOwnerId(user.user.id)).length, 1);

  await updateApplicationRecord(absentArrayApplication.id, { $unset: { requirements: true } });
  const inProgress = await request(
    `/api/applications/${absentArrayApplication.id}/requirements/identity-card`,
    {
      method: 'PATCH',
      token: user.token,
      body: { status: 'in-progress', documentId: absentArrayDocument.payload.document.id }
    }
  );
  assert.equal(inProgress.status, 200);
  const returnedInProgressRequirement = inProgress.payload.application.requirements
    .find((requirement) => requirement.key === 'identity-card');
  assert.equal(returnedInProgressRequirement.status, 'in-progress');
  assert.equal(returnedInProgressRequirement.documentId, absentArrayDocument.payload.document.id);
  assert.equal(returnedInProgressRequirement.completedAt, null);

  const persistedInProgressApplication = await findApplicationById(absentArrayApplication.id, user.user.id);
  assert.deepEqual(persistedInProgressApplication.requirements, [{
    key: 'identity-card',
    status: 'in-progress',
    documentId: absentArrayDocument.payload.document.id,
    completedAt: null
  }]);

  await updateApplicationRecord(nonArrayRequirementsApplication.id, {
    $set: { requirements: { legacyState: true } }
  });
  const missing = await request(
    `/api/applications/${nonArrayRequirementsApplication.id}/requirements/identity-card`,
    {
      method: 'PATCH',
      token: user.token,
      body: { status: 'missing' }
    }
  );
  assert.equal(missing.status, 200);
  const returnedMissingRequirement = missing.payload.application.requirements
    .find((requirement) => requirement.key === 'identity-card');
  assert.equal(returnedMissingRequirement.status, 'missing');
  assert.equal(returnedMissingRequirement.documentId, null);
  assert.equal(returnedMissingRequirement.completedAt, null);

  const persistedMissingApplication = await findApplicationById(
    nonArrayRequirementsApplication.id,
    user.user.id
  );
  assert.deepEqual(persistedMissingApplication.requirements, [{
    key: 'identity-card',
    status: 'missing',
    documentId: null,
    completedAt: null
  }]);
});

test('validates document application ownership on create and update', async () => {
  const owner = await registerUser('Relationship Owner', 'relationship-owner@example.com');
  const other = await registerUser('Relationship Other', 'relationship-other@example.com');
  const ownedApplication = (await request('/api/applications', {
    method: 'POST',
    token: owner.token,
    body: { processId: 'passport' }
  })).payload.application;
  const foreignApplication = (await request('/api/applications', {
    method: 'POST',
    token: other.token,
    body: { processId: 'passport' }
  })).payload.application;

  const linked = await request('/api/documents', {
    method: 'POST',
    token: owner.token,
    body: { name: 'Linked', applicationId: ownedApplication.id }
  });
  assert.equal(linked.status, 201);

  const invalidCreate = await request('/api/documents', {
    method: 'POST',
    token: owner.token,
    body: { name: 'Foreign link', applicationId: foreignApplication.id }
  });
  assert.equal(invalidCreate.status, 404);
  assert.deepEqual(invalidCreate.payload, { error: 'Application not found.' });

  const document = await request('/api/documents', {
    method: 'POST',
    token: owner.token,
    body: { name: 'Initially unlinked', applicationId: null }
  });
  const invalidUpdate = await request(`/api/documents/${document.payload.document.id}`, {
    method: 'PUT',
    token: owner.token,
    body: { applicationId: foreignApplication.id }
  });
  assert.equal(invalidUpdate.status, 404);
  assert.deepEqual(invalidUpdate.payload, { error: 'Application not found.' });

  const cleared = await request(`/api/documents/${linked.payload.document.id}`, {
    method: 'PUT',
    token: owner.token,
    body: { applicationId: null }
  });
  assert.equal(cleared.status, 200);
  assert.equal(cleared.payload.document.applicationId, null);
  assert.equal((await request(`/api/documents/${document.payload.document.id}`, {
    method: 'PUT',
    token: owner.token,
    body: { applicationId: 'not-an-app-id' }
  })).status, 400);
});

test('allows changing an unlinked document type and application', async () => {
  const owner = await registerUser('Unlinked Document Owner', 'unlinked-document-owner@example.com');
  const application = (await request('/api/applications', {
    method: 'POST',
    token: owner.token,
    body: { processId: 'passport' }
  })).payload.application;
  const document = await request('/api/documents', {
    method: 'POST',
    token: owner.token,
    body: { name: 'Unlinked document' }
  });
  assert.equal(document.status, 201);

  const updated = await request(`/api/documents/${document.payload.document.id}`, {
    method: 'PUT',
    token: owner.token,
    body: { documentType: 'other', applicationId: application.id }
  });

  assert.equal(updated.status, 200);
  assert.equal(updated.payload.document.documentType, 'other');
  assert.equal(updated.payload.document.applicationId, application.id);
});

test('keeps links for same-type requirements separate and clears links when documents are deleted', async () => {
  const user = await registerUser('Requirement Link Owner', 'requirement-link-owner@example.com');
  const application = (await request('/api/applications', {
    method: 'POST',
    token: user.token,
    body: { processId: 'university-application' }
  })).payload.application;
  const firstDocument = await request('/api/documents', {
    method: 'POST',
    token: user.token,
    body: {
      name: 'Academic reference',
      applicationId: application.id,
      documentType: 'recommendation-letter'
    }
  });
  const secondDocument = await request('/api/documents', {
    method: 'POST',
    token: user.token,
    body: {
      name: 'Character reference',
      applicationId: application.id,
      documentType: 'recommendation-letter'
    }
  });
  assert.equal(firstDocument.status, 201);
  assert.equal(secondDocument.status, 201);

  for (const [key, document] of [
    ['reference-letter-1', firstDocument],
    ['reference-letter-2', secondDocument]
  ]) {
    const linked = await request(`/api/applications/${application.id}/requirements/${key}`, {
      method: 'PATCH',
      token: user.token,
      body: { status: 'completed', documentId: document.payload.document.id }
    });
    assert.equal(linked.status, 200);
  }

  const deleted = await request(`/api/documents/${firstDocument.payload.document.id}`, {
    method: 'DELETE',
    token: user.token
  });
  assert.equal(deleted.status, 200);

  const refreshed = await request(`/api/applications/${application.id}`, { token: user.token });
  const firstRequirement = refreshed.payload.application.requirements
    .find((requirement) => requirement.key === 'reference-letter-1');
  const secondRequirement = refreshed.payload.application.requirements
    .find((requirement) => requirement.key === 'reference-letter-2');
  assert.equal(firstRequirement.status, 'missing');
  assert.equal(firstRequirement.documentId, null);
  assert.equal(firstRequirement.completedAt, null);
  assert.equal(secondRequirement.status, 'completed');
  assert.equal(secondRequirement.documentId, secondDocument.payload.document.id);
  assert.ok(secondRequirement.completedAt);
});

test('account deletion removes the user applications and documents', async () => {
  const user = await registerUser('Cleanup Owner', 'cleanup-owner@example.com');
  const application = (await request('/api/applications', {
    method: 'POST',
    token: user.token,
    body: { processId: 'passport' }
  })).payload.application;
  await request('/api/documents', {
    method: 'POST',
    token: user.token,
    body: { name: 'Cleanup document', applicationId: application.id }
  });

  const deleted = await request('/api/auth/me', { method: 'DELETE', token: user.token });
  assert.equal(deleted.status, 200);
  assert.equal(await findApplicationById(application.id, user.user.id), null);
  assert.deepEqual(await findDocumentsByOwnerId(user.user.id), []);
  assert.equal(await findUserById(user.user.id), null);
});

test('account deletion removes only the owner applications and embedded checklist state', async () => {
  const userA = await registerUser('Checklist Cleanup A', 'checklist-cleanup-a@example.com');
  const userB = await registerUser('Checklist Cleanup B', 'checklist-cleanup-b@example.com');

  const applicationA = (await request('/api/applications', {
    method: 'POST',
    token: userA.token,
    body: { processId: 'passport' }
  })).payload.application;
  const applicationB = (await request('/api/applications', {
    method: 'POST',
    token: userB.token,
    body: { processId: 'passport' }
  })).payload.application;

  const updateA = await request(
    `/api/applications/${applicationA.id}/requirements/identity-card`,
    { method: 'PATCH', token: userA.token, body: { status: 'completed' } }
  );
  const updateB = await request(
    `/api/applications/${applicationB.id}/requirements/identity-card`,
    { method: 'PATCH', token: userB.token, body: { status: 'completed' } }
  );
  assert.equal(updateA.status, 200);
  assert.equal(updateB.status, 200);
  assert.equal(updateA.payload.notification.body, 'Ghana Card for Passport Application is complete.');
  assert.equal(updateB.payload.notification.body, 'Ghana Card for Passport Application is complete.');
  assert.equal(
    updateA.payload.application.requirements.find((entry) => entry.key === 'identity-card').status,
    'completed'
  );
  assert.equal(
    updateB.payload.application.requirements.find((entry) => entry.key === 'identity-card').status,
    'completed'
  );

  const deleted = await request('/api/auth/me', { method: 'DELETE', token: userA.token });
  assert.equal(deleted.status, 200);
  assert.equal(await findApplicationById(applicationA.id, userA.user.id), null);
  assert.equal(await findApplicationById(applicationB.id, userB.user.id) !== null, true);
  assert.deepEqual(await findNotificationsByOwnerId(userA.user.id), []);
  assert.equal((await findNotificationsByOwnerId(userB.user.id)).length, 1);

  const retainedApplication = await request(`/api/applications/${applicationB.id}`, {
    token: userB.token
  });
  assert.equal(retainedApplication.status, 200);
  const retainedRequirement = retainedApplication.payload.application.requirements
    .find((entry) => entry.key === 'identity-card');
  assert.equal(retainedRequirement.status, 'completed');
  assert.ok(retainedRequirement.completedAt);
});

test('creates notifications only on transitions to completed and supports completion after reopening', async () => {
  const user = await registerUser('Completion Owner', 'completion-owner@example.com');
  assert.equal(user.user.preferences.notifications.applicationUpdates, true);
  const applicationResponse = await request('/api/applications', {
    method: 'POST',
    token: user.token,
    body: { processId: 'passport', name: 'My Passport Application' }
  });
  const application = applicationResponse.payload.application;
  const documentResponse = await request('/api/documents', {
    method: 'POST',
    token: user.token,
    body: {
      name: 'Identity document',
      applicationId: application.id,
      documentType: 'identity-card'
    }
  });
  const documentId = documentResponse.payload.document.id;

  const firstCompletion = await request(
    `/api/applications/${application.id}/requirements/identity-card`,
    {
      method: 'PATCH',
      token: user.token,
      body: { status: 'completed', documentId }
    }
  );
  assert.equal(firstCompletion.status, 200);
  assert.deepEqual(Object.keys(firstCompletion.payload.notification).sort(), [
    'applicationId', 'body', 'createdAt', 'documentId', 'dueDate', 'id',
    'isRead', 'kind', 'severity', 'title'
  ]);
  assert.equal(firstCompletion.payload.notification.kind, 'application');
  assert.equal(firstCompletion.payload.notification.severity, 'success');
  assert.equal(firstCompletion.payload.notification.title, 'Checklist requirement completed');
  assert.equal(firstCompletion.payload.notification.body, 'Ghana Card for My Passport Application is complete.');
  assert.equal(firstCompletion.payload.notification.applicationId, application.id);
  assert.equal(firstCompletion.payload.notification.documentId, documentId);
  assert.equal(firstCompletion.payload.notification.dueDate, null);
  assert.equal(firstCompletion.payload.notification.isRead, false);
  assert.equal(Object.hasOwn(firstCompletion.payload.notification, '_id'), false);
  assert.equal(Object.hasOwn(firstCompletion.payload.notification, 'ownerId'), false);
  assert.equal((await findNotificationsByOwnerId(user.user.id)).length, 1);

  const completedAgain = await request(
    `/api/applications/${application.id}/requirements/identity-card`,
    { method: 'PATCH', token: user.token, body: { status: 'completed' } }
  );
  assert.equal(completedAgain.status, 200);
  assert.equal(Object.hasOwn(completedAgain.payload, 'notification'), false);

  const reopenedToInProgress = await request(
    `/api/applications/${application.id}/requirements/identity-card`,
    { method: 'PATCH', token: user.token, body: { status: 'in-progress' } }
  );
  assert.equal(reopenedToInProgress.status, 200);
  assert.equal(Object.hasOwn(reopenedToInProgress.payload, 'notification'), false);
  assert.equal((await findNotificationsByOwnerId(user.user.id)).length, 1);

  const completedAgainFromInProgress = await request(
    `/api/applications/${application.id}/requirements/identity-card`,
    { method: 'PATCH', token: user.token, body: { status: 'completed' } }
  );
  assert.equal(completedAgainFromInProgress.status, 200);
  assert.equal(Object.hasOwn(completedAgainFromInProgress.payload, 'notification'), true);
  assert.equal((await findNotificationsByOwnerId(user.user.id)).length, 2);

  const reopened = await request(
    `/api/applications/${application.id}/requirements/identity-card`,
    { method: 'PATCH', token: user.token, body: { status: 'missing' } }
  );
  assert.equal(reopened.status, 200);
  assert.equal(Object.hasOwn(reopened.payload, 'notification'), false);
  assert.equal((await findNotificationsByOwnerId(user.user.id)).length, 2);

  const completedAfterReopen = await request(
    `/api/applications/${application.id}/requirements/identity-card`,
    { method: 'PATCH', token: user.token, body: { status: 'completed' } }
  );
  assert.equal(completedAfterReopen.status, 200);
  assert.equal(Object.hasOwn(completedAfterReopen.payload, 'notification'), true);
  assert.equal((await findNotificationsByOwnerId(user.user.id)).length, 3);

  const started = await request(
    `/api/applications/${application.id}/requirements/photograph`,
    { method: 'PATCH', token: user.token, body: { status: 'in-progress' } }
  );
  assert.equal(started.status, 200);
  assert.equal(Object.hasOwn(started.payload, 'notification'), false);

  const completedFromInProgress = await request(
    `/api/applications/${application.id}/requirements/photograph`,
    { method: 'PATCH', token: user.token, body: { status: 'completed' } }
  );
  assert.equal(completedFromInProgress.status, 200);
  assert.equal(Object.hasOwn(completedFromInProgress.payload, 'notification'), true);
  assert.equal((await findNotificationsByOwnerId(user.user.id)).length, 4);
});

test('applicationUpdates controls completion notifications without blocking checklist updates', async () => {
  const user = await registerUser('Preference Owner', 'preference-owner@example.com');
  assert.equal(user.user.preferences.notifications.applicationUpdates, true);
  const application = (await request('/api/applications', {
    method: 'POST',
    token: user.token,
    body: { processId: 'passport' }
  })).payload.application;

  const defaultEnabledCompletion = await request(
    `/api/applications/${application.id}/requirements/identity-card`,
    { method: 'PATCH', token: user.token, body: { status: 'completed' } }
  );
  assert.equal(defaultEnabledCompletion.status, 200);
  assert.equal(Object.hasOwn(defaultEnabledCompletion.payload, 'notification'), true);
  assert.equal((await findNotificationsByOwnerId(user.user.id)).length, 1);

  const disabledPreference = await request('/api/auth/me', {
    method: 'PUT',
    token: user.token,
    body: { preferences: { notifications: { applicationUpdates: false } } }
  });
  assert.equal(disabledPreference.status, 200);
  assert.equal(
    disabledPreference.payload.user.preferences.notifications.applicationUpdates,
    false
  );

  const disabledCompletion = await request(
    `/api/applications/${application.id}/requirements/photograph`,
    { method: 'PATCH', token: user.token, body: { status: 'completed' } }
  );
  assert.equal(disabledCompletion.status, 200);
  assert.equal(
    disabledCompletion.payload.application.requirements.find(({ key }) => key === 'photograph').status,
    'completed'
  );
  assert.equal(Object.hasOwn(disabledCompletion.payload, 'notification'), false);
  assert.equal((await findNotificationsByOwnerId(user.user.id)).length, 1);

  const enabledPreference = await request('/api/auth/me', {
    method: 'PUT',
    token: user.token,
    body: { preferences: { notifications: { applicationUpdates: true } } }
  });
  assert.equal(enabledPreference.status, 200);

  const reenabledCompletion = await request(
    `/api/applications/${application.id}/requirements/birth-certificate`,
    { method: 'PATCH', token: user.token, body: { status: 'completed' } }
  );
  assert.equal(reenabledCompletion.status, 200);
  assert.equal(Object.hasOwn(reenabledCompletion.payload, 'notification'), true);
  assert.equal((await findNotificationsByOwnerId(user.user.id)).length, 2);
});

test('legacy users without applicationUpdates retain completion notifications by default', async () => {
  const user = await registerUser('Legacy Preference Owner', 'legacy-preference-owner@example.com');
  const unsetCount = await updateUserRecord(user.user.id, {
    $unset: { 'preferences.notifications.applicationUpdates': true }
  });
  assert.equal(unsetCount, 1);

  const storedUser = await findUserById(user.user.id);
  assert.equal(
    Object.hasOwn(storedUser.preferences.notifications, 'applicationUpdates'),
    false
  );

  const application = (await request('/api/applications', {
    method: 'POST',
    token: user.token,
    body: { processId: 'passport' }
  })).payload.application;
  const completion = await request(
    `/api/applications/${application.id}/requirements/identity-card`,
    { method: 'PATCH', token: user.token, body: { status: 'completed' } }
  );

  assert.equal(completion.status, 200);
  assert.equal(completion.payload.notification.kind, 'application');
  assert.equal(completion.payload.notification.title, 'Checklist requirement completed');
  assert.equal((await findNotificationsByOwnerId(user.user.id)).length, 1);
});

test('applicationUpdates preference is isolated between application owners', async () => {
  const notificationsDisabledUser = await registerUser(
    'Notifications Disabled Owner',
    'notifications-disabled-owner@example.com'
  );
  const notificationsEnabledUser = await registerUser(
    'Notifications Enabled Owner',
    'notifications-enabled-owner@example.com'
  );

  const disabledPreference = await request('/api/auth/me', {
    method: 'PUT',
    token: notificationsDisabledUser.token,
    body: { preferences: { notifications: { applicationUpdates: false } } }
  });
  assert.equal(disabledPreference.status, 200);

  const disabledApplication = (await request('/api/applications', {
    method: 'POST',
    token: notificationsDisabledUser.token,
    body: { processId: 'passport' }
  })).payload.application;
  const enabledApplication = (await request('/api/applications', {
    method: 'POST',
    token: notificationsEnabledUser.token,
    body: { processId: 'passport' }
  })).payload.application;

  const disabledCompletion = await request(
    `/api/applications/${disabledApplication.id}/requirements/identity-card`,
    { method: 'PATCH', token: notificationsDisabledUser.token, body: { status: 'completed' } }
  );
  const enabledCompletion = await request(
    `/api/applications/${enabledApplication.id}/requirements/identity-card`,
    { method: 'PATCH', token: notificationsEnabledUser.token, body: { status: 'completed' } }
  );

  assert.equal(disabledCompletion.status, 200);
  assert.equal(Object.hasOwn(disabledCompletion.payload, 'notification'), false);
  assert.equal(enabledCompletion.status, 200);
  assert.equal(Object.hasOwn(enabledCompletion.payload, 'notification'), true);
  assert.equal((await findNotificationsByOwnerId(notificationsDisabledUser.user.id)).length, 0);
  assert.equal((await findNotificationsByOwnerId(notificationsEnabledUser.user.id)).length, 1);
});

test('notification persistence failure does not fail a completed requirement update', async () => {
  const user = await registerUser('Notification Failure Owner', 'notification-failure@example.com');
  const application = (await request('/api/applications', {
    method: 'POST',
    token: user.token,
    body: { processId: 'passport' }
  })).payload.application;
  const originalInsert = notificationsDatabase.insert;
  const originalConsoleError = console.error;
  let loggedError;
  notificationsDatabase.insert = function insert(_notification, callback) {
    callback(new Error('Injected notification persistence failure.'));
  };
  console.error = (message, error) => {
    loggedError = { message, error };
  };

  try {
    const result = await request(
      `/api/applications/${application.id}/requirements/identity-card`,
      { method: 'PATCH', token: user.token, body: { status: 'completed' } }
    );
    assert.equal(result.status, 200);
    assert.equal(
      result.payload.application.requirements.find(({ key }) => key === 'identity-card').status,
      'completed'
    );
    assert.equal(Object.hasOwn(result.payload, 'notification'), false);
  } finally {
    notificationsDatabase.insert = originalInsert;
    console.error = originalConsoleError;
  }

  assert.equal(loggedError.message, 'Unable to persist application completion notification.');
  assert.match(loggedError.error.message, /Injected notification persistence failure/);
  assert.deepEqual(await findNotificationsByOwnerId(user.user.id), []);
});
