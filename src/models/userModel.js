const database = require('../config/database');
const {
  normalizeEmailAddress,
  withEmailIdentityLocks,
  withStableUserIdentityLocks
} = require('./emailIdentityLock');
const withAccountOperationLock = require('./accountOperationLock');

const verificationTokenFields = [
  'emailVerificationTokenHash',
  'emailVerificationExpiresAt',
  'emailVerificationEmail'
];
const pendingEmailTokenFields = [
  'pendingEmailTokenHash',
  'pendingEmailExpiresAt'
];
const passwordResetTokenFields = [
  'passwordResetTokenHash',
  'passwordResetExpiresAt',
  'passwordResetActivated'
];
const EMAIL_CHALLENGE_TTL_MS = 24 * 60 * 60 * 1000;
const PASSWORD_RESET_TTL_MS = 30 * 60 * 1000;

const DEFAULT_NOTIFICATION_PREFERENCES = {
  documentExpiry: true,
  applicationUpdates: true,
  emailChecklistCompletion: false,
  securityAccount: true
};

function normalizePreferences(preferences) {
  const notifications = preferences?.notifications || {};

  return {
    notifications: {
      documentExpiry: typeof notifications.documentExpiry === 'boolean'
        ? notifications.documentExpiry
        : DEFAULT_NOTIFICATION_PREFERENCES.documentExpiry,
      applicationUpdates: typeof notifications.applicationUpdates === 'boolean'
        ? notifications.applicationUpdates
        : DEFAULT_NOTIFICATION_PREFERENCES.applicationUpdates,
      emailChecklistCompletion: typeof notifications.emailChecklistCompletion === 'boolean'
        ? notifications.emailChecklistCompletion
        : DEFAULT_NOTIFICATION_PREFERENCES.emailChecklistCompletion,
      securityAccount: true
    }
  };
}

function toPublicUser(user) {
  if (!user) {
    return null;
  }

  return {
    id: user._id,
    name: user.name,
    email: user.email,
    emailVerified: Boolean(user.emailVerifiedAt),
    googleLinked: Boolean(user.googleSubject),
    phone: typeof user.phone === 'string' ? user.phone : null,
    preferences: normalizePreferences(user.preferences),
    createdAt: user.createdAt,
    updatedAt: user.updatedAt
  };
}

function tokenHashIsValid(tokenHash) {
  return typeof tokenHash === 'string' && /^[a-f0-9]{64}$/.test(tokenHash);
}

function expiryIsValid(expiresAt, maximumTtl) {
  const now = Date.now();
  return Number.isSafeInteger(expiresAt)
    && expiresAt > now
    && expiresAt <= now + maximumTtl;
}

function identityConflictError() {
  const error = new Error('An account with that email already exists.');
  error.errorType = 'uniqueViolated';
  return error;
}

function findEmailIdentityConflict(email, excludeUserId = null) {
  const normalizedEmail = normalizeEmailAddress(email);
  return new Promise((resolve, reject) => {
    database.find({}, (error, users) => {
      if (error) {
        return reject(error);
      }

      const conflict = users.find((user) => user._id !== excludeUserId
        && [user.email, user.pendingEmail]
          .some((candidate) => normalizeEmailAddress(candidate) === normalizedEmail));
      return resolve(conflict || null);
    });
  });
}

function updateOne(query, update) {
  return new Promise((resolve, reject) => {
    database.update(query, update, { returnUpdatedDocs: true }, (error, count, user) => {
      if (error) {
        return reject(error);
      }
      return resolve(count > 0 ? user : null);
    });
  });
}

function createUser({ name, email, password, phone = null }) {
  const normalizedEmail = normalizeEmailAddress(email);
  return withEmailIdentityLocks([normalizedEmail], async () => {
    if (await findEmailIdentityConflict(normalizedEmail)) {
      throw identityConflictError();
    }

    const timestamp = new Date().toISOString();
    return new Promise((resolve, reject) => {
      database.insert({
        name,
        email: normalizedEmail,
        password,
        phone: phone || null,
        preferences: { notifications: { ...DEFAULT_NOTIFICATION_PREFERENCES } },
        tokenVersion: 0,
        createdAt: timestamp,
        updatedAt: timestamp
      }, (error, user) => error ? reject(error) : resolve(user));
    });
  });
}

function createGoogleUser({ name, email, googleSubject, emailVerified = false }) {
  const normalizedEmail = normalizeEmailAddress(email);
  return withEmailIdentityLocks([normalizedEmail], async () => {
    if (await findEmailIdentityConflict(normalizedEmail)) {
      throw identityConflictError();
    }

    const timestamp = new Date().toISOString();
    const user = {
      name,
      email: normalizedEmail,
      googleSubject,
      phone: null,
      preferences: { notifications: { ...DEFAULT_NOTIFICATION_PREFERENCES } },
      tokenVersion: 0,
      createdAt: timestamp,
      updatedAt: timestamp
    };
    if (emailVerified === true) {
      user.emailVerifiedAt = timestamp;
    }
    return new Promise((resolve, reject) => {
      database.insert(user, (error, insertedUser) => (
        error ? reject(error) : resolve(insertedUser)
      ));
    });
  });
}

function findUserByEmail(email) {
  return new Promise((resolve, reject) => {
    database.findOne({ email }, (error, user) => error ? reject(error) : resolve(user));
  });
}

function findUserByGoogleSubject(googleSubject) {
  return new Promise((resolve, reject) => {
    database.findOne({ googleSubject }, (error, user) => error ? reject(error) : resolve(user));
  });
}

function findUserByChallengeHash(field, tokenHash) {
  return new Promise((resolve, reject) => {
    database.findOne({ [field]: tokenHash }, (error, user) => (
      error ? reject(error) : resolve(user)
    ));
  });
}

function findUserById(id) {
  return new Promise((resolve, reject) => {
    database.findOne({ _id: id }, (error, user) => error ? reject(error) : resolve(user));
  });
}

function linkGoogleSubjectById(id, googleSubject) {
  return new Promise((resolve, reject) => {
    database.update(
      { _id: id, deleting: { $ne: true }, googleSubject: { $exists: false } },
      {
        $set: {
          googleSubject,
          updatedAt: new Date().toISOString()
        }
      },
      { returnUpdatedDocs: true },
      (error, count, user) => {
        if (error) {
          return reject(error);
        }

        return resolve(count > 0 ? user : null);
      }
    );
  });
}

function findUsersPendingDeletion() {
  return new Promise((resolve, reject) => {
    database.find({ deleting: true }, (error, users) => error ? reject(error) : resolve(users));
  });
}

function markUserDeletingById(id) {
  return new Promise((resolve, reject) => {
    database.update(
      { _id: id },
      {
        $set: { deleting: true, updatedAt: new Date().toISOString() },
        $unset: Object.fromEntries([
          ...verificationTokenFields,
          'pendingEmail',
          ...pendingEmailTokenFields,
          ...passwordResetTokenFields
        ].map((field) => [field, true]))
      },
      { returnUpdatedDocs: true },
      (error, count, user) => {
        if (error) {
          return reject(error);
        }

        return resolve(count > 0 ? user : null);
      }
    );
  });
}

function updateUserById(id, { name, email, phone, preferences }) {
  if (email !== undefined) {
    const error = new Error('Email changes require verification.');
    error.code = 'EMAIL_CHANGE_REQUIRES_VERIFICATION';
    throw error;
  }

  const updates = { updatedAt: new Date().toISOString() };

  if (name !== undefined) {
    updates.name = name;
  }

  if (phone !== undefined) {
    updates.phone = phone;
  }

  if (preferences !== undefined) {
    updates.preferences = normalizePreferences(preferences);
  }

  return new Promise((resolve, reject) => {
    database.update(
      { _id: id, deleting: { $ne: true } },
      { $set: updates },
      { returnUpdatedDocs: true },
      (error, count, user) => {
        if (error) {
          return reject(error);
        }

        return resolve(count > 0 ? user : null);
      }
    );
  });
}

function changeUserPasswordById(
  id,
  currentPasswordHash,
  newPasswordHash,
  expectedTokenVersion
) {
  return withStableUserIdentityLocks({
    userId: id,
    findUserById,
    operation: (user) => {
      const currentTokenVersion = user && Number.isSafeInteger(user.tokenVersion)
        ? user.tokenVersion
        : 0;
      if (!user
          || user.deleting
          || user.password !== currentPasswordHash
          || (expectedTokenVersion !== undefined
            && currentTokenVersion !== expectedTokenVersion)) {
        return null;
      }

      return updateOne(
        { _id: id, password: currentPasswordHash, deleting: { $ne: true } },
        {
          $set: { password: newPasswordHash, updatedAt: new Date().toISOString() },
          $inc: { tokenVersion: 1 },
          $unset: Object.fromEntries([
            ...passwordResetTokenFields,
            'pendingEmail',
            ...pendingEmailTokenFields
          ].map((field) => [field, true]))
        }
      );
    }
  });
}

async function issueEmailVerificationChallenge(userId, tokenHash, expiresAt) {
  if (!tokenHashIsValid(tokenHash) || !expiryIsValid(expiresAt, EMAIL_CHALLENGE_TTL_MS)) {
    throw new TypeError('A valid token hash and future expiry are required.');
  }

  return withStableUserIdentityLocks({
    userId,
    findUserById,
    operation: async (user) => {
      if (!user || user.deleting || user.emailVerifiedAt) {
        return null;
      }
      return updateOne({
        _id: userId,
        email: user.email,
        deleting: { $ne: true },
        emailVerifiedAt: { $exists: false }
      }, {
        $set: {
          emailVerificationTokenHash: tokenHash,
          emailVerificationExpiresAt: expiresAt,
          emailVerificationEmail: user.email
        }
      });
    }
  });
}

async function consumeEmailVerificationChallenge(tokenHash, now = Date.now()) {
  if (!tokenHashIsValid(tokenHash) || !Number.isSafeInteger(now)) {
    return null;
  }
  const user = await findUserByChallengeHash('emailVerificationTokenHash', tokenHash);
  if (!user) {
    return null;
  }

  return withStableUserIdentityLocks({
    userId: user._id,
    findUserById,
    operation: async (currentUser) => {
      if (!currentUser
          || currentUser.deleting
          || currentUser.emailVerifiedAt
          || currentUser.emailVerificationEmail !== currentUser.email) {
        return null;
      }
      return updateOne({
        _id: currentUser._id,
        email: currentUser.email,
        emailVerificationEmail: currentUser.email,
        emailVerificationTokenHash: tokenHash,
        emailVerificationExpiresAt: { $gt: now },
        emailVerifiedAt: { $exists: false },
        deleting: { $ne: true }
      }, {
        $set: {
          emailVerifiedAt: new Date(now).toISOString(),
          updatedAt: new Date(now).toISOString()
        },
        $unset: Object.fromEntries(verificationTokenFields.map((field) => [field, true]))
      });
    }
  });
}

async function reservePendingEmail(userId, email, tokenHash, expiresAt) {
  const normalizedEmail = normalizeEmailAddress(email);
  if (!normalizedEmail
      || !tokenHashIsValid(tokenHash)
      || !expiryIsValid(expiresAt, EMAIL_CHALLENGE_TTL_MS)) {
    throw new TypeError('A valid pending email, token hash, and future expiry are required.');
  }

  return withStableUserIdentityLocks({
    userId,
    findUserById,
    additionalAddresses: [normalizedEmail],
    operation: async (user) => {
      if (!user
          || user.deleting
          || typeof user.password !== 'string'
          || normalizeEmailAddress(user.email) === normalizedEmail
          || await findEmailIdentityConflict(normalizedEmail, userId)) {
        return null;
      }
      return updateOne({
        _id: userId,
        email: user.email,
        deleting: { $ne: true },
        password: { $exists: true }
      }, {
        $set: {
          pendingEmail: normalizedEmail,
          pendingEmailTokenHash: tokenHash,
          pendingEmailExpiresAt: expiresAt
        }
      });
    }
  });
}

async function consumePendingEmailChallenge(tokenHash, now = Date.now()) {
  if (!tokenHashIsValid(tokenHash) || !Number.isSafeInteger(now)) {
    return null;
  }
  const user = await findUserByChallengeHash('pendingEmailTokenHash', tokenHash);
  if (!user) {
    return null;
  }

  return withStableUserIdentityLocks({
    userId: user._id,
    findUserById,
    operation: async (currentUser) => {
      if (!currentUser || currentUser.deleting || !currentUser.pendingEmail) {
        return null;
      }
      if (await findEmailIdentityConflict(currentUser.pendingEmail, currentUser._id)) {
        return null;
      }

      const timestamp = new Date(now).toISOString();
      return updateOne({
        _id: currentUser._id,
        email: currentUser.email,
        pendingEmail: currentUser.pendingEmail,
        pendingEmailTokenHash: tokenHash,
        pendingEmailExpiresAt: { $gt: now },
        deleting: { $ne: true }
      }, {
        $set: {
          email: currentUser.pendingEmail,
          emailVerifiedAt: timestamp,
          updatedAt: timestamp
        },
        $unset: Object.fromEntries([
          ...verificationTokenFields,
          'pendingEmail',
          ...pendingEmailTokenFields,
          ...passwordResetTokenFields
        ].map((field) => [field, true]))
      });
    }
  });
}

async function issuePasswordResetChallenge(userId, tokenHash, expiresAt) {
  if (!tokenHashIsValid(tokenHash) || !expiryIsValid(expiresAt, PASSWORD_RESET_TTL_MS)) {
    throw new TypeError('A valid token hash and future expiry are required.');
  }
  return withAccountOperationLock(userId, async () => {
    const user = await findUserById(userId);
    if (!user || user.deleting || !user.emailVerifiedAt || typeof user.password !== 'string') {
      return null;
    }
    return updateOne({
      _id: userId,
      deleting: { $ne: true },
      emailVerifiedAt: { $exists: true },
      password: { $exists: true }
    }, {
      $set: {
        passwordResetTokenHash: tokenHash,
        passwordResetExpiresAt: expiresAt,
        passwordResetActivated: false
      }
    });
  });
}

async function activatePasswordResetChallenge(userId, tokenHash, now = Date.now()) {
  if (!tokenHashIsValid(tokenHash) || !Number.isSafeInteger(now)) {
    throw new TypeError('A valid password reset token hash and activation time are required.');
  }
  return withAccountOperationLock(userId, async () => {
    const user = await findUserById(userId);
    if (!user || user.deleting || !user.emailVerifiedAt || typeof user.password !== 'string') {
      return null;
    }
    return updateOne({
      _id: userId,
      passwordResetTokenHash: tokenHash,
      passwordResetExpiresAt: { $gt: now },
      passwordResetActivated: false,
      emailVerifiedAt: { $exists: true },
      password: { $exists: true },
      deleting: { $ne: true }
    }, {
      $set: { passwordResetActivated: true }
    });
  });
}

async function consumePasswordResetChallenge(tokenHash, newPasswordHash, now = Date.now()) {
  if (!tokenHashIsValid(tokenHash)
      || typeof newPasswordHash !== 'string'
      || !newPasswordHash
      || !Number.isSafeInteger(now)) {
    return null;
  }
  const user = await findUserByChallengeHash('passwordResetTokenHash', tokenHash);
  if (!user) {
    return null;
  }

  return withStableUserIdentityLocks({
    userId: user._id,
    findUserById,
    operation: (currentUser) => {
      if (!currentUser || currentUser.deleting) {
        return null;
      }
      return updateOne({
        _id: currentUser._id,
        passwordResetTokenHash: tokenHash,
        passwordResetExpiresAt: { $gt: now },
        passwordResetActivated: true,
        emailVerifiedAt: { $exists: true },
        password: { $exists: true },
        deleting: { $ne: true }
      }, {
        $set: {
          password: newPasswordHash,
          updatedAt: new Date(now).toISOString()
        },
        $unset: Object.fromEntries([
          ...passwordResetTokenFields,
          'pendingEmail',
          ...pendingEmailTokenFields
        ].map((field) => [field, true])),
        $inc: { tokenVersion: 1 }
      });
    }
  });
}

function invalidateEmailVerificationChallenge(userId, tokenHash) {
  if (!tokenHashIsValid(tokenHash)) {
    throw new TypeError('A valid email verification token hash is required.');
  }

  return withStableUserIdentityLocks({
    userId,
    findUserById,
    operation: (user) => user && !user.deleting
      ? updateOne({
        _id: userId,
        emailVerificationTokenHash: tokenHash,
        deleting: { $ne: true }
      }, {
        $unset: Object.fromEntries(verificationTokenFields.map((field) => [field, true]))
      })
      : null
  });
}

function invalidatePendingEmailChallenge(userId) {
  return withStableUserIdentityLocks({
    userId,
    findUserById,
    operation: (user) => user && !user.deleting
      ? updateOne({ _id: userId, deleting: { $ne: true } }, {
        $unset: Object.fromEntries(['pendingEmail', ...pendingEmailTokenFields]
          .map((field) => [field, true]))
      })
      : null
  });
}

function invalidatePasswordResetChallenge(userId, tokenHash) {
  if (!tokenHashIsValid(tokenHash)) {
    throw new TypeError('A valid password reset token hash is required.');
  }

  return withAccountOperationLock(userId, async () => {
    const user = await findUserById(userId);
    if (!user || user.deleting) {
      return null;
    }
    return updateOne({
      _id: userId,
      passwordResetTokenHash: tokenHash,
      deleting: { $ne: true }
    }, {
      $unset: Object.fromEntries(passwordResetTokenFields.map((field) => [field, true]))
    });
  });
}

function incrementUserTokenVersionById(id) {
  return new Promise((resolve, reject) => {
    database.update(
      { _id: id, deleting: { $ne: true } },
      { $inc: { tokenVersion: 1 } },
      { returnUpdatedDocs: true },
      (error, count, user) => {
        if (error) {
          return reject(error);
        }

        return resolve(count > 0 ? user : null);
      }
    );
  });
}

function deleteUserById(id) {
  return new Promise((resolve, reject) => {
    database.remove({ _id: id }, {}, (error, count) => error ? reject(error) : resolve(count > 0));
  });
}

module.exports = {
  createUser,
  createGoogleUser,
  changeUserPasswordById,
  consumeEmailVerificationChallenge,
  consumePasswordResetChallenge,
  consumePendingEmailChallenge,
  deleteUserById,
  findUserByEmail,
  findUserByGoogleSubject,
  findUserById,
  findUsersPendingDeletion,
  incrementUserTokenVersionById,
  activatePasswordResetChallenge,
  invalidateEmailVerificationChallenge,
  invalidatePasswordResetChallenge,
  invalidatePendingEmailChallenge,
  issueEmailVerificationChallenge,
  issuePasswordResetChallenge,
  linkGoogleSubjectById,
  markUserDeletingById,
  reservePendingEmail,
  updateUserById,
  toPublicUser
};
