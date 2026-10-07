const jwt = require('jsonwebtoken');
const { findUserById, toPublicUser } = require('../models/userModel');

function createRequireAuth(allowDeletingAccount) {
  return async function requireAuth(request, response, next) {
    const authorization = request.headers.authorization;
    const [scheme, token] = authorization ? authorization.split(' ') : [];

    if (scheme !== 'Bearer' || !token) {
      return response.status(401).json({ error: 'A Bearer token is required.' });
    }

    let payload;
    try {
      payload = jwt.verify(token, process.env.JWT_SECRET);
    } catch (error) {
      return response.status(401).json({ error: 'The token is invalid or expired.' });
    }

    const tokenVersion = payload && typeof payload === 'object'
      ? (payload.tokenVersion === undefined ? 0 : payload.tokenVersion)
      : null;
    if (!Number.isSafeInteger(tokenVersion) || tokenVersion < 0) {
      return response.status(401).json({ error: 'The token is invalid or expired.' });
    }

    let user;
    try {
      user = await findUserById(payload.sub);
    } catch (error) {
      return next(error);
    }

    if (!user || (user.deleting && !allowDeletingAccount)) {
      return response.status(401).json({ error: 'The authenticated user no longer exists.' });
    }

    const currentTokenVersion = user.tokenVersion === undefined ? 0 : user.tokenVersion;
    if (!Number.isSafeInteger(currentTokenVersion)
        || currentTokenVersion < 0
        || tokenVersion !== currentTokenVersion) {
      return response.status(401).json({ error: 'The token is invalid or expired.' });
    }

    request.user = toPublicUser(user);
    return next();
  };
}

const requireAuth = createRequireAuth(false);
requireAuth.allowDeletingAccount = createRequireAuth(true);

module.exports = requireAuth;
