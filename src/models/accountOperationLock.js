const locks = new Map();

async function withAccountOperationLock(accountId, operation) {
  const key = String(accountId);
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

module.exports = withAccountOperationLock;