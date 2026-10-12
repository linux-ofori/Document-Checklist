const crypto = require('node:crypto');

function hashChallengeToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function createChallengeToken() {
  const token = crypto.randomBytes(32).toString('base64url');
  return { token, tokenHash: hashChallengeToken(token) };
}

module.exports = { createChallengeToken, hashChallengeToken };
