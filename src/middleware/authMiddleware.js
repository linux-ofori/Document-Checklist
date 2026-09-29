const jwt = require('jsonwebtoken');
const { findUserById, toPublicUser } = require('../models/userModel');

async function requireAuth(request, response, next) {
  const authorization = request.headers.authorization;
  const [scheme, token] = authorization ? authorization.split(' ') : [];

  if (scheme !== 'Bearer' || !token) {
    return response.status(401).json({ error: 'A Bearer token is required.' });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const user = await findUserById(payload.sub);

    if (!user) {
      return response.status(401).json({ error: 'The authenticated user no longer exists.' });
    }

    request.user = toPublicUser(user);
    return next();
  } catch (error) {
    return response.status(401).json({ error: 'The token is invalid or expired.' });
  }
}

module.exports = requireAuth;
