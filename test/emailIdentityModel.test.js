const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, before, test } = require('node:test');

const temporaryDirectory = fs.mkdtempSync(
  path.join(os.tmpdir(), 'document-checklist-email-identity-test-')
);
process.env.NODE_ENV = 'test';
process.env.DOCUMENT_CHECKLIST_USERS_DB_PATH = path.join(temporaryDirectory, 'users.db');

const database = require('../src/config/database');
const {
  consumeEmailVerificationChallenge,
  consumePasswordResetChallenge,
  consumePendingEmailChallenge,
  changeUserPasswordById,
  createUser,
  deleteUserById,
  findUserByEmail,
  findUserById,
  issueEmailVerificationChallenge,
  issuePasswordResetChallenge,
  markUserDeletingById,
  reservePendingEmail,
  toPublicUser
} = require('../src/models/userModel');
const { createChallengeToken } = require('../src/services/challengeToken');

const passwordHash = '$2a$04$test-hash-not-used-for-authentication';
const expiresAt = () => Date.now() + 60 * 60 * 1000;
const resetExpiresAt = () => Date.now() + 20 * 60 * 1000;
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');

before(async () => {
  await database.initializeUserDatabase();
});

after(() => {
  const cleanupTarget = path.resolve(temporaryDirectory);
  if (path.dirname(cleanupTarget) !== path.resolve(os.tmpdir())
      || !path.basename(cleanupTarget).startsWith('document-checklist-email-identity-test-')) {
    throw new Error('Refusing to remove a path outside this test\'s temporary directory.');
  }
  fs.rmSync(cleanupTarget, { recursive: true, force: true });
});

async function createAccount(email) {
  return createUser({
    name: 'Email Identity User',
    email,
    password: passwordHash
  });
}

test('keeps verification and recovery fields private and legacy users unverified', async () => {
  const user = await createAccount('legacy@example.test');
  assert.equal(user.emailVerifiedAt, undefined);
  assert.deepEqual(toPublicUser(user), {
    id: user._id,
    name: user.name,
    email: user.email,
    phone: null,
    preferences: toPublicUser(user).preferences,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt
  });
});

test('rotates and consumes current-email challenges once, storing only hashes', async () => {
  const user = await createAccount('verify@example.test');
  const firstHash = hash('first-email-challenge');
  const secondHash = hash('second-email-challenge');

  await issueEmailVerificationChallenge(user._id, firstHash, expiresAt());
  const rotated = await issueEmailVerificationChallenge(user._id, secondHash, expiresAt());
  assert.equal(rotated.emailVerificationTokenHash, secondHash);
  assert.notEqual(rotated.emailVerificationTokenHash, 'second-email-challenge');
  assert.equal(await consumeEmailVerificationChallenge(firstHash), null);

  const verified = await consumeEmailVerificationChallenge(secondHash);
  assert.ok(verified.emailVerifiedAt);
  assert.equal(verified.emailVerificationTokenHash, undefined);
  assert.equal(await consumeEmailVerificationChallenge(secondHash), null);
});

test('generates opaque challenges and persists only their SHA-256 hash', async () => {
  const user = await createAccount('hash-only@example.test');
  const challenge = createChallengeToken();
  assert.match(challenge.token, /^[A-Za-z0-9_-]{43}$/);
  assert.match(challenge.tokenHash, /^[a-f0-9]{64}$/);
  assert.notEqual(challenge.token, challenge.tokenHash);

  const stored = await issueEmailVerificationChallenge(
    user._id,
    challenge.tokenHash,
    expiresAt()
  );
  assert.equal(stored.emailVerificationTokenHash, challenge.tokenHash);
  assert.notEqual(stored.emailVerificationTokenHash, challenge.token);
});

test('rejects expired challenges and allows only one concurrent redemption', async () => {
  const user = await createAccount('expiry-race@example.test');
  const expiredHash = hash('expired-email-challenge');
  await issueEmailVerificationChallenge(user._id, expiredHash, expiresAt());
  await new Promise((resolve, reject) => {
    database.update({ _id: user._id }, {
      $set: { emailVerificationExpiresAt: Date.now() - 1 }
    }, (error) => error ? reject(error) : resolve());
  });
  assert.equal(await consumeEmailVerificationChallenge(expiredHash), null);

  const currentHash = hash('concurrent-email-challenge');
  await issueEmailVerificationChallenge(user._id, currentHash, expiresAt());
  const redemptions = await Promise.all([
    consumeEmailVerificationChallenge(currentHash),
    consumeEmailVerificationChallenge(currentHash)
  ]);
  assert.equal(redemptions.filter(Boolean).length, 1);
});

test('reserves pending emails under normalized identity coordination and promotes once', async () => {
  const firstUser = await createAccount('pending-owner@example.test');
  const secondUser = await createAccount('pending-other@example.test');
  const tokenHash = hash('pending-email-challenge');

  const reserved = await reservePendingEmail(
    firstUser._id,
    '  New.Address@Example.Test ',
    tokenHash,
    expiresAt()
  );
  assert.equal(reserved.pendingEmail, 'new.address@example.test');
  assert.equal(await reservePendingEmail(
    secondUser._id,
    'NEW.ADDRESS@example.test',
    hash('competing-pending-challenge'),
    expiresAt()
  ), null);

  const promoted = await consumePendingEmailChallenge(tokenHash);
  assert.equal(promoted.email, 'new.address@example.test');
  assert.equal(promoted.pendingEmail, undefined);
  assert.ok(promoted.emailVerifiedAt);
  assert.equal(await consumePendingEmailChallenge(tokenHash), null);
});

test('consumes password-reset challenges once and increments the session version', async () => {
  const user = await createAccount('reset@example.test');
  const verificationHash = hash('reset-verification');
  await issueEmailVerificationChallenge(user._id, verificationHash, expiresAt());
  await consumeEmailVerificationChallenge(verificationHash);

  const resetHash = hash('password-reset-challenge');
  await issuePasswordResetChallenge(user._id, resetHash, resetExpiresAt());
  const beforeReset = await findUserById(user._id);
  const reset = await consumePasswordResetChallenge(
    resetHash,
    '$2a$04$replacement-password-hash'
  );
  assert.equal(reset.tokenVersion, beforeReset.tokenVersion + 1);
  assert.equal(reset.passwordResetTokenHash, undefined);
  assert.equal(await consumePasswordResetChallenge(
    resetHash,
    '$2a$04$replayed-password-hash'
  ), null);

  const nextResetHash = hash('password-change-invalidation');
  await issuePasswordResetChallenge(user._id, nextResetHash, resetExpiresAt());
  const changed = await changeUserPasswordById(
    user._id,
    reset.password,
    '$2a$04$password-changed-again-hash'
  );
  assert.equal(changed.tokenVersion, reset.tokenVersion + 1);
  assert.equal(changed.passwordResetTokenHash, undefined);
  assert.equal(await consumePasswordResetChallenge(
    nextResetHash,
    '$2a$04$stale-reset-hash'
  ), null);
});

test('password changes release pending-email reservations and invalidate their challenges', async () => {
  const user = await createAccount('password-change-owner@example.test');
  const verificationHash = hash('password-change-verification');
  await issueEmailVerificationChallenge(user._id, verificationHash, expiresAt());
  const verified = await consumeEmailVerificationChallenge(verificationHash);
  const pendingHash = hash('password-change-pending');
  await reservePendingEmail(
    user._id,
    'password-change-reserved@example.test',
    pendingHash,
    expiresAt()
  );

  const changed = await changeUserPasswordById(
    user._id,
    user.password,
    '$2a$04$password-change-replacement'
  );
  assert.equal(changed.tokenVersion, user.tokenVersion + 1);
  assert.equal(changed.email, user.email);
  assert.equal(changed.emailVerifiedAt, verified.emailVerifiedAt);
  assert.equal(changed.pendingEmail, undefined);
  assert.equal(changed.pendingEmailTokenHash, undefined);
  assert.equal(changed.pendingEmailExpiresAt, undefined);
  assert.equal(await consumePendingEmailChallenge(pendingHash), null);

  const nextUser = await createAccount('password-change-next@example.test');
  const reservation = await reservePendingEmail(
    nextUser._id,
    'password-change-reserved@example.test',
    hash('password-change-next-pending'),
    expiresAt()
  );
  assert.ok(reservation);
});

test('password resets release pending-email reservations and invalidate their challenges', async () => {
  const user = await createAccount('password-reset-owner@example.test');
  const verificationHash = hash('password-reset-verification');
  await issueEmailVerificationChallenge(user._id, verificationHash, expiresAt());
  const verified = await consumeEmailVerificationChallenge(verificationHash);
  const pendingHash = hash('password-reset-pending');
  await reservePendingEmail(
    user._id,
    'password-reset-reserved@example.test',
    pendingHash,
    expiresAt()
  );
  const resetHash = hash('password-reset-token');
  await issuePasswordResetChallenge(user._id, resetHash, resetExpiresAt());

  const reset = await consumePasswordResetChallenge(
    resetHash,
    '$2a$04$password-reset-replacement'
  );
  assert.equal(reset.email, user.email);
  assert.equal(reset.emailVerifiedAt, verified.emailVerifiedAt);
  assert.equal(reset.pendingEmail, undefined);
  assert.equal(reset.pendingEmailTokenHash, undefined);
  assert.equal(reset.pendingEmailExpiresAt, undefined);
  assert.equal(await consumePendingEmailChallenge(pendingHash), null);

  const nextUser = await createAccount('password-reset-next@example.test');
  const reservation = await reservePendingEmail(
    nextUser._id,
    'password-reset-reserved@example.test',
    hash('password-reset-next-pending'),
    expiresAt()
  );
  assert.ok(reservation);
});

test('allows only one concurrent registration for a normalized email', async () => {
  const attempts = await Promise.allSettled([
    createAccount('race@example.test'),
    createAccount(' RACE@example.test ')
  ]);
  assert.equal(attempts.filter((attempt) => attempt.status === 'fulfilled').length, 1);
  assert.equal(attempts.filter((attempt) => attempt.status === 'rejected').length, 1);
  assert.equal((await findUserByEmail('race@example.test')).email, 'race@example.test');
});

test('account deletion invalidates outstanding email and reset challenges', async () => {
  const user = await createAccount('delete-email@example.test');
  const emailHash = hash('delete-email-challenge');
  await issueEmailVerificationChallenge(user._id, emailHash, expiresAt());
  const pendingHash = hash('delete-pending-email-challenge');
  await reservePendingEmail(
    user._id,
    'reserved-until-deletion@example.test',
    pendingHash,
    expiresAt()
  );
  const resetHash = hash('delete-reset-challenge');
  await new Promise((resolve, reject) => {
    database.update({ _id: user._id }, {
      $set: { emailVerifiedAt: new Date().toISOString() }
    }, (error) => error ? reject(error) : resolve());
  });
  await issuePasswordResetChallenge(user._id, resetHash, resetExpiresAt());

  await Promise.all([
    consumeEmailVerificationChallenge(emailHash),
    markUserDeletingById(user._id)
  ]);
  const deletingUser = await findUserById(user._id);
  assert.equal(deletingUser.emailVerificationTokenHash, undefined);
  assert.equal(deletingUser.pendingEmail, undefined);
  assert.equal(deletingUser.pendingEmailTokenHash, undefined);
  assert.equal(deletingUser.passwordResetTokenHash, undefined);
  assert.equal(await consumeEmailVerificationChallenge(emailHash), null);
  assert.equal(await consumePasswordResetChallenge(
    resetHash,
    '$2a$04$unused-password-hash'
  ), null);

  const replacementUser = await createAccount('delete-pending-other@example.test');
  const replacement = await reservePendingEmail(
    replacementUser._id,
    'reserved-until-deletion@example.test',
    hash('after-deletion-pending-challenge'),
    expiresAt()
  );
  assert.ok(replacement);
  assert.equal(await deleteUserById(user._id), true);
});

test('sparse unique challenge indexes reject duplicate hashes', async () => {
  const firstUser = await createAccount('index-first@example.test');
  const secondUser = await createAccount('index-second@example.test');
  const duplicateHash = hash('duplicate-index-challenge');
  await issueEmailVerificationChallenge(firstUser._id, duplicateHash, expiresAt());

  await assert.rejects(
    issueEmailVerificationChallenge(secondUser._id, duplicateHash, expiresAt()),
    (error) => error.errorType === 'uniqueViolated'
  );
});
