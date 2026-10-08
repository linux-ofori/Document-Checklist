const assert = require('node:assert/strict');
const { test } = require('node:test');
const FakeEmailProvider = require('../src/services/fakeEmailProvider');
const { createEmailService } = require('../src/services/emailService');

const validMessage = {
  to: 'recipient@example.test',
  subject: 'Checklist requirement completed',
  text: 'Ghana Card for Passport Application is complete.',
  html: '<p>Ghana Card for Passport Application is complete.</p>',
  eventType: 'checklist-requirement-completed',
  eventId: 'completion-event-123'
};

test('delegates a valid message and configuration to the provider', async () => {
  const provider = new FakeEmailProvider();
  let providerSignal;
  const emailService = createEmailService({
    enabled: true,
    from: 'notifications@example.test',
    replyTo: 'support@example.test',
    provider: {
      sendEmail(message, options) {
        providerSignal = options.signal;
        return provider.sendEmail(message, options);
      }
    }
  });

  const result = await emailService.sendEmail(validMessage);

  assert.deepEqual(result, { status: 'sent', delivered: true });
  assert.deepEqual(provider.sentMessages, [{
    to: validMessage.to,
    from: 'notifications@example.test',
    replyTo: 'support@example.test',
    subject: validMessage.subject,
    text: validMessage.text,
    html: validMessage.html,
    eventType: validMessage.eventType,
    eventId: validMessage.eventId
  }]);
  assert.equal(providerSignal.aborted, false);
});

test('allows optional event metadata to be omitted', async () => {
  const provider = new FakeEmailProvider();
  const emailService = createEmailService({
    enabled: true,
    from: 'notifications@example.test',
    provider
  });

  const { eventType, eventId, ...message } = validMessage;
  await emailService.sendEmail(message);

  assert.equal(Object.hasOwn(provider.sentMessages[0], 'eventType'), false);
  assert.equal(Object.hasOwn(provider.sentMessages[0], 'eventId'), false);
});

test('normalizes provider failures without exposing provider error details', async () => {
  const provider = new FakeEmailProvider({
    failure: new Error('private provider response and credential')
  });
  const emailService = createEmailService({
    enabled: true,
    from: 'notifications@example.test',
    provider
  });

  await assert.rejects(emailService.sendEmail(validMessage), (error) => {
    assert.equal(error.code, 'EMAIL_PROVIDER_FAILURE');
    assert.equal(error.message, 'Email provider delivery failed.');
    assert.doesNotMatch(error.message, /private provider response|credential/);
    return true;
  });
});

test('rejects provider operations that exceed the configured timeout', async () => {
  const fakeProvider = new FakeEmailProvider({ delayMs: 40 });
  let providerSignal;
  const emailService = createEmailService({
    enabled: true,
    from: 'notifications@example.test',
    provider: {
      sendEmail(message, options) {
        providerSignal = options.signal;
        return fakeProvider.sendEmail(message, options);
      }
    },
    timeoutMs: 5
  });

  await assert.rejects(emailService.sendEmail(validMessage), (error) => {
    assert.equal(error.code, 'EMAIL_PROVIDER_TIMEOUT');
    assert.equal(error.message, 'Email provider request timed out.');
    return true;
  });
  assert.equal(providerSignal.aborted, true);
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.deepEqual(fakeProvider.sentMessages, []);
});

test('disabled email does not invoke the provider or claim delivery', async () => {
  const provider = new FakeEmailProvider();
  const emailService = createEmailService({ enabled: false, provider });

  assert.deepEqual(await emailService.sendEmail(validMessage), {
    status: 'disabled',
    delivered: false
  });
  assert.deepEqual(provider.sentMessages, []);
});

test('requires a provider and valid sender when enabled', () => {
  assert.throws(
    () => createEmailService({ enabled: true, from: 'notifications@example.test' }),
    /An email provider is required/
  );
  assert.throws(
    () => createEmailService({
      enabled: true,
      from: 'invalid',
      provider: new FakeEmailProvider()
    }),
    /A valid sender address is required/
  );
});

test('rejects invalid recipients and unsafe subject/header values before provider calls', async () => {
  const provider = new FakeEmailProvider();
  const emailService = createEmailService({
    enabled: true,
    from: 'notifications@example.test',
    provider
  });

  for (const message of [
    { ...validMessage, to: 'not-an-email' },
    { ...validMessage, to: 'recipient@example.test\r\nBcc: attacker@example.test' },
    { ...validMessage, subject: '' },
    { ...validMessage, subject: 'Subject\nBcc: attacker@example.test' },
    { ...validMessage, subject: `a${'b'.repeat(998)}` }
  ]) {
    await assert.rejects(emailService.sendEmail(message), TypeError);
  }
  assert.deepEqual(provider.sentMessages, []);
});

test('fake provider sends without making network requests', async () => {
  const provider = new FakeEmailProvider();
  const emailService = createEmailService({
    enabled: true,
    from: 'notifications@example.test',
    provider
  });
  const originalFetch = globalThis.fetch;
  let networkCalls = 0;
  globalThis.fetch = async () => {
    networkCalls += 1;
    throw new Error('Unexpected network call.');
  };

  try {
    await emailService.sendEmail(validMessage);
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(networkCalls, 0);
  assert.equal(provider.sentMessages.length, 1);
});
