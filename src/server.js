require('dotenv').config();

const jwt = require('jsonwebtoken');
const jwtSecret = process.env.JWT_SECRET;
if (typeof jwtSecret !== 'string' || jwtSecret.trim().length < 32) {
  throw new Error('JWT_SECRET must be configured with at least 32 non-whitespace characters.');
}

const jwtExpiresIn = process.env.JWT_EXPIRES_IN || '1d';
try {
  jwt.sign({}, jwtSecret, { expiresIn: jwtExpiresIn });
} catch {
  throw new Error('JWT_EXPIRES_IN must be a valid expiration value supported by jsonwebtoken.');
}

const express = require('express');
const helmet = require('helmet');
const authRoutes = require('./routes/authRoutes');
const documentRoutes = require('./routes/documentRoutes');
require('./config/database');

const app = express();
const port = Number(process.env.PORT) || 3000;

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '10kb' }));
app.use('/api/auth', authRoutes);
app.use('/api/documents', documentRoutes);

app.use('/api', (request, response) => {
  return response.status(404).json({ error: 'Route not found.' });
});

app.use((error, request, response, next) => {
  if (error.type === 'entity.too.large') {
    return response.status(413).json({ error: 'Request body is too large.' });
  }

  if (error instanceof SyntaxError && error.status === 400 && 'body' in error) {
    return response.status(400).json({ error: 'Request body must contain valid JSON.' });
  }

  console.error(error);
  return response.status(500).json({ error: 'An unexpected server error occurred.' });
});

if (require.main === module) {
  app.listen(port, () => {
    console.log(`Document Checklist API listening on http://localhost:${port}`);
  });
}

module.exports = app;
