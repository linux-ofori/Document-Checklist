const jwt = require('jsonwebtoken');

function createAuthToken(user) {
  return jwt.sign(
    { tokenVersion: Number.isSafeInteger(user.tokenVersion) ? user.tokenVersion : 0 },
    process.env.JWT_SECRET,
    {
      subject: String(user._id),
      expiresIn: process.env.JWT_EXPIRES_IN || '1d'
    }
  );
}

module.exports = { createAuthToken };
