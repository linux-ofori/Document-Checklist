require('dotenv').config();

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  throw new Error('JWT_SECRET must be configured with at least 32 characters.');
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
