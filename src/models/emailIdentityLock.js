const withAccountOperationLock = require('./accountOperationLock');

const locks = new Map();
const retryIdentityLock = Symbol('retry-email-identity-lock');

function normalizeEmailAddress(email) {
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

function normalizedAddresses(addresses) {
  return [...new Set(addresses.map(normalizeEmailAddress).filter(Boolean))].sort();
}

async function withLock(key, operation) {
  const previous = locks.get(key) || Promise.resolve();
  let release;
  const current = new Promise((resolve) => {
    release = resolve;
  });

  locks.set(key, current);
  await previous;

  try {
    return await operation();
  } finally {
    release();
    if (locks.get(key) === current) {
      locks.delete(key);
    }
  }
}

async function withEmailIdentityLocks(addresses, operation) {
  const keys = normalizedAddresses(addresses);

  async function acquireNext(index) {
    if (index === keys.length) {
      return operation();
    }
    return withLock(keys[index], () => acquireNext(index + 1));
  }

  return acquireNext(0);
}

function identityAddresses(user) {
  return normalizedAddresses([user.email, user.pendingEmail]);
}

async function withStableUserIdentityLocks({
  userId,
  findUserById,
  additionalAddresses = [],
  operation
}) {
  while (true) {
    const snapshot = await findUserById(userId);
    if (!snapshot) {
      return operation(null);
    }

    const snapshotAddresses = identityAddresses(snapshot);
    const lockedAddresses = normalizedAddresses([
      ...snapshotAddresses,
      ...additionalAddresses
    ]);
    const result = await withEmailIdentityLocks(lockedAddresses, () => (
      withAccountOperationLock(userId, async () => {
        const currentUser = await findUserById(userId);
        if (!currentUser) {
          return operation(null);
        }

        const currentAddresses = identityAddresses(currentUser);
        if (currentAddresses.length !== snapshotAddresses.length
            || currentAddresses.some((address, index) => address !== snapshotAddresses[index])) {
          return retryIdentityLock;
        }

        return operation(currentUser);
      })
    ));

    if (result !== retryIdentityLock) {
      return result;
    }
  }
}

module.exports = {
  normalizeEmailAddress,
  normalizedAddresses,
  withEmailIdentityLocks,
  withStableUserIdentityLocks
};
